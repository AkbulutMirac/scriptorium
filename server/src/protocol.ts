/**
 * Arayüz ile arka uç arasındaki WebSocket mesajları. Arayüz bu dosyayı `import type` ile kullanır,
 * o yüzden burada sadece tip olmalı (Node'a özel import yok).
 */
import type { PermissionMode, PermissionUpdate, SDKMessage } from "@anthropic-ai/claude-agent-sdk";

export type { PermissionMode, SDKMessage };

export type Provider = "deepseek" | "ollama";

export type WorkerInfo = {
  id: string;
  name: string;
  provider: Provider;
  model: string;
  color: string;
  description: string;
  /** true ise veri bilgisayardan çıkmaz */
  local: boolean;
  available?: { ok: boolean; reason?: string };
};

export type AgentStatus = "idle" | "working" | "error";

/** 3D kütüphanedeki karakterleri hareket ettiren olay. agentId "claude" ya da bir işçi id'si. */
export type AgentActivity = {
  agentId: string;
  status: AgentStatus;
  task?: string;
  error?: string;
  /** İşi kim verdi: "claude" (devretme) ya da "user" (doğrudan sohbet) */
  by?: "claude" | "user";
};

export type SessionSummary = {
  id: string;
  title: string;
  updatedAt: number;
  cwd?: string;
  gitBranch?: string;
};

/** Claude oturum geçmişinden okunan mesaj (canlı SDK mesajlarıyla aynı şekilde çizilir). */
export type HistoryMessage = {
  type: "user" | "assistant" | "system";
  uuid: string;
  message: unknown;
  parent_tool_use_id: string | null;
};

export type WorkerChatMessage = { role: "user" | "assistant"; content: string; at: number; error?: boolean };

export type WorkerChatSummary = { id: string; workerId: string; title: string; updatedAt: number };

export type WorkerChat = WorkerChatSummary & { messages: WorkerChatMessage[] };

export type JobInfo = {
  id: string;
  workerId: string;
  task: string;
  status: "queued" | "running" | "done" | "error";
  createdAt: number;
  finishedAt?: number;
  result?: string;
  error?: string;
};

/** Mesaja eklenen dosya. Görseller ve PDF'ler Claude'a dosya olarak, metin dosyaları içerik olarak gider. */
export type Attachment = { name: string; mediaType: string; /** base64 */ data: string };

export type McpServerInfo = { name: string; status: string; error?: string; toolCount?: number; scope?: string };
export type SlashCommandInfo = { name: string; description: string; argumentHint?: string };
export type ContextInfo = { percentage: number; totalTokens: number; maxTokens: number };

export type EffortLevel = "low" | "medium" | "high" | "xhigh" | "max";

export type ModelOption = {
  value: string;
  resolvedModel?: string;
  displayName: string;
  description: string;
  efforts: EffortLevel[];
  fastMode: boolean;
};

export type LimitWindow = { utilization: number | null; resetsAt: string | null };

/** Claude aboneliğinin kullanım limitleri (sadece abonelik girişinde dolu gelir) */
export type UsageInfo = {
  subscription: string | null;
  available: boolean;
  fiveHour?: LimitWindow;
  sevenDay?: LimitWindow;
  sevenDayOpus?: LimitWindow;
  sevenDaySonnet?: LimitWindow;
  sessionCostUsd?: number;
};

export type ProjectInfo = { path: string; name: string; lastUsed: number; sessionCount: number };

export type DirListing = { path: string; parent?: string; dirs: { name: string; path: string }[] };

export type ClaudeInfo = {
  chatId: string;
  context?: ContextInfo;
  mcp?: McpServerInfo[];
  commands?: SlashCommandInfo[];
  models?: ModelOption[];
  usage?: UsageInfo;
};

export type GitInfo = {
  cwd: string;
  isRepo: boolean;
  branch?: string;
  added: number;
  removed: number;
  files: { path: string; added: number; removed: number; untracked?: boolean }[];
};

