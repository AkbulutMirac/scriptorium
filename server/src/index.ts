/**
 * Scriptorium backend: serves the UI, manages Claude sessions and workers over WebSocket.
 * Accessible only from this machine (127.0.0.1) and only allows our own UI to connect.
 */
import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { readFile, stat } from "node:fs/promises";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import path from "node:path";
import {
  deleteSession,
  getSessionInfo,
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
import { createMcpHandler, readJson } from "./mcpHttp.js";
import { listRequests } from "./requests.js";
import { claudeLogin, installHooks, installRules, registerMcp, saveDeepseekKey, setupStatus } from "./setup.js";
import { handleSubagentHook } from "./subagents.js";
import { installTeam } from "./team.js";
import { listJobs } from "./jobs.js";
import { gitDiff, gitInfo } from "./git.js";
import { appControlSupported, getAutostart, restartApp, setAutostart } from "./app.js";
import { isIgnoredPath, isScratchPath, listDir, listProjects, makeDir } from "./projects.js";
import { deepseekBalance, isAvailable, listModels } from "./llm.js";
import type { AgentActivity, ClientMsg, EffortLevel, ServerMsg, SessionSummary, WorkerInfo } from "./protocol.js";
import { deleteChat, getChat, listChats, sendToWorker } from "./workerChats.js";

const HOST = "127.0.0.1";
const WEB_DIST = path.resolve(SERVER_ROOT, "../web/dist");
/** Allowed UI origins: the built UI and the Vite dev server. */
const ALLOWED_ORIGINS = new Set([
  `http://localhost:${config.port}`,
  `http://127.0.0.1:${config.port}`,
  "http://localhost:5173",
  "http://127.0.0.1:5173",
  ...config.remoteOrigins,
]);

const LOCAL_HOSTS = new Set([`localhost:${config.port}`, `127.0.0.1:${config.port}`, "localhost:5173", "127.0.0.1:5173"]);
const REMOTE_HOSTS = new Set(config.remoteOrigins.map((o) => new URL(o).host));

/**
 * Who may use the server. Local requests (Host is localhost) are always allowed. A request for a remote
 * address only passes when remote access is configured, the address is one of REMOTE_ORIGINS and Tailscale
 * says which tailnet user sent it (`tailscale serve` adds that header and drops a forged one). Anything else,
 * including DNS-rebinding tricks with a foreign Host header, gets 403.
 */
function allowRequest(req: IncomingMessage): boolean {
  const host = req.headers.host ?? "";
  if (LOCAL_HOSTS.has(host)) return true;
  if (!REMOTE_HOSTS.has(host)) return false;
  const login = String(req.headers["tailscale-user-login"] ?? "").toLowerCase();
  if (!login) return false;
  return config.remoteUsers.length === 0 || config.remoteUsers.includes(login);
}

// ─── Broadcast ──────────────────────────────────────────────────────────────────

const clients = new Set<WebSocket>();

function broadcast(msg: ServerMsg) {
  const data = JSON.stringify(msg);
  for (const ws of clients) if (ws.readyState === WebSocket.OPEN) ws.send(data);
}

function reply(ws: WebSocket, msg: ServerMsg) {
  if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(msg));
}

/** Last state of each agent: so the 3D scene starts correctly when the UI reconnects. */
const lastActivity = new Map<string, AgentActivity>();
bus.on("activity", (a) => {
  lastActivity.set(a.agentId, a);
  broadcast({ type: "activity", activity: a });
});
bus.on("jobs", () => broadcast({ type: "jobs", jobs: listJobs() }));
bus.on("requests", () => broadcast({ type: "worker.requests", requests: listRequests() }));
bus.on("chats", async (workerId) => broadcast({ type: "worker.chats", workerId, chats: await listChats(workerId) }));

