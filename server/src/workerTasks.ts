import { readFile } from "node:fs/promises";
import path from "node:path";
import type { Worker } from "./agents.js";
import { chat } from "./llm.js";
import type { WorkerCaller } from "./protocol.js";
import { withWorkerSlot } from "./requests.js";

/** Total character limit for files sent to the worker (cost safety). */
const MAX_FILE_CHARS = 200_000;

const WORKER_SYSTEM_PROMPT =
  "You are a worker model in a software team. The boss (Claude) assigns the task and will review your answer." +
  "Do only the requested work and answer briefly and clearly. If code is requested, write complete, working code and state which file it belongs to.";

/** Reads files without leaving the project folder and combines them into a single text. */
async function readProjectFiles(cwd: string, files: string[]): Promise<string> {
  let total = 0;
  const parts: string[] = [];
  for (const file of files) {
    const abs = path.resolve(cwd, file);
    const rel = path.relative(cwd, abs);
    if (rel.startsWith("..") || path.isAbsolute(rel)) {
      throw new Error(`Cannot send a file outside the project folder: ${file}`);
    }
    const content = await readFile(abs, "utf8");
    total += content.length;
    if (total > MAX_FILE_CHARS) {
      throw new Error(`Files are too large: total limit ${MAX_FILE_CHARS} characters.`);
    }
    parts.push(`### ${rel.replaceAll("\\", "/")}\n\`\`\`\n${content}\n\`\`\``);
  }
  return parts.join("\n\n");
}

/** Has the worker perform a task delegated by Claude. The request appears as a separate worker copy in the 3D office. */
export async function runWorkerTask(args: {
  worker: Worker;
  task: string;
  files?: string[];
  /** folder that the files paths are relative to */
  cwd?: string;
  caller: WorkerCaller;
  signal?: AbortSignal;
}): Promise<string> {
  const { worker, task, files, cwd, signal } = args;
  if (files?.length && !cwd) throw new Error("To send files, provide project_dir (the full path to the project folder).");
  return withWorkerSlot(worker, { task, caller: args.caller, signal }, async () => {
    const fileText = files?.length && cwd ? await readProjectFiles(cwd, files) : "";
    const userContent = fileText ? `${task}\n\n## Files\n\n${fileText}` : task;
    const { content: answer } = await chat(
      worker,
      [
        { role: "system", content: WORKER_SYSTEM_PROMPT },
        { role: "user", content: userContent },
      ],
      // Local model is small and slow: reasoning is off for the short tasks Claude assigns (it takes minutes when on)
      { signal, reasoning: worker.local ? "none" : undefined },
    );
    return answer || "(worker returned an empty response)";
  }).catch((err) => {
    throw new Error(`${worker.name} failed: ${err instanceof Error ? err.message : String(err)}`);
  });
}
