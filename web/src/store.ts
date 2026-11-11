import { toast } from "@heroui/react";
import { isMobileNow } from "./lib/useMedia";
import { create } from "zustand";
import { applyMessage, historyToItems, isPlanPath, streamDelta, type ChatItem } from "./lib/claudeItems";
import { socket, type ConnectionStatus } from "./lib/socket";
import { load, save } from "./lib/storage";
import { assignCopies, LEAVE_MS, type CopyState } from "./lib/workerCopies";
import type {
  AgentActivity,
  Attachment,
  ClaudeInfo,
  DeepSeekBalance,
  DirListing,
  EffortLevel,
  GitInfo,
  JobInfo,
  ProjectInfo,
  PermissionMode,
  ServerMsg,
  SessionSummary,
  WorkerChat,
  WorkerChatSummary,
  WorkerInfo,
  SetupAction,
  SetupStatus,
  WorkerModel,
  WorkerRequest,
  WorkerSettings,
} from "./protocol";

export const CLAUDE_ID = "claude";

/** Claude Code's background task (from task_started / task_updated / task_notification events) */
export type ClaudeTask = { id: string; description: string; status: string; error?: string; summary?: string };

/** Info received when the session opens (init) */
export type ClaudeInit = {
  version: string;
  slashCommands: string[];
  plugins: { name: string; version?: string; path: string }[];
  skills: string[];
  mcpServers: { name: string; status: string }[];
};

/** A message typed while Claude is busy; sent when the turn ends (or right away with "Send now") */
export type QueuedMessage = { id: string; text: string; attachments: Attachment[] };

export type ClaudeChat = {
  chatId: string;
  sessionId?: string;
  /** Side chat: forks from this session on the first message */
  forkFrom?: string;
  isSide: boolean;
  /** Whether the Claude Code process is open on the server */
  opened: boolean;
  busy: boolean;
  /** When the current turn started (for the elapsed time in the status line) */
  busySince?: number;
  items: ChatItem[];
  /** Messages typed while Claude is busy; flushed when the current turn finishes */
  queue: QueuedMessage[];
  streamText: string;
  streamThinking: string;
  model?: string;
  permissionMode?: PermissionMode;
  /** Settings the user selected but not yet sent to the server */
  wantModel?: string;
  wantMode?: PermissionMode;
  effort?: EffortLevel;
  wantEffort?: EffortLevel;
  fastMode?: boolean;
  wantFast?: boolean;
  cwd: string;
  /** Additional folders Claude can access */
  dirs: string[];
  loadingHistory: boolean;
  init?: ClaudeInit;
  info?: ClaudeInfo;
  tasks: Record<string, ClaudeTask>;
};

export type PermissionReq = Extract<ServerMsg, { type: "claude.permissionRequest" }>;
export type LiveWorkerChat = WorkerChat & { stream: string; streamReasoning: string; busy: boolean };
export type Overlay = { title: string; body: string; mono?: boolean; diff?: boolean; image?: string };
export type UiPrefs = { historyOpen: boolean; chatWidth: number; sideWidth: number; infoOpen: boolean; mobileView: "scene" | "chat" };

type State = {
  connection: ConnectionStatus;
  serverCwd: string;
  /** Restart / start at login (undefined until the server says hello) */
  appControl?: { supported: boolean; autostart: boolean };
  /** Folder where new Claude chats will run (server default if empty) */
  cwd: string;
  workers: WorkerInfo[];
  activity: Record<string, AgentActivity>;
  /** Requests going to workers (from all Claude sessions and direct chats) */
  workerRequests: WorkerRequest[];
  /** Which worker copy is doing which job in the 3D office */
  workerCopies: CopyState;
  jobs: JobInfo[];
  selected: string;

  sessions: SessionSummary[];
  chats: Record<string, ClaudeChat>;
  mainChatId: string | null;
  sideChatId: string | null;
  permissions: PermissionReq[];

  workerChatLists: Record<string, WorkerChatSummary[]>;
  workerChats: Record<string, LiveWorkerChat>;
  activeWorkerChat: Record<string, string | undefined>;
  /** Per-worker chat settings (model, thinking, temperature, JSON, system prompt) */
  workerSettings: Record<string, WorkerSettings>;
  workerModels: Record<string, WorkerModel[]>;

  /** Quote per chat panel: chatId for Claude, "w:<id>" for a worker */
  quotes: Record<string, string | undefined>;
  overlay: Overlay | null;
  workerModal: { open: boolean; worker?: WorkerInfo };
  /** Initial setup window */
  setup: { open: boolean; status?: SetupStatus; busy?: SetupAction };
  ui: UiPrefs;
  git: Record<string, GitInfo>;
  /** Known project folders (those with sessions + the projects folder) */
  projects: ProjectInfo[];
  /** Claude sessions of all projects (grouped by project in the history panel) */
  allSessions: SessionSummary[];
  deepseekBalance?: DeepSeekBalance;
  /** Chat-independent info: models, usage limits, commands */
  globalInfo?: ClaudeInfo;
  /** Section to open and reveal in the info panel (like "See all") */
  infoFocus: { section: string; n: number } | null;
  /** Folder browser */
  folderPicker: { open: boolean; purpose: "cwd" | "dir"; chatId?: string; listing?: DirListing };
  /** Plan file shown in the side panel (main chat) */
  planPath: string | null;
  /** When each session was last looked at (for the unread dot in history) */
  seenAt: Record<string, number>;
};

