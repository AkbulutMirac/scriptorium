/**
 * Scriptorium arka ucu: arayüzü sunar, WebSocket üzerinden Claude oturumlarını ve işçileri yönetir.
 * Sadece bu bilgisayardan erişilebilir (127.0.0.1) ve sadece kendi arayüzümüzün bağlanmasına izin verir.
 */
import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { readFile, stat } from "node:fs/promises";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import path from "node:path";
import {
  deleteSession,
  getSessionMessages,
  listSessions,
  renameSession,
  type PermissionResult,
  type PermissionUpdate,
} from "@anthropic-ai/claude-agent-sdk";
import { WebSocket, WebSocketServer } from "ws";
import { loadWorkers, saveWorkers } from "./agents.js";
import { ClaudeSession } from "./claude.js";
import { config, SERVER_ROOT } from "./config.js";
import { bus, reportActivity } from "./events.js";
import { listJobs } from "./jobs.js";
import { gitDiff, gitInfo } from "./git.js";
import { isAvailable } from "./llm.js";
import type { AgentActivity, ClientMsg, ServerMsg, WorkerInfo } from "./protocol.js";
import { deleteChat, getChat, listChats, sendToWorker } from "./workerChats.js";

const HOST = "127.0.0.1";
const WEB_DIST = path.resolve(SERVER_ROOT, "../web/dist");
/** Bağlanmasına izin verilen arayüz adresleri: derlenmiş arayüz ve Vite geliştirme sunucusu. */
const ALLOWED_ORIGINS = new Set([
  `http://localhost:${config.port}`,
  `http://127.0.0.1:${config.port}`,
  "http://localhost:5173",
  "http://127.0.0.1:5173",
]);

// ─── Yayın ─────────────────────────────────────────────────────────────────────

const clients = new Set<WebSocket>();

function broadcast(msg: ServerMsg) {
  const data = JSON.stringify(msg);
  for (const ws of clients) if (ws.readyState === WebSocket.OPEN) ws.send(data);
}

function reply(ws: WebSocket, msg: ServerMsg) {
  if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(msg));
}

/** Her ajanın son durumu: arayüz yeniden bağlanınca 3D sahne doğru başlasın diye. */
const lastActivity = new Map<string, AgentActivity>();
bus.on("activity", (a) => {
  lastActivity.set(a.agentId, a);
  broadcast({ type: "activity", activity: a });
});
bus.on("jobs", () => broadcast({ type: "jobs", jobs: listJobs() }));

// ─── Claude oturumları ─────────────────────────────────────────────────────────

type ChatState = {
  session: ClaudeSession;
  cwd: string;
  dirs: string[];
  busy: boolean;
  task?: string;
  announcedSessionId?: string;
};

const chats = new Map<string, ChatState>();

type Pending = {
  chatId: string;
  input: Record<string, unknown>;
  suggestions?: PermissionUpdate[];
  resolve: (r: PermissionResult) => void;
};
const pending = new Map<string, Pending>();

function updateClaudeActivity() {
  const busy = [...chats.values()].find((c) => c.busy);
  reportActivity(busy ? { agentId: "claude", status: "working", task: busy.task } : { agentId: "claude", status: "idle" });
}

function denyPendingOf(chatId: string, message: string) {
  for (const [id, p] of pending) {
    if (p.chatId !== chatId) continue;
    pending.delete(id);
    p.resolve({ behavior: "deny", message });
    broadcast({ type: "claude.permissionResolved", requestId: id });
  }
}

