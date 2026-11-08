import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { findWorker } from "./agents.js";
import { SERVER_ROOT } from "./config.js";
import { bus } from "./events.js";
import { withWorkerSlot } from "./requests.js";
import { chat, type ChatMessage, type ChatPart } from "./llm.js";
import type { Attachment, WorkerChat, WorkerChatMessage, WorkerChatSummary, WorkerSettings } from "./protocol.js";
import type { Worker } from "./agents.js";

/** User's direct chats with workers. Stored as JSON under server/data/chats (in gitignore). */
const CHATS_DIR = path.join(SERVER_ROOT, "data", "chats");

const fileOf = (id: string) => {
  if (!/^[a-z0-9-]+$/i.test(id)) throw new Error("Invalid chat id");
  return path.join(CHATS_DIR, `${id}.json`);
};

export async function getChat(id: string): Promise<WorkerChat | undefined> {
  const file = fileOf(id);
  if (!existsSync(file)) return undefined;
  return JSON.parse(await readFile(file, "utf8"));
}

async function saveChat(c: WorkerChat) {
  await mkdir(CHATS_DIR, { recursive: true });
  await writeFile(fileOf(c.id), JSON.stringify(c, null, 2), "utf8");
}

export async function listChats(workerId: string): Promise<WorkerChatSummary[]> {
  if (!existsSync(CHATS_DIR)) return [];
  const files = (await readdir(CHATS_DIR)).filter((f) => f.endsWith(".json"));
  const chats = await Promise.all(files.map(async (f) => JSON.parse(await readFile(path.join(CHATS_DIR, f), "utf8")) as WorkerChat));
  return chats
    .filter((c) => c.workerId === workerId)
    .map(({ id, workerId: w, title, updatedAt, from }) => ({ id, workerId: w, title, updatedAt, from }))
    .sort((a, b) => b.updatedAt - a.updatedAt);
}

export async function deleteChat(id: string) {
  await rm(fileOf(id), { force: true });
}

/**
 * Saves a task Claude delegated (ask_worker / start_job) into the worker's history, so it can be read later
 * (and continued as a chat). File contents are not stored, only their names.
 */
export async function saveDelegatedTask(args: {
  workerId: string;
  task: string;
  files?: string[];
  label?: string;
  answer: string;
  reasoning?: string;
  usage?: WorkerChatMessage["usage"];
  model?: string;
  error?: boolean;
}) {
  const now = Date.now();
  const fileNote = args.files?.length ? `\n\nFiles: ${args.files.join(", ")}` : "";
  await saveChat({
    id: randomUUID(),
    workerId: args.workerId,
    title: args.task.split("\n")[0].slice(0, 60),
    updatedAt: now,
    from: { label: args.label },
    messages: [
      { role: "user", content: args.task + fileNote, at: now },
      { role: "assistant", content: args.answer, reasoning: args.reasoning || undefined, usage: args.usage, model: args.model, at: Date.now(), error: args.error },
    ],
  });
  bus.emit("chats", args.workerId);
}

const IMAGE_TYPES = new Set(["image/png", "image/jpeg", "image/gif", "image/webp"]);

/** Converts the user message with its attachments into API content parts */
function userContent(worker: Worker, m: WorkerChatMessage): string | ChatPart[] {
  if (!m.attachments?.length) return m.content;
  const parts: ChatPart[] = [];
  for (const a of m.attachments) {
    if (IMAGE_TYPES.has(a.mediaType)) {
      parts.push({ type: "image_url", image_url: { url: `data:${a.mediaType};base64,${a.data}` } });
    } else if (a.mediaType === "application/pdf") {
      if (worker.provider === "deepseek") parts.push({ type: "file", file: { file_data: `data:application/pdf;base64,${a.data}`, filename: a.name } });
      else parts.push({ type: "text", text: `[${a.name}: This model can't read PDFs]` });
    } else {
      parts.push({ type: "text", text: `<attachment name="${a.name}">\n${Buffer.from(a.data, "base64").toString("utf8")}\n</attachment>` });
    }
  }
  parts.push({ type: "text", text: m.content });
  return parts;
}

/** Sends the user's message to the worker, streams the reply and reasoning, and saves the chat. */
export async function sendToWorker(args: {
  workerId: string;
  chatId?: string;
  text: string;
  attachments?: Attachment[];
  settings?: WorkerSettings;
  signal?: AbortSignal;
  onStart: (chat: WorkerChat) => void;
  onToken: (chatId: string, text: string) => void;
  onReasoning: (chatId: string, text: string) => void;
}): Promise<{ chat: WorkerChat; message: WorkerChatMessage }> {
  const worker = await findWorker(args.workerId);
  if (!worker) throw new Error(`No such worker: ${args.workerId}`);
  const settings = args.settings ?? {};

  const existing = args.chatId ? await getChat(args.chatId) : undefined;
  const c: WorkerChat = existing ?? {
    id: args.chatId ?? randomUUID(),
    workerId: worker.id,
    title: (args.text || args.attachments?.[0]?.name || "Chat").slice(0, 60),
    updatedAt: Date.now(),
    messages: [],
  };
  c.messages.push({ role: "user", content: args.text, at: Date.now(), attachments: args.attachments?.length ? args.attachments : undefined });
  c.updatedAt = Date.now();
  await saveChat(c);
  args.onStart(c);

  const history: ChatMessage[] = [
    ...(worker.system?.trim() ? [{ role: "system" as const, content: worker.system.trim() }] : []),
    ...(settings.system?.trim() ? [{ role: "system" as const, content: settings.system.trim() }] : []),
    ...c.messages
      .filter((m) => !m.error)
      .map((m): ChatMessage => (m.role === "user" ? { role: "user", content: userContent(worker, m) } : { role: "assistant", content: m.content })),
  ];

  let message: WorkerChatMessage;
  let partial = "";
  let partialReasoning = "";
  const model = settings.model || worker.model;
  try {
    const task = args.text || "Checking attachment";
    const result = await withWorkerSlot(worker, { task, caller: { kind: "user", label: "You" }, signal: args.signal }, () => chat(worker, history, {
      signal: args.signal,
      model,
      // Local model is very slow when reasoning: off unless selected
      reasoning: settings.reasoning ?? (worker.local ? "none" : undefined),
      temperature: settings.temperature,
      json: settings.json,
      maxTokens: settings.maxTokens,
      onToken: (t) => {
        partial += t;
        args.onToken(c.id, t);
      },
      onReasoning: (t) => {
        partialReasoning += t;
        args.onReasoning(c.id, t);
      },
    }));
    message = {
      role: "assistant",
      content: result.content,
      reasoning: result.reasoning || undefined,
      usage: result.usage,
      model,
      at: Date.now(),
    };
  } catch (err) {
    const aborted = args.signal?.aborted;
    const reason = aborted ? "Stopped." : err instanceof Error ? err.message : String(err);
    message = {
      role: "assistant",
      content: partial ? `${partial}\n\n_(${reason})_` : reason,
      reasoning: partialReasoning || undefined,
      model,
      at: Date.now(),
      error: !partial,
    };
  }
  c.messages.push(message);
  c.updatedAt = Date.now();
  await saveChat(c);
  return { chat: c, message };
}