/** crypto.randomUUID only exists on secure pages (https or localhost); over plain http build a v4 UUID by hand */
const uuid = (): string => {
  if (typeof crypto.randomUUID === "function") return crypto.randomUUID();
  const b = crypto.getRandomValues(new Uint8Array(16));
  b[6] = (b[6] & 0x0f) | 0x40;
  b[8] = (b[8] & 0x3f) | 0x80;
  const h = [...b].map((x) => x.toString(16).padStart(2, "0")).join("");
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
};

const savedMain = load<{ chatId: string; sessionId?: string } | null>("mainSession", null);

export const useApp = create<State>(() => ({
  connection: "connecting",
  serverCwd: "",
  cwd: load("cwd", ""),
  workers: [],
  activity: {},
  workerRequests: [],
  workerCopies: { base: {}, copies: {} },
  jobs: [],
  selected: load("selected", CLAUDE_ID),
  sessions: [],
  chats: {},
  mainChatId: null,
  sideChatId: null,
  permissions: [],
  workerChatLists: {},
  workerChats: {},
  activeWorkerChat: load<Record<string, string | undefined>>("activeWorkerChat", {}),
  workerSettings: load<Record<string, WorkerSettings>>("workerSettings", {}),
  workerModels: {},
  quotes: {},
  overlay: null,
  workerModal: { open: false },
  setup: { open: false },
  ui: { historyOpen: true, chatWidth: 520, sideWidth: 440, infoOpen: false, mobileView: "chat", ...load<Partial<UiPrefs>>("ui", {}) },
  git: {},
  projects: [],
  allSessions: [],
  folderPicker: { open: false, purpose: "cwd" },
  infoFocus: null,
  planPath: null,
  seenAt: load<Record<string, number>>("sessionSeen", {}),
}));

/** Sessions last changed before the unread dot existed count as read */
export const SEEN_SINCE = load<number>("seenSince", 0) || Date.now();
save("seenSince", SEEN_SINCE);

function markSeen(sessionId: string | undefined, at = Date.now()) {
  if (!sessionId || (get().seenAt[sessionId] ?? 0) >= at) return;
  const seenAt = { ...get().seenAt, [sessionId]: at };
  set({ seenAt });
  save("sessionSeen", seenAt);
}

const get = useApp.getState;
const set = useApp.setState;

// The chat you're on (and the one you leave) is read
useApp.subscribe((s, prev) => {
  const now = s.chats[s.mainChatId ?? ""]?.sessionId;
  const before = prev.chats[prev.mainChatId ?? ""]?.sessionId;
  if (now !== before) {
    markSeen(before);
    markSeen(now);
  }
});

// The last open chat is remembered per worker: on app launch you return to the chat you left
useApp.subscribe((s, prev) => {
  if (s.activeWorkerChat !== prev.activeWorkerChat) save("activeWorkerChat", s.activeWorkerChat);
});

/** Loads the worker's chat list and its last open chat */
/** Claude's subagents have no desk in the office: each of their jobs walks in as a visitor */
const visitorIds = (workers: WorkerInfo[]) => new Set(workers.filter((w) => w.provider === "claude").map((w) => w.id));

function loadWorker(workerId: string) {
  socket.send({ type: "worker.chats", workerId });
  const chatId = get().activeWorkerChat[workerId];
  if (chatId && !get().workerChats[chatId]) socket.send({ type: "worker.chat", chatId });
}

// ─── Helpers ───────────────────────────────────────────────────────────────

function updateChat(chatId: string, fn: (c: ClaudeChat) => ClaudeChat) {
  const c = get().chats[chatId];
  if (c) set({ chats: { ...get().chats, [chatId]: fn(c) } });
}

function updateWorkerChat(chatId: string, fn: (c: LiveWorkerChat) => LiveWorkerChat) {
  const c = get().workerChats[chatId];
  if (c) set({ workerChats: { ...get().workerChats, [chatId]: fn(c) } });
}

function emptyChat(chatId: string, cwd: string, extra: Partial<ClaudeChat> = {}): ClaudeChat {
  return {
    chatId,
    isSide: false,
    opened: false,
    busy: false,
    items: [],
    queue: [],
    streamText: "",
    streamThinking: "",
    cwd,
    dirs: [],
    loadingHistory: false,
    tasks: {},
    ...extra,
    // New chats start in Automatic permission mode unless told otherwise
    wantMode: extra.wantMode ?? "auto",
  };
}

function effectiveCwd() {
  return get().cwd || get().serverCwd;
}

function persistMain() {
  const { mainChatId, chats } = get();
  const main = mainChatId ? chats[mainChatId] : undefined;
  save("mainSession", main ? { chatId: main.chatId, sessionId: main.sessionId } : null);
}

function refreshSessions() {
  socket.send({ type: "claude.sessions", cwd: effectiveCwd() || undefined });
  socket.send({ type: "claude.sessions", all: true });
}

/** Reattaches to the chat if it's still open on the server; otherwise starts nothing (on page refresh / reconnect). */
function reattach(chatId: string) {
  const c = get().chats[chatId];
  if (!c) return;
  socket.send({ type: "claude.open", chatId, resume: c.sessionId, cwd: c.cwd || undefined, attachOnly: true });
  updateChat(chatId, (x) => ({ ...x, opened: true }));
}