function openChat(chatId: string, opts: { resume?: string; fork?: boolean; cwd?: string; additionalDirectories?: string[] }) {
  const existing = chats.get(chatId);
  if (existing) {
    // Sayfa yenilendi: aynı oturuma yeniden bağlan
    if (existing.session.sessionId) broadcast({ type: "claude.session", chatId, sessionId: existing.session.sessionId });
    broadcast({ type: "claude.busy", chatId, busy: existing.busy });
    return;
  }

  const cwd = opts.cwd || config.claudeCwd;
  const state = { cwd, dirs: opts.additionalDirectories ?? [], busy: false } as ChatState;

  state.session = new ClaudeSession({
    cwd,
    resume: opts.resume,
    fork: opts.fork,
    additionalDirectories: state.dirs,
    onMessage: (message) => {
      broadcast({ type: "claude.message", chatId, message });
      const sid = state.session.sessionId;
      if (sid && sid !== state.announcedSessionId) {
        state.announcedSessionId = sid;
        broadcast({ type: "claude.session", chatId, sessionId: sid });
      }
      if (message.type === "result") {
        state.busy = false;
        broadcast({ type: "claude.busy", chatId, busy: false });
        updateClaudeActivity();
      }
    },
    canUseTool: (toolName, input, { signal, suggestions, title, description }) =>
      new Promise<PermissionResult>((resolve) => {
        const requestId = randomUUID();
        pending.set(requestId, { chatId, input, suggestions, resolve });
        broadcast({
          type: "claude.permissionRequest",
          chatId,
          requestId,
          toolName,
          input,
          title,
          description,
          canAlwaysAllow: !!suggestions?.length,
        });
        signal.addEventListener("abort", () => {
          if (!pending.delete(requestId)) return;
          broadcast({ type: "claude.permissionResolved", requestId });
          resolve({ behavior: "deny", message: "İstek iptal edildi." });
        });
      }),
  });
  chats.set(chatId, state);

  state.session.done
    .then(() => broadcast({ type: "claude.closed", chatId }))
    .catch((err) => broadcast({ type: "claude.closed", chatId, error: err instanceof Error ? err.message : String(err) }))
    .finally(() => {
      if (chats.get(chatId) === state) chats.delete(chatId);
      denyPendingOf(chatId, "Oturum kapandı.");
      updateClaudeActivity();
    });
}

function chatOrThrow(chatId: string): ChatState {
  const c = chats.get(chatId);
  if (!c) throw new Error("Bu sohbet açık değil. Sayfayı yenileyip tekrar dene.");
  return c;
}

// ─── İşçiler ───────────────────────────────────────────────────────────────────

async function workersWithAvailability(): Promise<WorkerInfo[]> {
  const workers = await loadWorkers();
  return Promise.all(workers.map(async (w) => ({ ...w, available: await isAvailable(w) })));
}

const workerAborts = new Map<string, AbortController>();

// ─── Mesaj işleyici ───────────────────────────────────────────────────────────

