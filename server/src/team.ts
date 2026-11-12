import type { AgentDefinition } from "@anthropic-ai/claude-agent-sdk";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { SERVER_ROOT } from "./config.js";

/**
 * The specialist subagents (reviewer, test writer, QA tester, docs writer, security reviewer). They are plain
 * Claude Code agent files in agents/: Scriptorium's own sessions get them through the SDK, and Setup can copy
 * them to ~/.claude/agents/scriptorium/ for every other Claude Code session.
 */

const TEAM_DIR = path.join(SERVER_ROOT, "..", "agents");
const INSTALL_DIR = path.join(os.homedir(), ".claude", "agents", "scriptorium");

type AgentFile = { file: string; name: string; text: string; definition: AgentDefinition };

/** "a, b" or "[a, b]" → ["a", "b"] */
const list = (v?: string) =>
  v
    ?.replace(/^\[|\]$/g, "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);

/** Reads one agent file. The frontmatter is the simple "key: value" form our own files use. */
function parse(file: string): AgentFile | undefined {
  const text = readFileSync(path.join(TEAM_DIR, file), "utf8").replace(/\r\n/g, "\n");
  const m = /^---\n([\s\S]*?)\n---\n([\s\S]*)$/.exec(text);
  if (!m) return undefined;
  const fields: Record<string, string> = {};
  for (const line of m[1].split("\n")) {
    const i = line.indexOf(":");
    if (i > 0) fields[line.slice(0, i).trim()] = line.slice(i + 1).trim();
  }
  // Not a Claude subagent: the builder runs on DeepSeek behind the build tool (builder.ts)
  if (!fields.name || !fields.description || fields["runs-on"]) return undefined;
  return {
    file,
    name: fields.name,
    text,
    definition: {
      description: fields.description,
      prompt: m[2].trim(),
      tools: list(fields.tools),
      model: fields.model || undefined,
      skills: list(fields.skills),
    },
  };
}

function loadTeam(): AgentFile[] {
  if (!existsSync(TEAM_DIR)) return [];
  return readdirSync(TEAM_DIR)
    .filter((f) => f.endsWith(".md"))
    .map(parse)
    .filter((a): a is AgentFile => !!a);
}

const TEAM = loadTeam();

/** The team as SDK agent definitions, for Scriptorium's own Claude sessions */
export const TEAM_AGENTS: Record<string, AgentDefinition> = Object.fromEntries(TEAM.map((a) => [a.name, { ...a.definition }]));

/** Names of the specialist subagents */
export const TEAM_NAMES = new Set(TEAM.map((a) => a.name));

/** Each specialist's model as its agent file sets it */
export const TEAM_DEFAULT_MODELS: Record<string, string> = Object.fromEntries(TEAM.map((a) => [a.name, a.definition.model ?? "inherit"]));

/**
 * Uses the user's model choices (Settings → Team models) instead of the files' defaults. TEAM_AGENTS is shared,
 * so sessions started from now on get them; open ones keep theirs.
 */
export function applyTeamModels(models: Record<string, string>) {
  for (const a of TEAM) TEAM_AGENTS[a.name].model = models[a.name] ?? a.definition.model;
}

/** The agent file with the model in use */
const fileText = (a: AgentFile) => a.text.replace(/^model:.*$/m, `model: ${TEAM_AGENTS[a.name].model ?? a.definition.model}`);

/** Whether every team file is in ~/.claude/agents/scriptorium/ and up to date */
export async function teamInstalled(): Promise<boolean> {
  if (!TEAM.length) return false;
  const current = await Promise.all(TEAM.map((a) => readFile(path.join(INSTALL_DIR, a.file), "utf8").catch(() => "")));
  return current.every((text, i) => text.replace(/\r\n/g, "\n") === fileText(TEAM[i]));
}

/** Copies the team to ~/.claude/agents/scriptorium/ (overwriting older copies) so every Claude Code session has it */
export async function installTeam() {
  await mkdir(INSTALL_DIR, { recursive: true });
  await Promise.all(TEAM.map((a) => writeFile(path.join(INSTALL_DIR, a.file), fileText(a), "utf8")));
}

/** After a model change: updates the copies other Claude Code sessions use, if they were installed */
export async function refreshInstalledTeam() {
  if (existsSync(INSTALL_DIR)) await installTeam();
}