/** Opens the chat's Claude Code process if needed (on the first message). */
function ensureOpen(chatId: string) {
  const c = get().chats[chatId];
  if (!c || c.opened) return;
  socket.send({
    type: "claude.open",
    chatId,
    resume: c.sessionId ?? c.forkFrom,
    fork: !c.sessionId && !!c.forkFrom,
    cwd: c.cwd || undefined,
    additionalDirectories: c.dirs.length ? c.dirs : undefined,
    model: c.wantModel || undefined,
    effort: c.wantEffort,
  });
  if (c.wantMode) socket.send({ type: "claude.setMode", chatId, mode: c.wantMode });
  if (c.wantFast !== undefined) socket.send({ type: "claude.setFastMode", chatId, on: c.wantFast });
  updateChat(chatId, (x) => ({ ...x, opened: true }));
}

function closeChat(chatId: string | null) {
  if (!chatId) return;
  const c = get().chats[chatId];
  if (c?.opened) socket.send({ type: "claude.close", chatId });
  const chats = { ...get().chats };
  delete chats[chatId];
  set({ chats, permissions: get().permissions.filter((p) => p.chatId !== chatId) });
}

/** Leaving a chat: a running (or queued) one keeps going in the background, an idle one is closed */
function detachChat(chatId: string | null) {
  const c = chatId ? get().chats[chatId] : undefined;
  if (c && (c.busy || c.queue.length)) return;
  closeChat(chatId);
}

/** Permission mode, model and effort remembered per session */
type SessionPrefs = { mode?: PermissionMode; model?: string; effort?: EffortLevel };
const prefsOf = (sessionId?: string): SessionPrefs => (sessionId ? (load<Record<string, SessionPrefs>>("sessionPrefs", {})[sessionId] ?? {}) : {});
function rememberPrefs(chatId: string, patch: SessionPrefs, onlyIfNew = false) {
  const sid = get().chats[chatId]?.sessionId;
  if (!sid) return;
  const all = load<Record<string, SessionPrefs>>("sessionPrefs", {});
  if (onlyIfNew && all[sid]) return;
  save("sessionPrefs", { ...all, [sid]: { ...all[sid], ...patch } });
}

// ─── Server messages ──────────────────────────────────────────────────────────

