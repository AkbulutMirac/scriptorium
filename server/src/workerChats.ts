import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { findWorker } from "./agents.js";
import { SERVER_ROOT } from "./config.js";
import { reportActivity } from "./events.js";
import { chat, type ChatMessage, type ChatPart } from "./llm.js";
import type { Attachment, WorkerChat, WorkerChatMessage, WorkerChatSummary, WorkerSettings } from "./protocol.js";
import type { Worker } from "./agents.js";

/** Kullanıcının işçilerle doğrudan sohbetleri. server/data/chats altında JSON olarak durur (gitignore'da). */
const CHATS_DIR = path.join(SERVER_ROOT, "data", "chats");

const fileOf = (id: string) => {
  if (!/^[a-z0-9-]+$/i.test(id)) throw new Error("Geçersiz sohbet id'si");
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
    .map(({ id, workerId: w, title, updatedAt }) => ({ id, workerId: w, title, updatedAt }))
    .sort((a, b) => b.updatedAt - a.updatedAt);
}

export async function deleteChat(id: string) {
  await rm(fileOf(id), { force: true });
}

const IMAGE_TYPES = new Set(["image/png", "image/jpeg", "image/gif", "image/webp"]);

/** Kullanıcı mesajını ekleriyle birlikte API içerik parçalarına çevirir */
function userContent(worker: Worker, m: WorkerChatMessage): string | ChatPart[] {
  if (!m.attachments?.length) return m.content;
  const parts: ChatPart[] = [];
  for (const a of m.attachments) {
    if (IMAGE_TYPES.has(a.mediaType)) {
      parts.push({ type: "image_url", image_url: { url: `data:${a.mediaType};base64,${a.data}` } });
    } else if (a.mediaType === "application/pdf") {
      if (worker.provider === "deepseek") parts.push({ type: "file", file: { file_data: `data:application/pdf;base64,${a.data}`, filename: a.name } });
      else parts.push({ type: "text", text: `[${a.name}: PDF bu modelde okunamıyor]` });
    } else {
      parts.push({ type: "text", text: `<ek-dosya ad="${a.name}">\n${Buffer.from(a.data, "base64").toString("utf8")}\n</ek-dosya>` });
    }
  }
  parts.push({ type: "text", text: m.content });
  return parts;
}

/** Kullanıcının mesajını işçiye gönderir, cevabı ve düşünceyi akış halinde iletir, sohbeti kaydeder. */
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
  if (!worker) throw new Error(`Böyle bir işçi yok: ${args.workerId}`);
  const settings = args.settings ?? {};

  const existing = args.chatId ? await getChat(args.chatId) : undefined;
  const c: WorkerChat = existing ?? {
    id: args.chatId ?? randomUUID(),
    workerId: worker.id,
    title: (args.text || args.attachments?.[0]?.name || "Sohbet").slice(0, 60),
    updatedAt: Date.now(),
    messages: [],
  };
  c.messages.push({ role: "user", content: args.text, at: Date.now(), attachments: args.attachments?.length ? args.attachments : undefined });
  c.updatedAt = Date.now();
  await saveChat(c);
  args.onStart(c);

  const history: ChatMessage[] = [
    ...(settings.system?.trim() ? [{ role: "system" as const, content: settings.system.trim() }] : []),
    ...c.messages
      .filter((m) => !m.error)
      .map((m): ChatMessage => (m.role === "user" ? { role: "user", content: userContent(worker, m) } : { role: "assistant", content: m.content })),
  ];

  reportActivity({ agentId: worker.id, status: "working", task: args.text || "Ek dosyaya bakıyor", by: "user" });
  let message: WorkerChatMessage;
  let partial = "";
  let partialReasoning = "";
  const model = settings.model || worker.model;
  try {
    const result = await chat(worker, history, {
      signal: args.signal,
      model,
      reasoning: settings.reasoning,
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
    });
    message = {
      role: "assistant",
      content: result.content,
      reasoning: result.reasoning || undefined,
      usage: result.usage,
      model,
      at: Date.now(),
    };
    reportActivity({ agentId: worker.id, status: "idle" });
  } catch (err) {
    const aborted = args.signal?.aborted;
    const reason = aborted ? "Durduruldu." : err instanceof Error ? err.message : String(err);
    message = {
      role: "assistant",
      content: partial ? `${partial}\n\n_(${reason})_` : reason,
      reasoning: partialReasoning || undefined,
      model,
      at: Date.now(),
      error: !partial,
    };
    reportActivity(aborted ? { agentId: worker.id, status: "idle" } : { agentId: worker.id, status: "error", error: reason });
  }
  c.messages.push(message);
  c.updatedAt = Date.now();
  await saveChat(c);
  return { chat: c, message };
}
