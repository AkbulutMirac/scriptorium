import { toast } from "@heroui/react";
import { create } from "zustand";
import { applyMessage, historyToItems, streamDelta, type ChatItem } from "./lib/claudeItems";
import { socket, type ConnectionStatus } from "./lib/socket";
import { load, save } from "./lib/storage";
import type {
  AgentActivity,
  Attachment,
  ClaudeInfo,
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
} from "./protocol";

export const CLAUDE_ID = "claude";

/** Claude Code'un arka plan görevi (task_started / task_updated / task_notification olaylarından) */
export type ClaudeTask = { id: string; description: string; status: string; error?: string; summary?: string };

/** Oturum açılırken (init) gelen bilgiler */
export type ClaudeInit = {
  version: string;
  slashCommands: string[];
  plugins: { name: string; version?: string; path: string }[];
  skills: string[];
  mcpServers: { name: string; status: string }[];
};

export type ClaudeChat = {
  chatId: string;
  sessionId?: string;
  /** Yan sohbet: ilk mesajda bu oturumdan çatallanır */
  forkFrom?: string;
  isSide: boolean;
  /** Sunucuda Claude Code süreci açık mı */
  opened: boolean;
  busy: boolean;
  items: ChatItem[];
  streamText: string;
  streamThinking: string;
  model?: string;
  permissionMode?: PermissionMode;
  /** Kullanıcının seçtiği ama henüz sunucuya iletilmemiş ayarlar */
  wantModel?: string;
  wantMode?: PermissionMode;
  effort?: EffortLevel;
  wantEffort?: EffortLevel;
  fastMode?: boolean;
  cwd: string;
  /** Claude'un erişebileceği ek klasörler */
  dirs: string[];
  loadingHistory: boolean;
  init?: ClaudeInit;
  info?: ClaudeInfo;
  tasks: Record<string, ClaudeTask>;
};

export type PermissionReq = Extract<ServerMsg, { type: "claude.permissionRequest" }>;
export type LiveWorkerChat = WorkerChat & { stream: string; busy: boolean };
export type Overlay = { title: string; body: string; mono?: boolean; diff?: boolean };
export type UiPrefs = { historyOpen: boolean; chatWidth: number; sideWidth: number; infoOpen: boolean };

type State = {
  connection: ConnectionStatus;
  serverCwd: string;
  /** Yeni Claude sohbetlerinin çalışacağı klasör (boşsa sunucunun varsayılanı) */
  cwd: string;
  workers: WorkerInfo[];
  activity: Record<string, AgentActivity>;
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

  /** Sohbet paneline göre alıntı: Claude için chatId, işçi için "w:<id>" */
  quotes: Record<string, string | undefined>;
  overlay: Overlay | null;
  workerModal: { open: boolean; worker?: WorkerInfo };
  ui: UiPrefs;
  git: Record<string, GitInfo>;
  /** Bilinen proje klasörleri (oturumu olanlar + projeler klasörü) */
  projects: ProjectInfo[];
  /** Tüm projelerin Claude oturumları (geçmiş panelinde projelere göre gruplanır) */
  allSessions: SessionSummary[];
  /** Bilgi panelinde açılıp görünür kılınacak bölüm ("Tümünü gör" gibi) */
  infoFocus: { section: string; n: number } | null;
  /** Klasör gezgini */
  folderPicker: { open: boolean; purpose: "cwd" | "dir"; chatId?: string; listing?: DirListing };
};

const uuid = (): string => crypto.randomUUID();

const savedMain = load<{ chatId: string; sessionId?: string } | null>("mainSession", null);

export const useApp = create<State>(() => ({
  connection: "connecting",
  serverCwd: "",
  cwd: load("cwd", ""),
  workers: [],
  activity: {},
  jobs: [],
  selected: load("selected", CLAUDE_ID),
  sessions: [],
  chats: {},
  mainChatId: null,
  sideChatId: null,
  permissions: [],
  workerChatLists: {},
  workerChats: {},
  activeWorkerChat: {},
  quotes: {},
  overlay: null,
  workerModal: { open: false },
  ui: { historyOpen: true, chatWidth: 520, sideWidth: 440, infoOpen: false, ...load<Partial<UiPrefs>>("ui", {}) },
  git: {},
  projects: [],
  allSessions: [],
  folderPicker: { open: false, purpose: "cwd" },
  infoFocus: null,
}));

const get = useApp.getState;
const set = useApp.setState;