function onServer(msg: ServerMsg) {
  const s = get();
  switch (msg.type) {
    case "welcome": {
      socket.send({ type: "projects.list" });
      socket.send({ type: "claude.globalInfo" });
      // The chat may have opened before the server's default folder arrived: fill in empty folders
      const chats = Object.fromEntries(Object.entries(s.chats).map(([id, c]) => [id, c.cwd ? c : { ...c, cwd: msg.cwd }]));
      set({ serverCwd: msg.cwd, chats, appControl: msg.appControl });
      refreshSessions();
      return;
    }

    case "claude.message": {
      const m = msg.message as { type: string; subtype?: string; model?: string; permissionMode?: PermissionMode; message?: { content?: { type: string }[] } };
      updateChat(msg.chatId, (c) => {
        const delta = streamDelta(m);
        if (delta) {
          return { ...c, streamText: c.streamText + (delta.text ?? ""), streamThinking: c.streamThinking + (delta.thinking ?? "") };
        }
        const next: ClaudeChat = { ...c, items: applyMessage(c.items, m, true) };
        const sys = m as unknown as Record<string, unknown>;
        // Read receipt: a sent message is in Claude's hands once its next API request starts (or it answers)
        if (m.type === "assistant" || (m.type === "system" && m.subtype === "status" && sys.status === "requesting")) {
          if (next.items.some((it) => it.kind === "user" && it.receipt === "sent")) {
            next.items = next.items.map((it) => (it.kind === "user" && it.receipt === "sent" ? { ...it, receipt: "read" as const } : it));
          }
        }
        if (m.type === "system" && typeof sys.task_id === "string") next.tasks = updateTasks(c.tasks, sys);
        if (m.type === "assistant") {
          const blocks = m.message?.content ?? [];
          if (blocks.some((b) => b.type === "text")) next.streamText = "";
          if (blocks.some((b) => b.type === "thinking")) next.streamThinking = "";
        }
        if (m.type === "system" && m.subtype === "init") {
          next.model = m.model;
          next.permissionMode = m.permissionMode;
          if (sys.effort) next.effort = sys.effort as EffortLevel;
          if (typeof sys.fast_mode_state === "string") next.fastMode = sys.fast_mode_state === "on";
          next.init = {
            version: String(sys.claude_code_version ?? ""),
            slashCommands: (sys.slash_commands as string[]) ?? [],
            plugins: (sys.plugins as ClaudeInit["plugins"]) ?? [],
            skills: (sys.skills as string[]) ?? [],
            mcpServers: (sys.mcp_servers as ClaudeInit["mcpServers"]) ?? [],
          };
        }
        if (m.type === "result") {
          next.streamText = "";
          next.streamThinking = "";
        }
        return next;
      });
      // Claude is writing a plan: show it beside the chat, like the Claude app
      if (m.type === "assistant" && msg.chatId === s.mainChatId) {
        for (const b of (m.message?.content ?? []) as { type: string; input?: Record<string, unknown> }[]) {
          const fp = b.type === "tool_use" ? (b.input?.file_path ?? b.input?.planFilePath) : undefined;
          if (typeof fp === "string" && isPlanPath(fp)) set({ planPath: fp });
        }
      }
      if (m.type === "result") {
        // Turn over: queued messages go out together as the next message
        const done = get().chats[msg.chatId];
        if (done?.queue.length) {
          const texts = done.queue.map((q) => q.text);
          const attachments = done.queue.flatMap((q) => q.attachments);
          updateChat(msg.chatId, (c) => ({ ...c, queue: [] }));
          actions.sendClaude(msg.chatId, texts.join("\n\n"), attachments);
        }
        if (msg.chatId === s.mainChatId) refreshSessions();
        // A chat that kept running in the background finished its turn: release it
        const bg = get().chats[msg.chatId];
        if (bg && !done?.queue.length && msg.chatId !== get().mainChatId && msg.chatId !== get().sideChatId) {
          closeChat(msg.chatId);
          refreshSessions();
          return;
        }
        socket.send({ type: "claude.info", chatId: msg.chatId });
        socket.send({ type: "claude.globalInfo" });
        const cwd = get().chats[msg.chatId]?.cwd;
        if (cwd) socket.send({ type: "git.info", cwd });
      }
      return;
    }

    case "claude.info": {
      const { type: _t, ...info } = msg;
      if (msg.chatId === "__global") set({ globalInfo: info });
      else updateChat(msg.chatId, (c) => ({ ...c, info }));
      return;
    }

    case "claude.allSessions": {
      set({ allSessions: msg.sessions });
      // New messages in the open chat are read as they arrive
      const active = get().chats[get().mainChatId ?? ""]?.sessionId;
      const cur = msg.sessions.find((x) => x.id === active);
      if (cur) markSeen(cur.id, Math.max(cur.updatedAt, Date.now()));
      return;
    }

    case "projects":
      set({ projects: msg.projects });
      return;

    case "deepseek.balance":
      set({ deepseekBalance: msg.balance });
      return;

    case "fs.list":
      set({ folderPicker: { ...s.folderPicker, listing: { path: msg.path, parent: msg.parent, dirs: msg.dirs } } });
      return;

    case "claude.dirs":
      updateChat(msg.chatId, (c) => ({ ...c, dirs: msg.dirs }));
      return;

    case "git.info": {
      const { type: _t, ...info } = msg;
      set({ git: { ...s.git, [msg.cwd]: info } });
      return;
    }

    case "app.autostart":
      if (s.appControl) set({ appControl: { ...s.appControl, autostart: msg.on } });
      return;

    case "git.diff":
      set({
        overlay: {
          title: msg.file ? `Change: ${msg.file}` : "All changes",
          body: msg.diff || "No changes.",
          mono: true,
          diff: true,
        },
      });
      return;

    case "claude.session":
      updateChat(msg.chatId, (c) => ({ ...c, sessionId: msg.sessionId }));
      {
        const c = get().chats[msg.chatId];
        if (c) rememberPrefs(msg.chatId, { mode: c.permissionMode ?? c.wantMode, model: c.wantModel, effort: c.effort ?? c.wantEffort }, true);
      }
      if (msg.chatId === s.mainChatId) {
        persistMain();
        // A new chat got its session: put it in the history list right away
        refreshSessions();
      }
      return;

    case "claude.busy":
      updateChat(msg.chatId, (c) => ({ ...c, busy: msg.busy, busySince: msg.busy ? (c.busySince ?? Date.now()) : undefined }));
      return;

    case "claude.closed":
      updateChat(msg.chatId, (c) => ({
        ...c,
        opened: false,
        busy: false,
        items: msg.error ? [...c.items, { kind: "notice", id: uuid(), text: `Claude Code session closed: ${msg.error}`, tone: "danger" }] : c.items,
      }));
      return;

    case "claude.permissionRequest":
      if (!s.permissions.some((p) => p.requestId === msg.requestId)) set({ permissions: [...s.permissions, msg] });
      // Plan ready for approval: show it beside the chat
      if (msg.toolName === "ExitPlanMode" && msg.chatId === s.mainChatId) {
        const fp = msg.input.planFilePath;
        if (typeof fp === "string") set({ planPath: fp });
      }
      return;

    case "claude.permissionResolved":
      set({ permissions: s.permissions.filter((p) => p.requestId !== msg.requestId) });
      return;

    case "claude.sessions":
      set({ sessions: msg.sessions });
      return;

    case "claude.history":
      for (const c of Object.values(s.chats)) {
        if (c.sessionId === msg.sessionId && c.loadingHistory) {
          // If the session belongs to another folder, continue it in the correct folder
          const cwd = msg.cwd && !c.opened ? msg.cwd : c.cwd;
          updateChat(c.chatId, (x) => ({ ...x, items: historyToItems(msg.messages), loadingHistory: false, cwd }));
          if (cwd !== c.cwd) socket.send({ type: "git.info", cwd });
        }
      }
      return;

    case "worker.chats":
      set({ workerChatLists: { ...s.workerChatLists, [msg.workerId]: msg.chats } });
      return;

    case "worker.chat": {
      const prev = s.workerChats[msg.chat.id];
      set({
        workerChats: {
          ...s.workerChats,
          [msg.chat.id]: { ...msg.chat, stream: prev?.stream ?? "", streamReasoning: prev?.streamReasoning ?? "", busy: prev?.busy ?? false },
        },
      });
      return;
    }

    case "worker.token":
      updateWorkerChat(msg.chatId, (c) => ({ ...c, stream: c.stream + msg.text }));
      return;

    case "worker.reasoning":
      updateWorkerChat(msg.chatId, (c) => ({ ...c, streamReasoning: c.streamReasoning + msg.text }));
      return;

    case "worker.models":
      set({ workerModels: { ...s.workerModels, [msg.workerId]: msg.models } });
      return;

    case "worker.done":
      updateWorkerChat(msg.chatId, (c) => ({ ...c, messages: [...c.messages, msg.message], stream: "", streamReasoning: "", busy: false, updatedAt: msg.message.at }));
      return;

    case "workers": {
      const selectedGone = s.selected !== CLAUDE_ID && !msg.workers.some((w) => w.id === s.selected);
      set({
        workers: msg.workers,
        workerCopies: assignCopies(s.workerCopies, s.workerRequests, Date.now(), visitorIds(msg.workers)),
        ...(selectedGone ? { selected: CLAUDE_ID } : {}),
      });
      return;
    }

    case "worker.requests": {
      set({ workerRequests: msg.requests, workerCopies: assignCopies(s.workerCopies, msg.requests, Date.now(), visitorIds(s.workers)) });
      // Copies leaving the room should be removed after they walk away
      if (Object.values(get().workerCopies.copies).some((c) => c.leavingAt)) {
        setTimeout(() => set({ workerCopies: assignCopies(get().workerCopies, get().workerRequests, Date.now(), visitorIds(get().workers)) }), LEAVE_MS + 50);
      }
      return;
    }

    case "activity":
      set({ activity: { ...s.activity, [msg.activity.agentId]: msg.activity } });
      return;

    case "jobs":
      set({ jobs: msg.jobs });
      return;

    case "setup.status":
      set({ setup: { ...s.setup, status: msg.status } });
      return;

    case "setup.result":
      set({ setup: { ...s.setup, busy: undefined } });
      if (!msg.ok) toast.danger(msg.message ?? "Failed.");
      else if (msg.message) toast.success(msg.message);
      return;

    case "error":
      toast.danger(msg.message);
      return;
  }
}

