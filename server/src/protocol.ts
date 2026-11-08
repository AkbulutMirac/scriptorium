/**
 * WebSocket messages between the UI and the backend. The UI uses this file with `import type`,
 * so only types should be here (no Node-specific imports).
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
  /** if true, data never leaves the computer */
  local: boolean;
  available?: { ok: boolean; reason?: string };
};

export type AgentStatus = "idle" | "working" | "error";

/** Who assigned the job: a Claude session (label: project folder) or the user (direct chat) */
export type WorkerCaller = { kind: "claude" | "user"; label?: string };

/**
 * A single request sent to a worker. The same worker can receive jobs from multiple sessions at once:
 * in the 3D office, each request appears as a separate worker copy.
 */
export type WorkerRequest = {
  id: string;
  workerId: string;
  /** queued: the worker's concurrent job limit is full, waiting in line */
  status: "queued" | "running" | "error";
  task: string;
  error?: string;
  caller: WorkerCaller;
  createdAt: number;
  startedAt?: number;
};

/** Event that moves the Claude character in the 3D library (workers use WorkerRequest). */
export type AgentActivity = {
  agentId: string;
  status: AgentStatus;
  task?: string;
  error?: string;
  /** Who assigned the job: "claude" (delegation) or "user" (direct chat) */
  by?: "claude" | "user";
};

export type SessionSummary = {
  id: string;
  title: string;
  updatedAt: number;
  cwd?: string;
  gitBranch?: string;
};

/** Message read from Claude session history (rendered the same way as live SDK messages). */
export type HistoryMessage = {
  type: "user" | "assistant" | "system";
  uuid: string;
  message: unknown;
  parent_tool_use_id: string | null;
};

/** A model in the worker model menu */
export type WorkerModel = {
  id: string;
  /** Whether it can read images (from the capabilities Ollama reports) */
  vision?: boolean;
  /** Parameter count, e.g. "26.9B" */
  size?: string;
};

/** The worker's reasoning level. "none" turns reasoning off. */
export type ReasoningLevel = "none" | "low" | "medium" | "high" | "max";

/** Settings for direct chat with the worker (remembered per worker) */
export type WorkerSettings = {
  /** If empty, the worker's default model */
  model?: string;
  /** If empty, the model's default */
  reasoning?: ReasoningLevel;
  /** Only effective when reasoning is off */
  temperature?: number;
  json?: boolean;
  maxTokens?: number;
  system?: string;
};

export type TokenUsage = {
  prompt: number;
  completion: number;
  cacheHit?: number;
  reasoning?: number;
  /** The model's current context limit (tokens). Context fullness = prompt + completion */
  contextWindow?: number;
};

export type WorkerChatMessage = {
  role: "user" | "assistant";
  content: string;
  at: number;
  error?: boolean;
  /** The model's reasoning text (if any) */
  reasoning?: string;
  /** Files added by the user (including images, base64) */
  attachments?: Attachment[];
  usage?: TokenUsage;
  model?: string;
};

export type WorkerChatSummary = {
  id: string;
  workerId: string;
  title: string;
  updatedAt: number;
  /** Set when a Claude session delegated this task (label: its project folder); absent for direct chats */
  from?: { label?: string };
};

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

/** File attached to a message. Images and PDFs go to Claude as files, text files as content. */
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

/** Usage limits of the Claude subscription (only populated when logged in with a subscription) */
export type UsageInfo = {
  subscription: string | null;
  available: boolean;
  fiveHour?: LimitWindow;
  sevenDay?: LimitWindow;
  sevenDayOpus?: LimitWindow;
  sevenDaySonnet?: LimitWindow;
  sessionCostUsd?: number;
};