// ─── Yardımcılar ───────────────────────────────────────────────────────────────

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
    streamText: "",
    streamThinking: "",
    cwd,
    dirs: [],
    loadingHistory: false,
    tasks: {},
    ...extra,
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

/** Sohbetin Claude Code sürecini gerekiyorsa açar (ilk mesajda ya da yeniden bağlanınca). */
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

// ─── Sunucu mesajları ──────────────────────────────────────────────────────────

function onServer(msg: ServerMsg) {
  const s = get();
  switch (msg.type) {
    case "welcome": {
      socket.send({ type: "projects.list" });
      // Sohbet, sunucunun varsayılan klasörü gelmeden açılmış olabilir: boş klasörleri doldur
      const chats = Object.fromEntries(Object.entries(s.chats).map(([id, c]) => [id, c.cwd ? c : { ...c, cwd: msg.cwd }]));
      set({ serverCwd: msg.cwd, chats });
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
      if (m.type === "result") {
        if (msg.chatId === s.mainChatId) refreshSessions();
        socket.send({ type: "claude.info", chatId: msg.chatId });
        const cwd = get().chats[msg.chatId]?.cwd;
        if (cwd) socket.send({ type: "git.info", cwd });
      }
      return;
    }

    case "claude.info": {
      const { type: _t, ...info } = msg;
      updateChat(msg.chatId, (c) => ({ ...c, info }));
      return;
    }

    case "claude.allSessions":
      set({ allSessions: msg.sessions });
      return;

    case "projects":
      set({ projects: msg.projects });
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

    case "git.diff":
      set({
        overlay: {
          title: msg.file ? `Değişiklik: ${msg.file}` : "Tüm değişiklikler",
          body: msg.diff || "Değişiklik yok.",
          mono: true,
          diff: true,
        },
      });
      return;

    case "claude.session":
      updateChat(msg.chatId, (c) => ({ ...c, sessionId: msg.sessionId }));
      if (msg.chatId === s.mainChatId) persistMain();
      return;

    case "claude.busy":
      updateChat(msg.chatId, (c) => ({ ...c, busy: msg.busy }));
      return;

    case "claude.closed":
      updateChat(msg.chatId, (c) => ({
        ...c,
        opened: false,
        busy: false,
        items: msg.error ? [...c.items, { kind: "notice", id: uuid(), text: `Claude Code oturumu kapandı: ${msg.error}`, tone: "danger" }] : c.items,
      }));
      return;

    case "claude.permissionRequest":
      if (!s.permissions.some((p) => p.requestId === msg.requestId)) set({ permissions: [...s.permissions, msg] });
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
          updateChat(c.chatId, (x) => ({ ...x, items: historyToItems(msg.messages), loadingHistory: false }));
        }
      }
      return;

    case "worker.chats":
      set({ workerChatLists: { ...s.workerChatLists, [msg.workerId]: msg.chats } });
      return;

    case "worker.chat": {
      const prev = s.workerChats[msg.chat.id];
      set({ workerChats: { ...s.workerChats, [msg.chat.id]: { ...msg.chat, stream: prev?.stream ?? "", busy: prev?.busy ?? false } } });
      return;
    }

    case "worker.token":
      updateWorkerChat(msg.chatId, (c) => ({ ...c, stream: c.stream + msg.text }));
      return;

    case "worker.done":
      updateWorkerChat(msg.chatId, (c) => ({ ...c, messages: [...c.messages, msg.message], stream: "", busy: false, updatedAt: msg.message.at }));
      return;

    case "workers": {
      const selectedGone = s.selected !== CLAUDE_ID && !msg.workers.some((w) => w.id === s.selected);
      set({ workers: msg.workers, ...(selectedGone ? { selected: CLAUDE_ID } : {}) });
      return;
    }

    case "activity":
      set({ activity: { ...s.activity, [msg.activity.agentId]: msg.activity } });
      return;

    case "jobs":
      set({ jobs: msg.jobs });
      return;

    case "error":
      toast.danger(msg.message);
      return;
  }
}

// ─── Bağlantı ──────────────────────────────────────────────────────────────────

let started = false;