async function handle(ws: WebSocket, msg: ClientMsg) {
  switch (msg.type) {
    case "claude.open":
      return openChat(msg.chatId, msg);

    case "claude.send": {
      const c = chatOrThrow(msg.chatId);
      c.busy = true;
      c.task = msg.text.slice(0, 120);
      broadcast({ type: "claude.busy", chatId: msg.chatId, busy: true });
      updateClaudeActivity();
      return c.session.send(msg.text, msg.attachments);
    }

    case "claude.info": {
      const c = chats.get(msg.chatId);
      if (!c) return;
      return reply(ws, { type: "claude.info", ...(await c.session.info(msg.chatId)) });
    }

    case "claude.setDirs": {
      const dirs: string[] = [];
      for (const d of msg.dirs) {
        const ok = await stat(d).then((st) => st.isDirectory()).catch(() => false);
        if (!ok) throw new Error(`Klasör bulunamadı: ${d}`);
        dirs.push(d);
      }
      const c = chats.get(msg.chatId);
      if (c) {
        if (c.busy) throw new Error("Claude çalışırken klasör eklenemez. Bitmesini bekle.");
        // Ek klasörler oturum açılırken verilir: oturumu kaldığı yerden yeni klasörlerle yeniden aç
        const sessionId = c.session.sessionId;
        chats.delete(msg.chatId);
        c.session.close();
        openChat(msg.chatId, { resume: sessionId, cwd: c.cwd, additionalDirectories: dirs });
      }
      return broadcast({ type: "claude.dirs", chatId: msg.chatId, dirs });
    }

    case "claude.mcpToggle":
      await chatOrThrow(msg.chatId).session.toggleMcp(msg.server, msg.enabled);
      return reply(ws, { type: "claude.info", ...(await chatOrThrow(msg.chatId).session.info(msg.chatId)) });

    case "claude.mcpReconnect":
      await chatOrThrow(msg.chatId).session.reconnectMcp(msg.server);
      return reply(ws, { type: "claude.info", ...(await chatOrThrow(msg.chatId).session.info(msg.chatId)) });

    case "claude.stopTask":
      return chatOrThrow(msg.chatId).session.stopTask(msg.taskId);

    case "git.info":
      return reply(ws, { type: "git.info", ...(await gitInfo(msg.cwd)) });

    case "git.diff":
      return reply(ws, { type: "git.diff", cwd: msg.cwd, file: msg.file, diff: await gitDiff(msg.cwd, msg.file) });

    case "claude.interrupt": {
      const c = chatOrThrow(msg.chatId);
      denyPendingOf(msg.chatId, "Kullanıcı durdurdu.");
      await c.session.interrupt();
      return;
    }

    case "claude.close": {
      const c = chats.get(msg.chatId);
      if (!c) return;
      chats.delete(msg.chatId);
      denyPendingOf(msg.chatId, "Oturum kapandı.");
      c.session.close();
      updateClaudeActivity();
      return;
    }

    case "claude.setMode":
      return chatOrThrow(msg.chatId).session.setPermissionMode(msg.mode);

    case "claude.setModel":
      return chatOrThrow(msg.chatId).session.setModel(msg.model);

    case "claude.permission": {
      const p = pending.get(msg.requestId);
      if (!p) return;
      pending.delete(msg.requestId);
      p.resolve(
        msg.allow
          ? { behavior: "allow", updatedInput: msg.updatedInput ?? p.input, updatedPermissions: msg.always ? p.suggestions : undefined }
          : { behavior: "deny", message: "Kullanıcı izin vermedi." },
      );
      broadcast({ type: "claude.permissionResolved", requestId: msg.requestId });
      return;
    }

    case "claude.sessions": {
      const list = await listSessions({ dir: msg.cwd || config.claudeCwd, limit: 100 });
      return reply(ws, {
        type: "claude.sessions",
        sessions: list.map((s) => ({
          id: s.sessionId,
          title: s.customTitle || s.summary || s.firstPrompt || "Adsız sohbet",
          updatedAt: s.lastModified,
          cwd: s.cwd,
          gitBranch: s.gitBranch,
        })),
      });
    }

    case "claude.history": {
      const messages = await getSessionMessages(msg.sessionId);
      return reply(ws, {
        type: "claude.history",
        sessionId: msg.sessionId,
        messages: messages.map(({ type, uuid, message, parent_tool_use_id }) => ({ type, uuid, message, parent_tool_use_id })),
      });
    }

    case "claude.rename":
      return renameSession(msg.sessionId, msg.title);

    case "claude.delete":
      return deleteSession(msg.sessionId);

    case "worker.send": {
      const chatId = msg.chatId ?? randomUUID();
      const abort = new AbortController();
      workerAborts.set(chatId, abort);
      try {
        const { message } = await sendToWorker({
          workerId: msg.workerId,
          chatId,
          text: msg.text,
          signal: abort.signal,
          onStart: (chat) => broadcast({ type: "worker.chat", chat }),
          onToken: (id, text) => broadcast({ type: "worker.token", chatId: id, text }),
        });
        broadcast({ type: "worker.done", chatId, message });
        broadcast({ type: "worker.chats", workerId: msg.workerId, chats: await listChats(msg.workerId) });
      } finally {
        workerAborts.delete(chatId);
      }
      return;
    }

    case "worker.stop":
      workerAborts.get(msg.chatId)?.abort();
      return;

    case "worker.chats":
      return reply(ws, { type: "worker.chats", workerId: msg.workerId, chats: await listChats(msg.workerId) });

    case "worker.chat": {
      const chat = await getChat(msg.chatId);
      if (chat) reply(ws, { type: "worker.chat", chat });
      return;
    }

    case "worker.deleteChat": {
      const chat = await getChat(msg.chatId);
      await deleteChat(msg.chatId);
      if (chat) broadcast({ type: "worker.chats", workerId: chat.workerId, chats: await listChats(chat.workerId) });
      return;
    }

    case "workers.list":
      return reply(ws, { type: "workers", workers: await workersWithAvailability() });

    case "workers.save": {
      const { available: _ignored, ...worker } = msg.worker;
      const workers = await loadWorkers();
      const i = workers.findIndex((w) => w.id === worker.id);
      if (i >= 0) workers[i] = worker;
      else workers.push(worker);
      await saveWorkers(workers);
      return broadcast({ type: "workers", workers: await workersWithAvailability() });
    }

    case "workers.delete": {
      await saveWorkers((await loadWorkers()).filter((w) => w.id !== msg.workerId));
      return broadcast({ type: "workers", workers: await workersWithAvailability() });
    }

    case "jobs.list":
      return reply(ws, { type: "jobs", jobs: listJobs() });
  }
}

