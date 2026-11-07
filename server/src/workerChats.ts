import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { findWorker } from "./agents.js";
import { SERVER_ROOT } from "./config.js";
import { reportActivity } from "./events.js";
import { chat } from "./llm.js";
import type { WorkerChat, WorkerChatMessage, WorkerChatSummary } from "./protocol.js";

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

/** Kullanıcının mesajını işçiye gönderir, cevabı akış halinde iletir, sohbeti kaydeder. */
export async function sendToWorker(args: {
  workerId: string;
  chatId?: string;
  text: string;
  signal?: AbortSignal;
  onStart: (chat: WorkerChat) => void;
  onToken: (chatId: string, text: string) => void;
}): Promise<{ chat: WorkerChat; message: WorkerChatMessage }> {
  const worker = await findWorker(args.workerId);
  if (!worker) throw new Error(`Böyle bir işçi yok: ${args.workerId}`);

  const existing = args.chatId ? await getChat(args.chatId) : undefined;
  const c: WorkerChat = existing ?? {
    id: args.chatId ?? randomUUID(),
    workerId: worker.id,
    title: args.text.slice(0, 60),
    updatedAt: Date.now(),
    messages: [],
  };
  c.messages.push({ role: "user", content: args.text, at: Date.now() });
  c.updatedAt = Date.now();
  await saveChat(c);
  args.onStart(c);

  reportActivity({ agentId: worker.id, status: "working", task: args.text, by: "user" });
  let message: WorkerChatMessage;
  let partial = "";
  try {
    const answer = await chat(
      worker,
      c.messages.filter((m) => !m.error).map((m) => ({ role: m.role, content: m.content })),
      {
        signal: args.signal,
        onToken: (t) => {
          partial += t;
          args.onToken(c.id, t);
        },
      },
    );
    message = { role: "assistant", content: answer, at: Date.now() };
    reportActivity({ agentId: worker.id, status: "idle" });
  } catch (err) {
    const aborted = args.signal?.aborted;
    const reason = aborted ? "Durduruldu." : err instanceof Error ? err.message : String(err);
    message = { role: "assistant", content: partial ? `${partial}\n\n_(${reason})_` : reason, at: Date.now(), error: !partial };
    reportActivity(aborted ? { agentId: worker.id, status: "idle" } : { agentId: worker.id, status: "error", error: reason });
  }
  c.messages.push(message);
  c.updatedAt = Date.now();
  await saveChat(c);
  return { chat: c, message };
}