// ─── DeepSeek balance: on startup, every 5 minutes, and after every DeepSeek job ─────
let lastBalance: Awaited<ReturnType<typeof deepseekBalance>> | null = null;
let balanceTimer: ReturnType<typeof setTimeout> | null = null;
async function refreshBalance() {
  lastBalance = await deepseekBalance();
  broadcast({ type: "deepseek.balance", balance: lastBalance });
}
setInterval(refreshBalance, 5 * 60_000);
// Refresh the balance when a DeepSeek request finishes (or errors)
let runningIds = new Map<string, string>();
bus.on("requests", async () => {
  const now = new Map(listRequests().filter((r) => r.status === "running").map((r) => [r.id, r.workerId]));
  const finished = [...runningIds].filter(([id]) => !now.has(id)).map(([, workerId]) => workerId);
  runningIds = now;
  if (!finished.length) return;
  const workers = await loadWorkers();
  if (!finished.some((id) => workers.find((w) => w.id === id)?.provider === "deepseek")) return;
  if (balanceTimer) clearTimeout(balanceTimer);
  balanceTimer = setTimeout(refreshBalance, 2000); // spending reflects in the balance within a few seconds
});

// ─── Claude sessions ────────────────────────────────────────────────────────────

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

function openChat(
  chatId: string,
  opts: {
    resume?: string;
    fork?: boolean;
    cwd?: string;
    additionalDirectories?: string[];
    model?: string;
    effort?: EffortLevel;
    attachOnly?: boolean;
  },
) {
  const existing = chats.get(chatId);
  if (!existing && opts.attachOnly) {
    // Page was refreshed but the session isn't open on the server: don't restart, it opens on the first message
    broadcast({ type: "claude.closed", chatId });
    return;
  }
  if (existing) {
    // Page was refreshed: reconnect to the same session
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
    model: opts.model,
    effort: opts.effort,
    workerTools: "http",
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
          resolve({ behavior: "deny", message: "Request cancelled." });
        });
      }),
  });
  chats.set(chatId, state);

  state.session.done
    .then(() => broadcast({ type: "claude.closed", chatId }))
    .catch((err) => broadcast({ type: "claude.closed", chatId, error: err instanceof Error ? err.message : String(err) }))
    .finally(() => {
      if (chats.get(chatId) === state) chats.delete(chatId);
      denyPendingOf(chatId, "Session closed.");
      updateClaudeActivity();
    });
}

/**
 * A single, empty helper session for the model list, usage limits, and slash commands.
 * It never sends messages and never resumes an existing chat: just looking at a past chat
 * so it doesn't open that chat in a second process.
 */
let infoSession: ClaudeSession | null = null;
function getInfoSession(): ClaudeSession {
  if (!infoSession) {
    const s = new ClaudeSession({
      cwd: config.claudeCwd,
      workerTools: "http",
      onMessage: () => {},
      canUseTool: async () => ({ behavior: "deny", message: "The info session does not use tools." }),
    });
    s.done.catch(() => {}).finally(() => {
      if (infoSession === s) infoSession = null;
    });
    infoSession = s;
  }
  return infoSession;
}

function chatOrThrow(chatId: string): ChatState {
  const c = chats.get(chatId);
  if (!c) throw new Error("This chat is not open. Refresh the page and try again.");
  return c;
}

// ─── Workers ───────────────────────────────────────────────────────────────────

async function workersWithAvailability(): Promise<WorkerInfo[]> {
  const workers = await loadWorkers();
  return Promise.all(workers.map(async (w) => ({ ...w, available: await isAvailable(w) })));
}

const workerAborts = new Map<string, AbortController>();