// ─── Connection ──────────────────────────────────────────────────────────────────

let started = false;

export function startConnection() {
  if (started) return;
  started = true;
  socket.onStatus((connection) => set({ connection }));
  socket.onMessage(onServer);
  socket.onOpen(() => {
    const { mainChatId, chats, selected } = get();
    if (!mainChatId) {
      // The chat that was open on close comes back; the selected agent (Claude or a worker) doesn't change
      if (savedMain?.sessionId) actions.openClaudeSession(savedMain.sessionId, savedMain.chatId, true);
      else actions.newClaudeChat(undefined, true);
    } else {
      // Reconnected: reattach to open chats (session is resumed if the server restarted)
      for (const c of Object.values(chats)) {
        if (c.opened) reattach(c.chatId);
        // Messages sent while the socket was down never arrived: reload the chat from its transcript
        if (c.sessionId) {
          updateChat(c.chatId, (x) => ({ ...x, loadingHistory: true }));
          socket.send({ type: "claude.history", sessionId: c.sessionId });
        }
      }
    }
    if (selected !== CLAUDE_ID) loadWorker(selected);
    // Setup window on first launch (Setup can always be reopened from the Settings menu)
    if (!load("setupDone", false)) actions.openSetup();
  });
  socket.connect();
  setInterval(() => {
    if (document.hidden) return;
    const main = get().chats[get().mainChatId ?? ""];
    if (main?.opened) socket.send({ type: "claude.info", chatId: main.chatId });
    socket.send({ type: "claude.globalInfo" });
  }, 60_000);
}

// ─── Actions ──────────────────────────────────────────────────────────────────