/** DeepSeek account balance (GET /user/balance) */
/** Status shown by the initial setup window */
export type SetupStatus = {
  claude: {
    /** Whether the Claude Code program was found (installed or Scriptorium's bundled version) */
    found: boolean;
    cliSource?: "installed" | "bundled";
    loggedIn: boolean;
    email?: string;
    authMethod?: string;
    error?: string;
  };
  deepseek: { configured: boolean };
  ollama: { running: boolean; models: WorkerModel[] };
  /** Whether worker tools were added to all Claude Code sessions */
  mcp: boolean;
  /** Whether delegation rules exist in ~/.claude/CLAUDE.md */
  rules: boolean;
};

export type SetupAction = "claudeLogin" | "deepseekKey" | "mcp" | "rules";

export type DeepSeekBalance = {
  ok: boolean;
  error?: string;
  /** Whether the balance is sufficient for API calls */
  available?: boolean;
  currency?: string;
  total?: number;
  granted?: number;
  toppedUp?: number;
  checkedAt: number;
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
      /** true: only reconnect if already open on the server, otherwise start nothing (on page refresh) */
      attachOnly?: boolean;
    }
  | { type: "claude.setEffort"; chatId: string; effort: EffortLevel }
  | { type: "claude.setFastMode"; chatId: string; on: boolean }
  | { type: "projects.list" }
  | { type: "deepseek.balance" }
  | { type: "fs.list"; path?: string }
  | { type: "claude.send"; chatId: string; text: string; attachments?: Attachment[] }
  | { type: "claude.info"; chatId: string }
  /** Chat-independent info (models, usage, commands): from the server's empty helper session */
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
      /** Allow by modifying the tool's input (e.g. AskUserQuestion answers: { answers: { question: answer } }) */
      updatedInput?: Record<string, unknown>;
    }
  | { type: "claude.sessions"; cwd?: string; all?: boolean }
  | { type: "claude.history"; sessionId: string }
  | { type: "claude.rename"; sessionId: string; title: string }
  | { type: "claude.delete"; sessionId: string }
  | { type: "worker.send"; workerId: string; chatId?: string; text: string; attachments?: Attachment[]; settings?: WorkerSettings }
  | { type: "worker.models"; workerId: string }
  | { type: "worker.stop"; chatId: string }
  | { type: "worker.chats"; workerId: string }
  | { type: "worker.chat"; chatId: string }
  | { type: "worker.deleteChat"; chatId: string }
  | { type: "app.shutdown" }
  | { type: "setup.status" }
  | { type: "setup.claudeLogin" }
  | { type: "setup.deepseekKey"; key: string }
  | { type: "setup.mcp" }
  | { type: "setup.rules" }
  | { type: "workers.list" }
  | { type: "workers.save"; worker: WorkerInfo }
  | { type: "workers.delete"; workerId: string }
  | { type: "jobs.list" };

export type ServerMsg =
  | { type: "welcome"; cwd: string; claudeCodeVersion?: string }
  | ({ type: "claude.info" } & ClaudeInfo)
  | { type: "projects"; projects: ProjectInfo[] }
  | { type: "deepseek.balance"; balance: DeepSeekBalance }
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
  | { type: "claude.history"; sessionId: string; messages: HistoryMessage[]; /** The folder the session belongs to */ cwd?: string }
  | { type: "worker.chats"; workerId: string; chats: WorkerChatSummary[] }
  | { type: "worker.chat"; chat: WorkerChat }
  | { type: "worker.token"; chatId: string; text: string }
  | { type: "worker.reasoning"; chatId: string; text: string }
  | { type: "worker.models"; workerId: string; models: WorkerModel[] }
  | { type: "worker.done"; chatId: string; message: WorkerChatMessage }
  | { type: "workers"; workers: WorkerInfo[] }
  | { type: "activity"; activity: AgentActivity }
  | { type: "jobs"; jobs: JobInfo[] }
  | { type: "worker.requests"; requests: WorkerRequest[] }
  | { type: "setup.status"; status: SetupStatus }
  | { type: "setup.result"; action: SetupAction; ok: boolean; message?: string }
  | { type: "error"; message: string };

/** Permission suggestions stored on the server side (not sent to the UI). */
export type PendingPermission = { suggestions?: PermissionUpdate[] };
