import { copyFile, readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { z } from "zod";
import { SERVER_ROOT } from "./config.js";

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
];

/** Reads agents.json. Creates it from the example file if missing. Read from disk on every call, so a worker added via the UI appears immediately. */
export async function loadWorkers(): Promise<Worker[]> {
  if (!existsSync(AGENTS_PATH)) await copyFile(EXAMPLE_PATH, AGENTS_PATH);
  const raw = JSON.parse(await readFile(AGENTS_PATH, "utf8"));
  const workers = AgentsFileSchema.parse(raw).workers;
  return [...workers, ...CLAUDE_WORKERS.filter((c) => !workers.some((w) => w.id === c.id))];
}

export async function saveWorkers(workers: Worker[]): Promise<void> {
  const data = AgentsFileSchema.parse({ workers });
  await writeFile(AGENTS_PATH, JSON.stringify(data, null, 2) + "\n", "utf8");
}

export async function findWorker(id: string): Promise<Worker | undefined> {
  return (await loadWorkers()).find((w) => w.id === id);
}