export const actions = {
  selectAgent(id: string) {
    set({ selected: id });
    save("selected", id);
    if (isMobileNow()) actions.setUi({ mobileView: "chat", historyOpen: false });
    if (id !== CLAUDE_ID) loadWorker(id);
  },

  setCwd(cwd: string) {
    set({ cwd });
    save("cwd", cwd);
    refreshSessions();
  },

  setUi(patch: Partial<UiPrefs>) {
    const ui = { ...get().ui, ...patch };
    set({ ui });
    save("ui", ui);
  },

  // Claude ─────────────────────────────────────

  /** New Claude chat. If cwd is given, it opens in that folder and is remembered as the default folder. */
  newClaudeChat(cwd?: string, keepSelection = false) {
    const prev = get().chats[get().mainChatId ?? ""];
    closeChat(get().sideChatId);
    detachChat(get().mainChatId);
    if (cwd) actions.setCwd(cwd);
    const chatId = uuid();
    const chat = emptyChat(chatId, cwd || effectiveCwd(), { wantModel: prev?.wantModel, wantEffort: load<EffortLevel | undefined>("lastEffort", undefined) ?? prev?.wantEffort ?? prev?.effort });
    set({ chats: { ...get().chats, [chatId]: chat }, mainChatId: chatId, sideChatId: null, planPath: null, ...(keepSelection ? {} : { selected: CLAUDE_ID }) });
    if (!keepSelection) save("selected", CLAUDE_ID);
    persistMain();
  },

  /** Changes the folder of a chat that hasn't started yet; if it has started, opens a new chat in that folder. */
  setChatCwd(chatId: string, cwd: string) {
    const c = get().chats[chatId];
    if (!c) return;
    if (c.sessionId || c.items.length) {
      actions.newClaudeChat(cwd);
      return;
    }
    // No messages yet: close the previously opened empty session, it will open in the new folder on the first message
    if (c.opened) socket.send({ type: "claude.close", chatId });
    actions.setCwd(cwd);
    updateChat(chatId, (x) => ({ ...x, cwd, opened: false, info: undefined, init: undefined }));
    actions.requestInfo(chatId);
  },

  setEffort(chatId: string, effort: EffortLevel) {
    const c = get().chats[chatId];
    if (!c) return;
    if (c.opened) socket.send({ type: "claude.setEffort", chatId, effort });
    updateChat(chatId, (x) => ({ ...x, effort, wantEffort: effort }));
    rememberPrefs(chatId, { effort });
    // New chats start with the effort chosen last
    save("lastEffort", effort);
  },

  setFastMode(chatId: string, on: boolean) {
    const c = get().chats[chatId];
    if (!c) return;
    if (c.opened) socket.send({ type: "claude.setFastMode", chatId, on });
    updateChat(chatId, (x) => ({ ...x, fastMode: on, wantFast: on }));
  },

  /** Shuts down the server running in the background (the shortcut runs it without opening a window) */
  shutdownServer() {
    socket.send({ type: "app.shutdown" });
  },

  /** Shuts the server down and relaunches it in the background; the page reconnects by itself */
  restartServer() {
    socket.send({ type: "app.restart" });
  },

  setAutostart(on: boolean) {
    socket.send({ type: "app.setAutostart", on });
  },

  refreshDeepseekBalance() {
    socket.send({ type: "deepseek.balance" });
  },

  loadProjects() {
    socket.send({ type: "projects.list" });
  },

  openFolderPicker(purpose: "cwd" | "dir", chatId?: string, startPath?: string) {
    set({ folderPicker: { open: true, purpose, chatId } });
    socket.send({ type: "fs.list", path: startPath });
  },

  browse(path?: string) {
    socket.send({ type: "fs.list", path });
  },

  /** Creates a subfolder; the server answers with the new folder's listing, so the picker opens it */
  makeDir(parent: string, name: string) {
    socket.send({ type: "fs.mkdir", parent, name });
  },

  closeFolderPicker() {
    set({ folderPicker: { open: false, purpose: "cwd" } });
  },

  /** Opens a session from history. reattach=true: the page was refreshed, it may still be open on the server. */
  openClaudeSession(sessionId: string, chatId = uuid(), reattachToServer = false) {
    if (get().chats[get().mainChatId ?? ""]?.sessionId === sessionId && !reattachToServer) return;
    // Still running in the background: switch back to it as it is
    const running = Object.values(get().chats).find((c) => c.sessionId === sessionId && !c.isSide);
    if (running && !reattachToServer) {
      closeChat(get().sideChatId);
      detachChat(get().mainChatId);
      set({ mainChatId: running.chatId, sideChatId: null, planPath: null });
      persistMain();
      return;
    }
    closeChat(get().sideChatId);
    detachChat(get().mainChatId);
    const session = get().sessions.find((x) => x.id === sessionId) ?? get().allSessions.find((x) => x.id === sessionId);
    const p = prefsOf(sessionId);
    const chat = emptyChat(chatId, session?.cwd || effectiveCwd(), {
      sessionId,
      loadingHistory: true,
      ...(p.mode ? { wantMode: p.mode, permissionMode: p.mode } : {}),
      ...(p.model ? { wantModel: p.model } : {}),
      ...(p.effort ? { wantEffort: p.effort, effort: p.effort } : {}),
    });
    set({ chats: { ...get().chats, [chatId]: chat }, mainChatId: chatId, sideChatId: null, planPath: null });
    persistMain();
    socket.send({ type: "claude.history", sessionId });
    if (reattachToServer) reattach(chatId);
  },

  sendClaude(chatId: string, text: string, attachments: Attachment[] = []) {
    ensureOpen(chatId);
    const images = attachments.filter((a) => a.mediaType.startsWith("image/")).map((a) => ({ src: `data:${a.mediaType};base64,${a.data}`, name: a.name }));
    const files = attachments.filter((a) => !a.mediaType.startsWith("image/"));
    const shown = files.length ? `${files.map((a) => `📎 ${a.name}`).join("\n")}\n\n${text}` : text;
    updateChat(chatId, (c) => ({
      ...c,
      busy: true,
      busySince: Date.now(),
      items: [...c.items, { kind: "user", id: uuid(), text: shown, images: images.length ? images : undefined, receipt: "sent" }],
    }));
    socket.send({ type: "claude.send", chatId, text, attachments: attachments.length ? attachments : undefined });
  },

  /** Queues a message typed while Claude is busy; it is sent automatically when the turn ends */
  queueClaude(chatId: string, text: string, attachments: Attachment[] = []) {
    updateChat(chatId, (c) => ({ ...c, queue: [...c.queue, { id: uuid(), text, attachments }] }));
  },

  unqueueClaude(chatId: string, id: string) {
    updateChat(chatId, (c) => ({ ...c, queue: c.queue.filter((q) => q.id !== id) }));
  },

  /** Sends a queued message right away: Claude reads it at its next step of the running turn */
  sendQueuedNow(chatId: string, id: string) {
    const q = get().chats[chatId]?.queue.find((x) => x.id === id);
    if (!q) return;
    actions.unqueueClaude(chatId, id);
    actions.sendClaude(chatId, q.text, q.attachments);
  },

  /**
   * Request data for the info panel and menus. Doesn't open the chat: viewing a chat from history shouldn't
   * restart it. If the chat isn't open, models, usage and commands come from the shared info.
   */
  requestInfo(chatId: string) {
    const c = get().chats[chatId];
    if (c?.opened) socket.send({ type: "claude.info", chatId });
    socket.send({ type: "claude.globalInfo" });
    if (c?.cwd) socket.send({ type: "git.info", cwd: c.cwd });
  },

  refreshGit(cwd: string) {
    socket.send({ type: "git.info", cwd });
  },

  showGitDiff(cwd: string, file?: string) {
    socket.send({ type: "git.diff", cwd, file });
  },

  setDirs(chatId: string, dirs: string[]) {
    socket.send({ type: "claude.setDirs", chatId, dirs });
  },

  toggleMcp(chatId: string, server: string, enabled: boolean) {
    socket.send({ type: "claude.mcpToggle", chatId, server, enabled });
  },

  reconnectMcp(chatId: string, server: string) {
    socket.send({ type: "claude.mcpReconnect", chatId, server });
  },

  stopTask(chatId: string, taskId: string) {
    socket.send({ type: "claude.stopTask", chatId, taskId });
  },

  interruptClaude(chatId: string) {
    socket.send({ type: "claude.interrupt", chatId });
  },

  setMode(chatId: string, mode: PermissionMode) {
    const c = get().chats[chatId];
    if (!c) return;
    if (c.opened) socket.send({ type: "claude.setMode", chatId, mode });
    updateChat(chatId, (x) => ({ ...x, permissionMode: mode, wantMode: mode }));
    rememberPrefs(chatId, { mode });
  },

  setModel(chatId: string, model: string) {
    const c = get().chats[chatId];
    if (!c) return;
    if (c.opened) socket.send({ type: "claude.setModel", chatId, model: model || undefined });
    updateChat(chatId, (x) => ({ ...x, wantModel: model }));
    rememberPrefs(chatId, { model });
    socket.send({ type: "claude.info", chatId });
  },

  respondPermission(requestId: string, allow: boolean, always = false, updatedInput?: Record<string, unknown>) {
    socket.send({ type: "claude.permission", requestId, allow, always, updatedInput });
    set({ permissions: get().permissions.filter((p) => p.requestId !== requestId) });
  },

  openSideChat(quote?: string) {
    const main = get().chats[get().mainChatId ?? ""];
    if (!main?.sessionId) {
      toast.warning("Send a message in the main chat first to start a side chat.");
      return;
    }
    closeChat(get().sideChatId);
    const chatId = uuid();
    const side = emptyChat(chatId, main.cwd, {
      isSide: true,
      forkFrom: main.sessionId,
      wantModel: main.wantModel,
      wantMode: main.permissionMode,
      items: [
        {
          kind: "notice",
          id: uuid(),
          text: "Side chat: it knows the main chat's context up to this point. Messages here don't affect the main chat.",
          tone: "info",
        },
      ],
    });
    set({ chats: { ...get().chats, [chatId]: side }, sideChatId: chatId, quotes: { ...get().quotes, [chatId]: quote } });
  },

  /** Answers Claude's plan: mode = accept and continue in that mode; null = reject (with optional feedback to revise) */
  respondPlan(req: PermissionReq, mode: PermissionMode | null, feedback?: string) {
    if (mode) actions.setMode(req.chatId, mode);
    const message = feedback ? `The user wants changes to the plan before approving it:\n\n${feedback}` : "The user rejected the plan.";
    socket.send({ type: "claude.permission", requestId: req.requestId, allow: !!mode, message: mode ? undefined : message });
    set({ permissions: get().permissions.filter((p) => p.requestId !== req.requestId) });
  },

  openPlan(path: string | null) {
    set({ planPath: path });
  },

  closeSideChat() {
    closeChat(get().sideChatId);
    set({ sideChatId: null });
  },

  renameSession(sessionId: string, title: string) {
    socket.send({ type: "claude.rename", sessionId, title });
    setTimeout(refreshSessions, 300);
  },

  /** Permanently deletes multiple chats (doesn't touch folders or files) */
  deleteSessions(ids: string[]) {
    for (const id of ids) socket.send({ type: "claude.delete", sessionId: id });
    if (ids.includes(get().chats[get().mainChatId ?? ""]?.sessionId ?? "")) actions.newClaudeChat();
    setTimeout(refreshSessions, 500);
  },

  deleteSession(sessionId: string) {
    socket.send({ type: "claude.delete", sessionId });
    if (get().chats[get().mainChatId ?? ""]?.sessionId === sessionId) actions.newClaudeChat();
    setTimeout(refreshSessions, 300);
  },

  refreshSessions,

  // Workers ────────────────────────────────────

  newWorkerChat(workerId: string) {
    set({ activeWorkerChat: { ...get().activeWorkerChat, [workerId]: undefined } });
  },

  openWorkerChat(workerId: string, chatId: string) {
    set({ activeWorkerChat: { ...get().activeWorkerChat, [workerId]: chatId } });
    socket.send({ type: "worker.chat", chatId });
  },

  sendWorker(workerId: string, text: string, attachments: Attachment[] = []) {
    const chatId = get().activeWorkerChat[workerId] ?? uuid();
    const user = { role: "user" as const, content: text, at: Date.now(), attachments: attachments.length ? attachments : undefined };
    const prev = get().workerChats[chatId];
    const chat: LiveWorkerChat = prev
      ? { ...prev, messages: [...prev.messages, user], busy: true, stream: "", streamReasoning: "" }
      : {
          id: chatId,
          workerId,
          title: (text || attachments[0]?.name || "Chat").slice(0, 60),
          updatedAt: Date.now(),
          messages: [user],
          busy: true,
          stream: "",
          streamReasoning: "",
        };
    set({
      workerChats: { ...get().workerChats, [chatId]: chat },
      activeWorkerChat: { ...get().activeWorkerChat, [workerId]: chatId },
    });
    socket.send({
      type: "worker.send",
      workerId,
      chatId,
      text,
      attachments: attachments.length ? attachments : undefined,
      settings: get().workerSettings[workerId],
    });
  },

  setWorkerSettings(workerId: string, patch: Partial<WorkerSettings>) {
    const next = { ...get().workerSettings, [workerId]: { ...get().workerSettings[workerId], ...patch } };
    set({ workerSettings: next });
    save("workerSettings", next);
  },

  loadWorkerModels(workerId: string) {
    socket.send({ type: "worker.models", workerId });
  },

  stopWorker(chatId: string) {
    socket.send({ type: "worker.stop", chatId });
  },

  deleteWorkerChat(workerId: string, chatId: string) {
    socket.send({ type: "worker.deleteChat", chatId });
    if (get().activeWorkerChat[workerId] === chatId) actions.newWorkerChat(workerId);
  },

  saveWorker(worker: WorkerInfo) {
    socket.send({ type: "workers.save", worker });
  },

  deleteWorker(workerId: string) {
    socket.send({ type: "workers.delete", workerId });
  },

  // Interface ─────────────────────────────────────

  setQuote(key: string, quote: string | undefined) {
    set({ quotes: { ...get().quotes, [key]: quote } });
  },

  /** Open the info panel and focus on a section */
  focusInfo(section: string) {
    actions.setUi({ infoOpen: true });
    set({ infoFocus: { section, n: Date.now() }, selected: CLAUDE_ID });
  },

  showOverlay(overlay: Overlay | null) {
    set({ overlay });
  },

  openSetup() {
    set({ setup: { ...get().setup, open: true } });
    socket.send({ type: "setup.status" });
  },

  /** Refreshes setup status without opening the window (for Ollama model suggestions in the worker window) */
  loadSetupStatus() {
    socket.send({ type: "setup.status" });
  },

  closeSetup() {
    set({ setup: { ...get().setup, open: false } });
    save("setupDone", true);
  },

  setupAction(action: SetupAction, key?: string) {
    set({ setup: { ...get().setup, busy: action } });
    if (action === "claudeLogin") socket.send({ type: "setup.claudeLogin" });
    else if (action === "deepseekKey") socket.send({ type: "setup.deepseekKey", key: key ?? "" });
    else if (action === "mcp") socket.send({ type: "setup.mcp" });
    else if (action === "hooks") socket.send({ type: "setup.hooks" });
    else if (action === "agents") socket.send({ type: "setup.agents" });
    else socket.send({ type: "setup.rules" });
  },

  openWorkerModal(worker?: WorkerInfo) {
    set({ workerModal: { open: true, worker } });
  },

  closeWorkerModal() {
    set({ workerModal: { open: false } });
  },
};

