import { copyFile, readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { z } from "zod";
import { SERVER_ROOT } from "./config.js";
import { TEAM_AGENTS } from "./team.js";

const WorkerSchema = z.object({
  id: z.string().regex(/^[a-z0-9-]+$/, "id may only contain lowercase letters, digits and hyphens"),
  name: z.string().min(1),
  provider: z.enum(["deepseek", "ollama", "claude"]),
  model: z.string().min(1),
  color: z.string().default("#888780"),
  description: z.string().default(""),
  /** if true, data never leaves the computer */
  local: z.boolean().default(false),
  /** Extra instructions for this worker's role (e.g. a QA reviewer); added to its system prompt */
  system: z.string().optional(),
});

const AgentsFileSchema = z.object({ workers: z.array(WorkerSchema) });

export type Worker = z.infer<typeof WorkerSchema>;

const AGENTS_PATH = path.join(SERVER_ROOT, "agents.json");
const EXAMPLE_PATH = path.join(SERVER_ROOT, "agents.example.json");

/**
 * Claude's own subagents. Claude starts them itself with the Agent tool (model: "haiku" or "sonnet"); they appear
 * in the office and their history like the other workers. Always present: an entry with the same id in agents.json
 * only changes how they look.
 */
const CLAUDE_WORKERS: Worker[] = [
  {
    id: "haiku",
    name: "Haiku",
    provider: "claude",
    model: "haiku",
    color: "#D97757",
    description: "Claude Haiku subagent on your subscription. Fast and light: searching and reading code, simple edits. Can read files and run commands.",
    local: false,
  },
  {
    id: "sonnet",
    name: "Sonnet",
    provider: "claude",
    model: "sonnet",
    color: "#B85C3C",
    description: "Claude Sonnet subagent on your subscription. Strong coder: changes across several files, running and fixing tests. Can read files and run commands.",
    local: false,
  },
  // The specialist team (agents/*.md): matched by the subagent's name, not its model
  {
    id: "reviewer",
    name: "Reviewer",
    provider: "claude",
    model: "opus",
    color: "#8B5CF6",
    description: "Specialist subagent. Reviews a finished change with fresh eyes and reports must-fix, should-fix and nits with a verdict. Read-only.",
    local: false,
  },
  {
    id: "test-writer",
    name: "Test writer",
    provider: "claude",
    model: "sonnet",
    color: "#10B981",
    description: "Specialist subagent. Writes tests for a change, runs them and reports what passes and fails. Only touches test files.",
    local: false,
  },
  {
    id: "qa-tester",
    name: "QA tester",
    provider: "claude",
    model: "sonnet",
    color: "#EAB308",
    description: "Specialist subagent. Runs the QA sweep and explorer on a running UI, checks every finding on its screenshot and reports only real problems.",
    local: false,
  },
  {
    id: "docs-writer",
    name: "Docs writer",
    provider: "claude",
    model: "sonnet",
    color: "#06B6D4",
    description: "Specialist subagent. Updates README and docs after a change is done. Only touches documentation files.",
    local: false,
  },
  {
    id: "security-reviewer",
    name: "Security",
    provider: "claude",
    model: "sonnet",
    color: "#EF4444",
    description: "Specialist subagent with the security-audit skill. Reviews changes that touch input, auth, files, shell, network or secrets. Read-only.",
    local: false,
  },
];

/** Reads agents.json. Creates it from the example file if missing. Read from disk on every call, so a worker added via the UI appears immediately. */
export async function loadWorkers(): Promise<Worker[]> {
  if (!existsSync(AGENTS_PATH)) await copyFile(EXAMPLE_PATH, AGENTS_PATH);
  const raw = JSON.parse(await readFile(AGENTS_PATH, "utf8"));
  const workers = AgentsFileSchema.parse(raw).workers;
  // A specialist shows the model it runs on now (Settings → Team models), not the one it was saved with
  return [...workers, ...CLAUDE_WORKERS.filter((c) => !workers.some((w) => w.id === c.id))].map((w) =>
    w.provider === "claude" && TEAM_AGENTS[w.id]?.model ? { ...w, model: TEAM_AGENTS[w.id].model! } : w,
  );
}

export async function saveWorkers(workers: Worker[]): Promise<void> {
  const data = AgentsFileSchema.parse({ workers });
  await writeFile(AGENTS_PATH, JSON.stringify(data, null, 2) + "\n", "utf8");
}

export async function findWorker(id: string): Promise<Worker | undefined> {
  return (await loadWorkers()).find((w) => w.id === id);
}