export function startConnection() {
  if (started) return;
  started = true;
  socket.onStatus((connection) => set({ connection }));
  socket.onMessage(onServer);
  socket.onOpen(() => {
    const { mainChatId, chats, selected } = get();
    if (!mainChatId) {
      if (savedMain?.sessionId) actions.openClaudeSession(savedMain.sessionId, savedMain.chatId, true);
      else actions.newClaudeChat();
    } else {
      // Yeniden bağlandık: açık sohbetlere yeniden bağlan (sunucu yeniden başladıysa oturum devam ettirilir)
      for (const c of Object.values(chats)) {
        if (c.opened) {
          updateChat(c.chatId, (x) => ({ ...x, opened: false }));
          ensureOpen(c.chatId);
        }
      }
    }
    if (selected !== CLAUDE_ID) socket.send({ type: "worker.chats", workerId: selected });
  });
  socket.connect();
}

// ─── Eylemler ──────────────────────────────────────────────────────────────────

export const actions = {
  selectAgent(id: string) {
    set({ selected: id });
    save("selected", id);
    if (id !== CLAUDE_ID) socket.send({ type: "worker.chats", workerId: id });
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

  /** Yeni Claude sohbeti. cwd verilirse o klasörde açılır ve varsayılan klasör olarak hatırlanır. */
  newClaudeChat(cwd?: string) {
    const prev = get().chats[get().mainChatId ?? ""];
    closeChat(get().sideChatId);
    closeChat(get().mainChatId);
    if (cwd) actions.setCwd(cwd);
    const chatId = uuid();
    const chat = emptyChat(chatId, cwd || effectiveCwd(), { wantModel: prev?.wantModel, wantEffort: prev?.wantEffort ?? prev?.effort });
    set({ chats: { ...get().chats, [chatId]: chat }, mainChatId: chatId, sideChatId: null, selected: CLAUDE_ID });
    persistMain();
  },

  /** Henüz başlamamış sohbetin klasörünü değiştirir; başlamışsa o klasörde yeni sohbet açar. */
  setChatCwd(chatId: string, cwd: string) {
    const c = get().chats[chatId];
    if (!c) return;
    if (c.sessionId || c.items.length) {
      actions.newClaudeChat(cwd);
      return;
    }
    // Henüz mesaj yok: önceden açılmış boş oturumu kapat, ilk mesajda yeni klasörde açılır
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
  },

  setFastMode(chatId: string, on: boolean) {
    const c = get().chats[chatId];
    if (!c) return;
    ensureOpen(chatId);
    socket.send({ type: "claude.setFastMode", chatId, on });
    updateChat(chatId, (x) => ({ ...x, fastMode: on }));
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

  closeFolderPicker() {
    set({ folderPicker: { open: false, purpose: "cwd" } });
  },

  /** Geçmişteki bir oturumu açar. reattach=true: sayfa yenilendi, sunucuda hâlâ açık olabilir. */
  openClaudeSession(sessionId: string, chatId = uuid(), reattach = false) {
    if (get().chats[get().mainChatId ?? ""]?.sessionId === sessionId && !reattach) return;
    closeChat(get().sideChatId);
    closeChat(get().mainChatId);
    const session = get().sessions.find((x) => x.id === sessionId);
    const chat = emptyChat(chatId, session?.cwd || effectiveCwd(), { sessionId, loadingHistory: true });
    set({ chats: { ...get().chats, [chatId]: chat }, mainChatId: chatId, sideChatId: null });
    persistMain();
    socket.send({ type: "claude.history", sessionId });
    if (reattach) ensureOpen(chatId);
  },

  sendClaude(chatId: string, text: string, attachments: Attachment[] = []) {
    ensureOpen(chatId);
    const shown = attachments.length ? `${attachments.map((a) => `📎 ${a.name}`).join("\n")}\n\n${text}` : text;
    updateChat(chatId, (c) => ({ ...c, busy: true, items: [...c.items, { kind: "user", id: uuid(), text: shown }] }));
    socket.send({ type: "claude.send", chatId, text, attachments: attachments.length ? attachments : undefined });
  },

  /** Bilgi paneli ve + menüsü için verileri iste (gerekirse oturumu açar) */
  requestInfo(chatId: string) {
    ensureOpen(chatId);
    socket.send({ type: "claude.info", chatId });
    const cwd = get().chats[chatId]?.cwd;
    if (cwd) socket.send({ type: "git.info", cwd });
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
  },

  setModel(chatId: string, model: string) {
    const c = get().chats[chatId];
    if (!c) return;
    if (c.opened) socket.send({ type: "claude.setModel", chatId, model: model || undefined });
    updateChat(chatId, (x) => ({ ...x, wantModel: model }));
    socket.send({ type: "claude.info", chatId });
  },

  respondPermission(requestId: string, allow: boolean, always = false, updatedInput?: Record<string, unknown>) {
    socket.send({ type: "claude.permission", requestId, allow, always, updatedInput });
    set({ permissions: get().permissions.filter((p) => p.requestId !== requestId) });
  },

  openSideChat(quote?: string) {
    const main = get().chats[get().mainChatId ?? ""];
    if (!main?.sessionId) {
      toast.warning("Yan sohbet için önce ana sohbette bir mesaj gönder.");
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
          text: "Yan sohbet: ana sohbetin bu ana kadarki bağlamını biliyor. Burada konuşulanlar ana sohbete karışmaz.",
          tone: "info",
        },
      ],
    });
    set({ chats: { ...get().chats, [chatId]: side }, sideChatId: chatId, quotes: { ...get().quotes, [chatId]: quote } });
  },

  closeSideChat() {
    closeChat(get().sideChatId);
    set({ sideChatId: null });
  },

  renameSession(sessionId: string, title: string) {
    socket.send({ type: "claude.rename", sessionId, title });
    setTimeout(refreshSessions, 300);
  },

  /** Birden çok sohbeti kalıcı olarak siler (klasöre ve dosyalara dokunmaz) */
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

  // İşçiler ────────────────────────────────────

  newWorkerChat(workerId: string) {
    set({ activeWorkerChat: { ...get().activeWorkerChat, [workerId]: undefined } });
  },

  openWorkerChat(workerId: string, chatId: string) {
    set({ activeWorkerChat: { ...get().activeWorkerChat, [workerId]: chatId } });
    socket.send({ type: "worker.chat", chatId });
  },

  sendWorker(workerId: string, text: string) {
    const chatId = get().activeWorkerChat[workerId] ?? uuid();
    const user = { role: "user" as const, content: text, at: Date.now() };
    const prev = get().workerChats[chatId];
    const chat: LiveWorkerChat = prev
      ? { ...prev, messages: [...prev.messages, user], busy: true, stream: "" }
      : { id: chatId, workerId, title: text.slice(0, 60), updatedAt: Date.now(), messages: [user], busy: true, stream: "" };
    set({
      workerChats: { ...get().workerChats, [chatId]: chat },
      activeWorkerChat: { ...get().activeWorkerChat, [workerId]: chatId },
    });
    socket.send({ type: "worker.send", workerId, chatId, text });
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

  // Arayüz ─────────────────────────────────────

  setQuote(key: string, quote: string | undefined) {
    set({ quotes: { ...get().quotes, [key]: quote } });
  },

  /** Bilgi panelini açıp bir bölümüne odaklan */
  focusInfo(section: string) {
    actions.setUi({ infoOpen: true });
    set({ infoFocus: { section, n: Date.now() }, selected: CLAUDE_ID });
  },

  showOverlay(overlay: Overlay | null) {
    set({ overlay });
  },

  openWorkerModal(worker?: WorkerInfo) {
    set({ workerModal: { open: true, worker } });
  },

  closeWorkerModal() {
    set({ workerModal: { open: false } });
  },
};