// ─── HTTP: derlenmiş arayüzü sun ───────────────────────────────────────────────

const MIME: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ico": "image/x-icon",
  ".json": "application/json",
  ".woff2": "font/woff2",
  ".glb": "model/gltf-binary",
};

async function serveStatic(req: IncomingMessage, res: ServerResponse) {
  if (!existsSync(WEB_DIST)) {
    res.writeHead(200, { "content-type": "text/plain; charset=utf-8" });
    res.end("Arayüz henüz derlenmemiş.\nGeliştirme: npm run dev  (http://localhost:5173)\nDerleme: npm run build, sonra npm start");
    return;
  }
  const urlPath = decodeURIComponent(new URL(req.url ?? "/", "http://localhost").pathname);
  let file = path.resolve(WEB_DIST, `.${urlPath}`);
  if (!file.startsWith(WEB_DIST)) {
    res.writeHead(403).end();
    return;
  }
  if (!existsSync(file) || (await stat(file)).isDirectory()) file = path.join(WEB_DIST, "index.html");
  res.writeHead(200, { "content-type": MIME[path.extname(file)] ?? "application/octet-stream" });
  res.end(await readFile(file));
}

const server = createServer((req, res) => {
  if (req.url === "/api/health") {
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ ok: true }));
    return;
  }
  serveStatic(req, res).catch(() => res.writeHead(500).end());
});

const wss = new WebSocketServer({
  server,
  path: "/ws",
  maxPayload: 60 * 1024 * 1024, // ek dosyalar için
  verifyClient: ({ origin }: { origin?: string }) => !!origin && ALLOWED_ORIGINS.has(origin),
});

wss.on("connection", async (ws) => {
  clients.add(ws);
  ws.on("close", () => clients.delete(ws));
  ws.on("message", async (raw) => {
    let msg: ClientMsg;
    try {
      msg = JSON.parse(raw.toString());
    } catch {
      return reply(ws, { type: "error", message: "Geçersiz mesaj." });
    }
    try {
      await handle(ws, msg);
    } catch (err) {
      reply(ws, { type: "error", message: err instanceof Error ? err.message : String(err) });
    }
  });

  reply(ws, { type: "welcome", cwd: config.claudeCwd });
  reply(ws, { type: "workers", workers: await workersWithAvailability() });
  reply(ws, { type: "jobs", jobs: listJobs() });
  for (const a of lastActivity.values()) reply(ws, { type: "activity", activity: a });
});

server.listen(config.port, HOST, () => {
  console.log(`Scriptorium arka ucu: http://localhost:${config.port}  (Claude klasörü: ${config.claudeCwd})`);
});

function shutdown() {
  for (const c of chats.values()) c.session.close();
  process.exit(0);
}
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