// ─── Message handler ───────────────────────────────────────────────────────────

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

    case "claude.globalInfo":
      return reply(ws, { type: "claude.info", ...(await getInfoSession().info("__global")) });

    case "claude.setDirs": {
      const dirs: string[] = [];
      for (const d of msg.dirs) {
        const ok = await stat(d).then((st) => st.isDirectory()).catch(() => false);
        if (!ok) throw new Error(`Folder not found: ${d}`);
        dirs.push(d);
      }
      const c = chats.get(msg.chatId);
      if (c) {
        if (c.busy) throw new Error("Cannot add folders while Claude is working. Wait for it to finish.");
        // Additional folders are given when the session opens: reopen the session from where it left off with the new folders
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
      denyPendingOf(msg.chatId, "Stopped by user.");
      await c.session.interrupt();
      return;
    }

    case "claude.close": {
      const c = chats.get(msg.chatId);
      if (!c) return;
      chats.delete(msg.chatId);
      denyPendingOf(msg.chatId, "Session closed.");
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
          : { behavior: "deny", message: msg.message || "Permission denied by user." },
      );
      broadcast({ type: "claude.permissionResolved", requestId: msg.requestId });
      return;
    }

    case "claude.sessions": {
      const toSummary = (s: Awaited<ReturnType<typeof listSessions>>[number]): SessionSummary => ({
        id: s.sessionId,
        title: s.customTitle || s.summary || s.firstPrompt || "Untitled chat",
        updatedAt: s.lastModified,
        cwd: s.cwd,
        gitBranch: s.gitBranch,
        scratch: s.cwd ? isScratchPath(s.cwd) || undefined : undefined,
      });
      if (msg.all) {
        const list = await listSessions({ limit: 400 });
        const visible = list.filter((s) => s.cwd && (!isIgnoredPath(s.cwd) || isScratchPath(s.cwd)));
        return reply(ws, { type: "claude.allSessions", sessions: visible.map(toSummary) });
      }
      const list = await listSessions({ dir: msg.cwd || config.claudeCwd, limit: 100 });
      return reply(ws, { type: "claude.sessions", sessions: list.map(toSummary) });
    }

    case "claude.setEffort":
      return chatOrThrow(msg.chatId).session.setEffort(msg.effort);

    case "claude.setFastMode":
      return chatOrThrow(msg.chatId).session.setFastMode(msg.on);

    case "projects.list":
      return reply(ws, { type: "projects", projects: await listProjects() });

    case "fs.list":
      return reply(ws, { type: "fs.list", ...(await listDir(msg.path)) });

    case "fs.mkdir":
      return reply(ws, { type: "fs.list", ...(await listDir(await makeDir(msg.parent, msg.name))) });

    case "claude.history": {
      const [messages, info] = await Promise.all([getSessionMessages(msg.sessionId), getSessionInfo(msg.sessionId).catch(() => undefined)]);
      return reply(ws, {
        type: "claude.history",
        sessionId: msg.sessionId,
        cwd: info?.cwd,
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
          attachments: msg.attachments,
          settings: msg.settings,
          signal: abort.signal,
          onStart: (chat) => broadcast({ type: "worker.chat", chat }),
          onToken: (id, text) => broadcast({ type: "worker.token", chatId: id, text }),
          onReasoning: (id, text) => broadcast({ type: "worker.reasoning", chatId: id, text }),
        });
        broadcast({ type: "worker.done", chatId, message });
        broadcast({ type: "worker.chats", workerId: msg.workerId, chats: await listChats(msg.workerId) });
      } finally {
        workerAborts.delete(chatId);
      }
      return;
    }

    case "worker.models": {
      const worker = (await loadWorkers()).find((w) => w.id === msg.workerId);
      return reply(ws, { type: "worker.models", workerId: msg.workerId, models: worker ? await listModels(worker) : [] });
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

    case "deepseek.balance":
      return refreshBalance();

    case "setup.status":
      return reply(ws, { type: "setup.status", status: await setupStatus() });

    case "setup.claudeLogin":
      claudeLogin();
      return reply(ws, { type: "setup.result", action: "claudeLogin", ok: true, message: "Login page opened in your browser." });

    case "setup.deepseekKey":
      try {
        await saveDeepseekKey(msg.key);
      } catch (err) {
        return reply(ws, { type: "setup.result", action: "deepseekKey", ok: false, message: err instanceof Error ? err.message : String(err) });
      }
      reply(ws, { type: "setup.result", action: "deepseekKey", ok: true, message: "Key saved." });
      broadcast({ type: "workers", workers: await workersWithAvailability() });
      await refreshBalance();
      return reply(ws, { type: "setup.status", status: await setupStatus() });

    case "setup.mcp":
    case "setup.rules":
    case "setup.hooks":
    case "setup.agents": {
      const action = ({ "setup.mcp": "mcp", "setup.rules": "rules", "setup.hooks": "hooks", "setup.agents": "agents" } as const)[msg.type];
      try {
        await { mcp: registerMcp, rules: installRules, hooks: installHooks, agents: installTeam }[action]();
      } catch (err) {
        return reply(ws, { type: "setup.result", action, ok: false, message: err instanceof Error ? err.message : String(err) });
      }
      reply(ws, { type: "setup.result", action, ok: true });
      return reply(ws, { type: "setup.status", status: await setupStatus() });
    }

    case "app.shutdown":
      console.log("Shut down from the UI.");
      return shutdown();

    case "app.restart":
      console.log("Restart from the UI.");
      restartApp();
      return shutdown();

    case "app.setAutostart":
      return broadcast({ type: "app.autostart", on: await setAutostart(msg.on) });
  }
}