/** Ajan adı ve rengi (Claude dahil) */
export function agentMeta(id: string, workers: WorkerInfo[]): { name: string; color: string } {
  if (id === CLAUDE_ID) return { name: "Claude", color: "#D97757" };
  const w = workers.find((x) => x.id === id);
  return { name: w?.name ?? id, color: w?.color ?? "#888780" };
}

/** task_* olaylarını görev listesine işler */
function updateTasks(tasks: Record<string, ClaudeTask>, m: Record<string, unknown>): Record<string, ClaudeTask> {
  const id = String(m.task_id);
  const prev = tasks[id] ?? { id, description: "Görev", status: "running" };
  if (m.subtype === "task_started") return { ...tasks, [id]: { ...prev, description: String(m.description ?? prev.description), status: "running" } };
  if (m.subtype === "task_updated") {
    const patch = (m.patch ?? {}) as { status?: string; description?: string; error?: string };
    return { ...tasks, [id]: { ...prev, ...(patch.status ? { status: patch.status } : {}), ...(patch.description ? { description: patch.description } : {}), ...(patch.error ? { error: patch.error } : {}) } };
  }
  if (m.subtype === "task_notification") return { ...tasks, [id]: { ...prev, status: String(m.status ?? "completed"), summary: m.summary as string | undefined } };
  return tasks;
}
