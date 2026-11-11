import { execFile, spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { appendFile, readFile, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { config, SERVER_ROOT } from "./config.js";
import { deepseekBalance, listModels } from "./llm.js";
import type { SetupStatus } from "./protocol.js";
import { teamInstalled } from "./team.js";
import { WORKER_SERVER_NAME } from "./workerTools.js";

/**
 * Initial setup: Claude login, DeepSeek key, Ollama models, for all Claude Code sessions
 * registration and CLAUDE.md rules. All done from the Setup window in the UI.
 */

const run = promisify(execFile);
const REPO_ROOT = path.resolve(SERVER_ROOT, "..");
const ENV_PATH = path.join(REPO_ROOT, ".env");
const RULES_PATH = path.join(REPO_ROOT, "docs", "CLAUDE-workers.md");
// Older installs added a Turkish section; either heading means the rules are already there
const RULES_MARKERS = ["## Scriptorium helpers", "## Scriptorium workers", "## Scriptorium işçileri"];
const GLOBAL_CLAUDE_MD = path.join(os.homedir(), ".claude", "CLAUDE.md");
const GLOBAL_SETTINGS = path.join(os.homedir(), ".claude", "settings.json");

/**
 * The Claude Code program to use: CLAUDE_CODE_PATH from .env, otherwise the bundled version shipped with the SDK.
 * The user doesn't need to install Claude Code separately; login credentials are shared by both (~/.claude).
 */
function claudeCli(): { path: string; source: "installed" | "bundled" } | undefined {
  if (config.claudeCodePath && existsSync(config.claudeCodePath)) return { path: config.claudeCodePath, source: "installed" };
  try {
    const require = createRequire(import.meta.url);
    const pkg = require.resolve(`@anthropic-ai/claude-agent-sdk-${process.platform}-${process.arch}/package.json`);
    const exe = path.join(path.dirname(pkg), process.platform === "win32" ? "claude.exe" : "claude");
    if (existsSync(exe)) return { path: exe, source: "bundled" };
  } catch {
    /* no package for this platform */
  }
  return undefined;
}

async function claudeStatus(): Promise<SetupStatus["claude"]> {
  const cli = claudeCli();
  if (!cli) return { found: false, loggedIn: false };
  try {
    const { stdout } = await run(cli.path, ["auth", "status", "--json"], { timeout: 20_000, windowsHide: true });
    const s = JSON.parse(stdout) as { loggedIn?: boolean; email?: string; authMethod?: string; subscriptionType?: string };
    return { found: true, cliSource: cli.source, loggedIn: !!s.loggedIn, email: s.email, authMethod: s.authMethod };
  } catch (err) {
    // When not logged in, some versions exit with an error code but still write JSON
    const out = (err as { stdout?: string }).stdout;
    try {
      const s = JSON.parse(out ?? "") as { loggedIn?: boolean };
      return { found: true, cliSource: cli.source, loggedIn: !!s.loggedIn };
    } catch {
      return { found: true, cliSource: cli.source, loggedIn: false, error: err instanceof Error ? err.message : String(err) };
    }
  }
}

/** Opens the Anthropic login page in the browser. Once login completes, Claude Code closes on its own. */
export function claudeLogin() {
  const cli = claudeCli();
  if (!cli) throw new Error("Claude Code not found. Run npm install in the project folder.");
  spawn(cli.path, ["auth", "login", "--claudeai"], { detached: true, stdio: "ignore", windowsHide: true }).unref();
}

async function mcpRegistered(): Promise<boolean> {
  const cli = claudeCli();
  if (!cli) return false;
  try {
    await run(cli.path, ["mcp", "get", WORKER_SERVER_NAME], { timeout: 20_000, windowsHide: true });
    return true;
  } catch {
    return false;
  }
}

/** Adds the worker tools to all Claude Code sessions in the terminal and the desktop app */
export async function registerMcp() {
  const cli = claudeCli();
  if (!cli) throw new Error("Claude Code not found.");
  const url = `http://127.0.0.1:${config.port}/mcp`;
  await run(cli.path, ["mcp", "add", "--scope", "user", "--transport", "http", WORKER_SERVER_NAME, url], { timeout: 30_000, windowsHide: true });
}

async function rulesInstalled(): Promise<boolean> {
  const text = await readFile(GLOBAL_CLAUDE_MD, "utf8").catch(() => "");
  return RULES_MARKERS.some((m) => text.includes(m));
}

/** Appends the rules explaining when Claude should hand off work to the end of ~/.claude/CLAUDE.md (leaves it alone if already present) */
export async function installRules() {
  if (await rulesInstalled()) return;
  const rules = await readFile(RULES_PATH, "utf8");
  const existing = await readFile(GLOBAL_CLAUDE_MD, "utf8").catch(() => "");
  await appendFile(GLOBAL_CLAUDE_MD, `${existing && !existing.endsWith("\n") ? "\n" : ""}\n${rules}`, "utf8");
}

const hookUrl = () => `http://127.0.0.1:${config.port}/hooks`;
/**
 * The events that ask subagents of other Claude Code sessions for a report and show Haiku and Sonnet ones in the
 * office, and pass the user's latest message on to the builder
 */
const HOOK_EVENTS: [event: string, matcher?: string][] = [
  ["PreToolUse", "Agent|Task|mcp__scriptorium__build"],
  ["PostToolUse", "Agent|Task"],
  ["PostToolUseFailure", "Agent|Task"],
  ["SubagentStop"],
  ["UserPromptSubmit"],
];

type HookEntry = { matcher?: string; hooks?: { type?: string; url?: string }[] };
type SettingsFile = { hooks?: Record<string, HookEntry[]> } & Record<string, unknown>;

async function readSettings(): Promise<SettingsFile> {
  const text = await readFile(GLOBAL_SETTINGS, "utf8").catch(() => "");
  return text.trim() ? JSON.parse(text) : {};
}

const ours = (e: HookEntry) => !!e.hooks?.some((h) => h.url === hookUrl());
const hasOurHook = (settings: SettingsFile, event: string, matcher?: string) => !!settings.hooks?.[event]?.some((e) => ours(e) && e.matcher === matcher);

async function hooksInstalled(): Promise<boolean> {
  const settings = await readSettings().catch(() => ({}) as SettingsFile);
  return HOOK_EVENTS.every(([event, matcher]) => hasOurHook(settings, event, matcher));
}

/**
 * Adds HTTP hooks to ~/.claude/settings.json so other Claude Code sessions report their Haiku/Sonnet subagents.
 * While Scriptorium is closed the request fails at once and Claude Code carries on.
 */
export async function installHooks() {
  if (await hooksInstalled()) return;
  const settings = await readSettings();
  settings.hooks ??= {};
  for (const [event, matcher] of HOOK_EVENTS) {
    if (hasOurHook(settings, event, matcher)) continue;
    // An entry from an older Scriptorium with another matcher is replaced
    settings.hooks[event] = (settings.hooks[event] ?? []).filter((e) => !ours(e));
    settings.hooks[event].push({ ...(matcher ? { matcher } : {}), hooks: [{ type: "http", url: hookUrl(), timeout: 5 } as never] });
  }
  await writeFile(GLOBAL_SETTINGS, JSON.stringify(settings, null, 2) + "\n", "utf8");
}

/** Updates or adds a value in the .env file. Creates .env from the example file if it doesn't exist. */
async function setEnv(key: string, value: string) {
  let text = existsSync(ENV_PATH)
    ? await readFile(ENV_PATH, "utf8")
    : await readFile(path.join(REPO_ROOT, ".env.example"), "utf8").catch(() => "");
  const line = `${key}=${value}`;
  const re = new RegExp(`^${key}=.*$`, "m");
  text = re.test(text) ? text.replace(re, line) : `${text}${text && !text.endsWith("\n") ? "\n" : ""}${line}\n`;
  await writeFile(ENV_PATH, text, "utf8");
}

/** Tests the DeepSeek key with a balance query first, writes it to .env if it works. The key is never sent back to the UI. */
export async function saveDeepseekKey(key: string) {
  const k = key.trim();
  if (!/^sk-[A-Za-z0-9_-]{16,200}$/.test(k)) throw new Error("Key must start with \"sk-\" and contain no spaces.");
  const previous = config.deepseekApiKey;
  config.deepseekApiKey = k;
  const balance = await deepseekBalance();
  if (!balance.ok) {
    config.deepseekApiKey = previous;
    throw new Error(`DeepSeek rejected the key: ${balance.error}`);
  }
  await setEnv("DEEPSEEK_API_KEY", k);
}

async function ollamaStatus(): Promise<SetupStatus["ollama"]> {
  const models = await listModels({ id: "_", name: "_", provider: "ollama", model: "_", color: "", description: "", local: true });
  const root = config.ollamaBaseUrl.replace(/\/v1\/?$/, "");
  const running = await fetch(`${root}/api/version`, { signal: AbortSignal.timeout(1500) })
    .then((r) => r.ok)
    .catch(() => false);
  return { running, models };
}

export async function setupStatus(): Promise<SetupStatus> {
  const [claude, ollama, mcp, rules, hooks, agents] = await Promise.all([
    claudeStatus(),
    ollamaStatus(),
    mcpRegistered(),
    rulesInstalled(),
    hooksInstalled(),
    teamInstalled(),
  ]);
  return { claude, deepseek: { configured: !!config.deepseekApiKey }, ollama, mcp, rules, hooks, agents };
}