// ─── HTTP: serve the built UI ───────────────────────────────────────────────────

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
    res.end("The UI has not been built yet.\nDevelopment: npm run dev  (http://localhost:5173)\nBuild: npm run build, then npm start");
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

const handleMcp = createMcpHandler(ALLOWED_ORIGINS);

const server = createServer((req, res) => {
  if (!allowRequest(req)) {
    res.writeHead(403, { "content-type": "text/plain; charset=utf-8" }).end("Forbidden");
    return;
  }
  if (req.url === "/mcp" || req.url?.startsWith("/mcp?")) {
    handleMcp(req, res);
    return;
  }
  // Claude Code hooks from other sessions (subagents for the office). Only from this computer, never from a browser.
  if (req.url === "/hooks" && req.method === "POST") {
    if (!LOCAL_HOSTS.has(req.headers.host ?? "") || req.headers.origin) {
      res.writeHead(403).end();
      return;
    }
    readJson(req)
      .then((body) => handleSubagentHook((body ?? {}) as Parameters<typeof handleSubagentHook>[0]))
      .catch(() => ({}))
      .then((out) => res.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify(out)));
    return;
  }
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
  maxPayload: 60 * 1024 * 1024, // for attachments
  verifyClient: ({ origin, req }: { origin?: string; req: IncomingMessage }) => !!origin && ALLOWED_ORIGINS.has(origin) && allowRequest(req),
});

wss.on("connection", async (ws) => {
  clients.add(ws);
  ws.on("close", () => clients.delete(ws));
  ws.on("message", async (raw) => {
    let msg: ClientMsg;
    try {
      msg = JSON.parse(raw.toString());
    } catch {
      return reply(ws, { type: "error", message: "Invalid message." });
    }
    try {
      await handle(ws, msg);
    } catch (err) {
      reply(ws, { type: "error", message: err instanceof Error ? err.message : String(err) });
    }
  });

  reply(ws, { type: "welcome", cwd: config.claudeCwd, appControl: { supported: appControlSupported, autostart: getAutostart() } });
  reply(ws, { type: "workers", workers: await workersWithAvailability() });
  reply(ws, { type: "jobs", jobs: listJobs() });
  reply(ws, { type: "worker.requests", requests: listRequests() });
  for (const a of lastActivity.values()) reply(ws, { type: "activity", activity: a });
  if (lastBalance) reply(ws, { type: "deepseek.balance", balance: lastBalance });
  else refreshBalance();
});

server.listen(config.port, HOST, () => {
  console.log(`Scriptorium backend: http://localhost:${config.port}  (Claude folder: ${config.claudeCwd})`);
});

function shutdown() {
  for (const c of chats.values()) c.session.close();
  infoSession?.close();
  process.exit(0);
}
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