/** Agent name and color (including Claude) */
export function agentMeta(id: string, workers: WorkerInfo[]): { name: string; color: string } {
  if (id === CLAUDE_ID) return { name: "Claude", color: "#D97757" };
  const w = workers.find((x) => x.id === id);
  return { name: w?.name ?? id, color: w?.color ?? "#888780" };
}

/** Applies task_* events to the task list */
function updateTasks(tasks: Record<string, ClaudeTask>, m: Record<string, unknown>): Record<string, ClaudeTask> {
  const id = String(m.task_id);
  const prev = tasks[id] ?? { id, description: "Task", status: "running" };
  if (m.subtype === "task_started") return { ...tasks, [id]: { ...prev, description: String(m.description ?? prev.description), status: "running" } };
  if (m.subtype === "task_updated") {
    const patch = (m.patch ?? {}) as { status?: string; description?: string; error?: string };
    return { ...tasks, [id]: { ...prev, ...(patch.status ? { status: patch.status } : {}), ...(patch.description ? { description: patch.description } : {}), ...(patch.error ? { error: patch.error } : {}) } };
  }
  if (m.subtype === "task_notification") return { ...tasks, [id]: { ...prev, status: String(m.status ?? "completed"), summary: m.summary as string | undefined } };
  return tasks;
}
