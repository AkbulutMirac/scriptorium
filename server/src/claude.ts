import {
  query,
  type CanUseTool,
  type PermissionMode,
  type Query,
  type SDKMessage,
  type SDKUserMessage,
} from "@anthropic-ai/claude-agent-sdk";
import { config } from "./config.js";
import type { Attachment, ClaudeInfo, McpServerInfo } from "./protocol.js";
import { createWorkerServer } from "./workerTools.js";

/** Kullanıcı mesajlarını SDK'ya akış halinde veren basit kuyruk. Oturum açık kaldıkça yeni mesaj beklenir. */
class MessageQueue implements AsyncIterable<SDKUserMessage> {
  private items: SDKUserMessage[] = [];
  private waiting: ((r: IteratorResult<SDKUserMessage>) => void) | null = null;
  private ended = false;

  push(item: SDKUserMessage) {
    if (this.waiting) {
      this.waiting({ value: item, done: false });
      this.waiting = null;
    } else {
      this.items.push(item);
    }
  }

  end() {
    this.ended = true;
    this.waiting?.({ value: undefined, done: true });
    this.waiting = null;
  }

  [Symbol.asyncIterator](): AsyncIterator<SDKUserMessage> {
    return {
      next: () => {
        const item = this.items.shift();
        if (item) return Promise.resolve({ value: item, done: false });
        if (this.ended) return Promise.resolve({ value: undefined, done: true });
        return new Promise((resolve) => (this.waiting = resolve));
      },
    };
  }
}

const SYSTEM_APPEND = [
  "Bu oturum Scriptorium arayüzünden açıldı. Sen baş yazıcısın (patron): mcp__workers__* araçlarıyla",
  "DeepSeek ve local LLM işçilerine iş devredebilirsin (list_workers, ask_worker, uzun işler için start_job ve job_status).",
  "Ne zaman devredeceğine sen karar verirsin; araç açıklamalarındaki kurallara uy. Kullanıcı bir işçiyi adıyla isterse onu kullan.",
].join(" ");

export type ClaudeSessionOptions = {
  cwd?: string;
  /** Devam ettirilecek oturum id'si */
  resume?: string;
  /** true ise `resume` edilen oturum kopyalanır, asıl oturum değişmez (yan sohbet için) */
  fork?: boolean;
  /** Claude'un erişebileceği ek klasörler */
  additionalDirectories?: string[];
  onMessage: (msg: SDKMessage) => void;
  canUseTool: CanUseTool;
};

/** Arkada çalışan Claude Code'a bağlı tek bir sohbet oturumu. */
export class ClaudeSession {
  private inbox = new MessageQueue();
  private q: Query;
  sessionId: string | undefined;
  /** Oturum kapanınca ya da hata verince biter. */
  readonly done: Promise<void>;

  constructor(opts: ClaudeSessionOptions) {
    const cwd = opts.cwd ?? config.claudeCwd;
    this.sessionId = opts.fork ? undefined : opts.resume;
    const q = query({
      prompt: this.inbox,
      options: {
        cwd,
        pathToClaudeCodeExecutable: config.claudeCodePath,
        resume: opts.resume,
        forkSession: opts.fork,
        additionalDirectories: opts.additionalDirectories?.length ? opts.additionalDirectories : undefined,
        includePartialMessages: true,
        systemPrompt: { type: "preset", preset: "claude_code", append: SYSTEM_APPEND },
        mcpServers: { workers: createWorkerServer(cwd) },
        canUseTool: (toolName, input, options) =>
          // Kendi işçi araçlarımız (SDK içi sunucu) izin sormadan çalışır. Kaynağı isme göre değil `source`'a göre kontrol ediyoruz.
          options.mcpServer?.source === "sdk" && options.mcpServer.name === "workers"
            ? Promise.resolve({ behavior: "allow", updatedInput: input })
            : opts.canUseTool(toolName, input, options),
      },
    });
    this.q = q;

    this.done = (async () => {
      for await (const msg of q) {
        if ("session_id" in msg && msg.session_id) this.sessionId = msg.session_id;
        opts.onMessage(msg);
      }
    })();
  }

  send(text: string, attachments: Attachment[] = []) {
    const content = attachments.length ? [...attachments.map(attachmentBlock), { type: "text" as const, text }] : text;
    this.inbox.push({
      type: "user",
      message: { role: "user", content: content as SDKUserMessage["message"]["content"] },
      parent_tool_use_id: null,
    });
  }

  /** Bilgi panelinin verileri: bağlam doluluğu, MCP sunucuları, slash komutları */
  async info(chatId: string): Promise<ClaudeInfo> {
    const withTimeout = <T,>(p: Promise<T>) => Promise.race([p, new Promise<never>((_, rej) => setTimeout(() => rej(new Error("zaman aşımı")), 15_000))]);
    const [ctx, mcp, cmds] = await Promise.allSettled([
      withTimeout(this.q.getContextUsage()),
      withTimeout(this.q.mcpServerStatus()),
      withTimeout(this.q.supportedCommands()),
    ]);
    return {
      chatId,
      context:
        ctx.status === "fulfilled"
          ? { percentage: ctx.value.percentage, totalTokens: ctx.value.totalTokens, maxTokens: ctx.value.maxTokens }
          : undefined,
      mcp:
        mcp.status === "fulfilled"
          ? mcp.value.map(
              (m): McpServerInfo => ({ name: m.name, status: m.status, error: m.error, toolCount: m.tools?.length, scope: m.scope }),
            )
          : undefined,
      commands:
        cmds.status === "fulfilled"
          ? cmds.value.map((c) => ({ name: c.name, description: c.description, argumentHint: c.argumentHint || undefined }))
          : undefined,
    };
  }

  toggleMcp(server: string, enabled: boolean) {
    return this.q.toggleMcpServer(server, enabled);
  }

  reconnectMcp(server: string) {
    return this.q.reconnectMcpServer(server);
  }

  stopTask(taskId: string) {
    return this.q.stopTask(taskId);
  }

  interrupt() {
    return this.q.interrupt();
  }

  setPermissionMode(mode: PermissionMode) {
    return this.q.setPermissionMode(mode);
  }

  setModel(model?: string) {
    return this.q.setModel(model);
  }

  close() {
    this.inbox.end();
    this.q.close();
  }
}

const IMAGE_TYPES = new Set(["image/png", "image/jpeg", "image/gif", "image/webp"]);

/** Ek dosyayı Claude'un anlayacağı içerik bloğuna çevirir */
function attachmentBlock(a: Attachment) {
  if (IMAGE_TYPES.has(a.mediaType)) {
    return { type: "image" as const, source: { type: "base64" as const, media_type: a.mediaType, data: a.data } };
  }
  if (a.mediaType === "application/pdf") {
    return { type: "document" as const, source: { type: "base64" as const, media_type: "application/pdf" as const, data: a.data }, title: a.name };
  }
  const text = Buffer.from(a.data, "base64").toString("utf8");
  return { type: "text" as const, text: `<ek-dosya ad="${a.name}">
${text}
</ek-dosya>` };
}
