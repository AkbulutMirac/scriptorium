import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import type { Worker } from "./agents.js";
import { chat, supportsVision, type ChatPart } from "./llm.js";
import type { WorkerCaller } from "./protocol.js";
import { withWorkerSlot } from "./requests.js";
import { saveDelegatedTask } from "./workerChats.js";

/** Total character limit for files sent to the worker (cost safety). */
const MAX_FILE_CHARS = 200_000;

const WORKER_SYSTEM_PROMPT =
  "You are a worker model in a software team. The boss (Claude) assigns the task and will review your answer. " +
  "Do only the requested work and answer briefly and clearly. If code is requested, write complete, working code and state which file it belongs to.";

const IMAGE_TYPES: Record<string, string> = { ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".webp": "image/webp", ".gif": "image/gif" };
const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
const MAX_IMAGES = 8;

/**
 * Reads the files for a task. Text files must be inside the project folder and are combined into one text.
 * Images (screenshots for a UI review) may come from anywhere, since screenshots usually live in a temp folder.
 */
async function readTaskFiles(cwd: string | undefined, files: string[]): Promise<{ text: string; images: ChatPart[] }> {
  let total = 0;
  const parts: string[] = [];
  const images: ChatPart[] = [];
  for (const file of files) {
    const mime = IMAGE_TYPES[path.extname(file).toLowerCase()];
    if (mime) {
      if (images.length >= MAX_IMAGES) throw new Error(`At most ${MAX_IMAGES} images per task.`);
      const abs = cwd ? path.resolve(cwd, file) : path.resolve(file);
      const data = await readFile(abs);
      if (data.length > MAX_IMAGE_BYTES) throw new Error(`Image is too large (max 5 MB): ${file}`);
      images.push({ type: "image_url", image_url: { url: `data:${mime};base64,${data.toString("base64")}` } });
      parts.push(`### ${path.basename(file)} (image attached)`);
      continue;
    }
    if (!cwd) throw new Error("To send files, provide project_dir (the full path to the project folder).");
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
  return { text: parts.join("\n\n"), images };
}

/**
 * Thinking level for tasks Claude delegates to DeepSeek. DeepSeek only has low, high and max ("medium" means
 * high), and its own default is high: on a clear spec that spent about 90% of the output on thinking and took
 * minutes per file. Claude can ask for more with the tools' `thinking` argument.
 */
const DELEGATED_THINKING = "low";

/** Where an output_file goes: it must be inside the project folder */
function resolveOutput(cwd: string | undefined, file: string): { abs: string; rel: string } {
  if (!cwd) throw new Error("To write a file, provide project_dir (the full path to the project folder).");
  const abs = path.resolve(cwd, file);
  const rel = path.relative(cwd, abs);
  if (rel.startsWith("..") || path.isAbsolute(rel)) throw new Error(`Cannot write a file outside the project folder: ${file}`);
  return { abs, rel: rel.replaceAll("\\", "/") };
}

/** Removes one markdown code fence around the whole answer, which models add out of habit */
function stripFence(text: string): string {
  const m = /^\s*```[\w.+-]*\n([\s\S]*?)\n```\s*$/.exec(text);
  return m ? m[1] : text.replace(/^\s+/, "");
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
  /**
   * If set, the answer is written to this file (relative to cwd) instead of being returned. Claude then only
   * reviews the file, so it doesn't have to type the code out again itself.
   */
  outputFile?: string;
  /** How hard a DeepSeek worker thinks (see DELEGATED_THINKING). Local workers never think on delegated tasks. */
  thinking?: "low" | "high" | "max";
}): Promise<string> {
  const { worker, files, cwd, signal } = args;
  const target = args.outputFile ? resolveOutput(cwd, args.outputFile) : undefined;
  const task = target
    ? `${args.task}\n\nYour reply is saved as-is as the complete content of the file \`${target.rel}\`. Reply with only that file's content: no explanations before or after it and no markdown code fences.`
    : args.task;
  return withWorkerSlot(worker, { task: args.task, caller: args.caller, signal }, async () => {
    const { text: fileText, images } = files?.length ? await readTaskFiles(cwd, files) : { text: "", images: [] };
    // A model without vision would silently ignore the images and review nothing
    if (images.length && !(await supportsVision(worker))) {
      throw new Error(`${worker.model} can't read images. Send screenshots to a worker with vision (list_workers shows "vision": true), e.g. deepseek or qa.`);
    }
    const text = fileText ? `${task}\n\n## Files\n\n${fileText}` : task;
    const userContent: string | ChatPart[] = images.length ? [{ type: "text", text }, ...images] : text;
    // A worker can have its own role on top of the shared instructions (for example a QA reviewer)
    const system = worker.system?.trim() ? `${WORKER_SYSTEM_PROMPT}\n\n${worker.system.trim()}` : WORKER_SYSTEM_PROMPT;
    const result = await chat(
      worker,
      [
        { role: "system", content: system },
        { role: "user", content: userContent },
      ],
      // Local model is small and slow: reasoning is off for the short tasks Claude assigns (it takes minutes when on)
      { signal, reasoning: worker.local ? "none" : (args.thinking ?? (worker.provider === "deepseek" ? DELEGATED_THINKING : undefined)) },
    );
    if (!result.content.trim()) {
      // Say why instead of handing back an empty answer that looks like a result
      throw new Error(
        result.reasoning
          ? "ran out of output tokens while thinking and gave no answer. Split the task into smaller parts or raise WORKER_MAX_TOKENS."
          : "returned an empty answer. Try again or use another worker.",
      );
    }
    const answer = target ? stripFence(result.content) : result.content;
    // Keep a copy in the worker's history (the task and the answer, not the file contents)
    await saveDelegatedTask({
      workerId: worker.id,
      task,
      files,
      label: args.caller.label,
      answer,
      reasoning: result.reasoning,
      usage: result.usage,
      model: worker.model,
    }).catch(() => {});
    if (target) {
      await mkdir(path.dirname(target.abs), { recursive: true });
      await writeFile(target.abs, answer.endsWith("\n") ? answer : `${answer}\n`, "utf8");
      const lines = answer.split("\n").length;
      return `${worker.name} wrote ${lines} lines to ${target.rel}. The content isn't repeated here: read the file or run git diff to review it, then test it.`;
    }
    return answer;
  }).catch(async (err) => {
    const message = err instanceof Error ? err.message : String(err);
    if (!signal?.aborted) {
      await saveDelegatedTask({ workerId: worker.id, task, files, label: args.caller.label, answer: message, model: worker.model, error: true }).catch(() => {});
    }
    throw new Error(`${worker.name} failed: ${message}`);
  });
}