export type ClientMsg =
  | {
      type: "claude.open";
      chatId: string;
      resume?: string;
      fork?: boolean;
      cwd?: string;
      additionalDirectories?: string[];
      model?: string;
      effort?: EffortLevel;
      /** true: sadece sunucuda zaten açıksa yeniden bağlan, değilse hiçbir şey başlatma (sayfa yenilenince) */
      attachOnly?: boolean;
    }
  | { type: "claude.setEffort"; chatId: string; effort: EffortLevel }
  | { type: "claude.setFastMode"; chatId: string; on: boolean }
  | { type: "projects.list" }
  | { type: "fs.list"; path?: string }
  | { type: "claude.send"; chatId: string; text: string; attachments?: Attachment[] }
  | { type: "claude.info"; chatId: string }
  /** Sohbetten bağımsız bilgi (modeller, kullanım, komutlar): sunucunun boş yardımcı oturumundan */
  | { type: "claude.globalInfo" }
  | { type: "claude.setDirs"; chatId: string; dirs: string[] }
  | { type: "claude.mcpToggle"; chatId: string; server: string; enabled: boolean }
  | { type: "claude.mcpReconnect"; chatId: string; server: string }
  | { type: "claude.stopTask"; chatId: string; taskId: string }
  | { type: "git.info"; cwd: string }
  | { type: "git.diff"; cwd: string; file?: string }
  | { type: "claude.interrupt"; chatId: string }
  | { type: "claude.close"; chatId: string }
  | { type: "claude.setMode"; chatId: string; mode: PermissionMode }
  | { type: "claude.setModel"; chatId: string; model?: string }
  | {
      type: "claude.permission";
      requestId: string;
      allow: boolean;
      always?: boolean;
      /** Aracın girdisini değiştirerek izin ver (örneğin AskUserQuestion cevapları: { answers: { soru: cevap } }) */
      updatedInput?: Record<string, unknown>;
    }
  | { type: "claude.sessions"; cwd?: string; all?: boolean }
  | { type: "claude.history"; sessionId: string }
  | { type: "claude.rename"; sessionId: string; title: string }
  | { type: "claude.delete"; sessionId: string }
  | { type: "worker.send"; workerId: string; chatId?: string; text: string }
  | { type: "worker.stop"; chatId: string }
  | { type: "worker.chats"; workerId: string }
  | { type: "worker.chat"; chatId: string }
  | { type: "worker.deleteChat"; chatId: string }
  | { type: "workers.list" }
  | { type: "workers.save"; worker: WorkerInfo }
  | { type: "workers.delete"; workerId: string }
  | { type: "jobs.list" };

export type ServerMsg =
  | { type: "welcome"; cwd: string; claudeCodeVersion?: string }
  | ({ type: "claude.info" } & ClaudeInfo)
  | { type: "projects"; projects: ProjectInfo[] }
  | ({ type: "fs.list" } & DirListing)
  | { type: "claude.allSessions"; sessions: SessionSummary[] }
  | { type: "claude.dirs"; chatId: string; dirs: string[] }
  | ({ type: "git.info" } & GitInfo)
  | { type: "git.diff"; cwd: string; file?: string; diff: string }
  | { type: "claude.message"; chatId: string; message: SDKMessage }
  | { type: "claude.session"; chatId: string; sessionId: string }
  | { type: "claude.busy"; chatId: string; busy: boolean }
  | { type: "claude.closed"; chatId: string; error?: string }
  | {
      type: "claude.permissionRequest";
      chatId: string;
      requestId: string;
      toolName: string;
      input: Record<string, unknown>;
      title?: string;
      description?: string;
      canAlwaysAllow: boolean;
    }
  | { type: "claude.permissionResolved"; requestId: string }
  | { type: "claude.sessions"; sessions: SessionSummary[] }
  | { type: "claude.history"; sessionId: string; messages: HistoryMessage[]; /** Oturumun ait olduğu klasör */ cwd?: string }
  | { type: "worker.chats"; workerId: string; chats: WorkerChatSummary[] }
  | { type: "worker.chat"; chat: WorkerChat }
  | { type: "worker.token"; chatId: string; text: string }
  | { type: "worker.done"; chatId: string; message: WorkerChatMessage }
  | { type: "workers"; workers: WorkerInfo[] }
  | { type: "activity"; activity: AgentActivity }
  | { type: "jobs"; jobs: JobInfo[] }
  | { type: "error"; message: string };

/** Sunucu tarafında saklanan izin önerileri (arayüze gönderilmez). */
export type PendingPermission = { suggestions?: PermissionUpdate[] };
