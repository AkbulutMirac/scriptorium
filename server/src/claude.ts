import {
  query,
  type HookCallbackMatcher,
  type HookEvent,
  type CanUseTool,
  type PermissionMode,
  type Query,
  type SDKMessage,
  type SDKUserMessage,
} from "@anthropic-ai/claude-agent-sdk";
import { readFileSync } from "node:fs";
import path from "node:path";
import { config, SERVER_ROOT } from "./config.js";
import type { Attachment, ClaudeInfo, EffortLevel, LimitWindow, McpServerInfo, ModelOption, UsageInfo } from "./protocol.js";
import { handleSubagentHook } from "./subagents.js";
import { TEAM_AGENTS } from "./team.js";
import { createWorkerServer, WORKER_SERVER_NAME } from "./workerTools.js";

/** Simple queue that streams user messages to the SDK. As long as the session stays open, it waits for new messages. */
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

// When to delegate comes from docs/CLAUDE-workers.md (only in sessions opened here), and how to use the tools is written in the MCP instructions.
const WORKER_RULES = readFileSync(path.join(SERVER_ROOT, "..", "docs", "CLAUDE-workers.md"), "utf8");
export const SYSTEM_APPEND =
  "This session was opened from the Scriptorium interface. The user sees the workers (mcp__scriptorium__*) and your Haiku and Sonnet subagents at work in a 3D office. " +
  "When to hand work to them is up to you (see the Scriptorium helpers notes below).\n\n" +
  WORKER_RULES;

export type ClaudeSessionOptions = {
  cwd?: string;
  /** Session id to resume */
  resume?: string;
  /** If true, the `resume`d session is copied and the original session is unchanged (for side chat) */
  fork?: boolean;
  /** Additional folders Claude can access */
  additionalDirectories?: string[];
  model?: string;
  effort?: EffortLevel;
  /**
   * Where the worker tools should come from. "http": the /mcp address of the running Scriptorium server (same as all Claude Code
   * sessions). "sdk": in-process server (for the CLI running without a server).
   */
  workerTools?: "http" | "sdk";
  onMessage: (msg: SDKMessage) => void;
  canUseTool: CanUseTool;
};

/**
 * Worker tools that run without asking for permission. The "scriptorium" server added by the user (user) or provided by us
 * (sdk, dynamic); a server with the same name in a project's .mcp.json does not count.
 */
const TRUSTED_WORKER_SOURCES = new Set(["sdk", "dynamic", "user"]);

/**
 * Subagents of this session are asked for a report at the end, and Haiku and Sonnet ones appear in the office
 * (other sessions do the same over HTTP hooks).
 */
const subagentHook: HookCallbackMatcher = {
  hooks: [async (input) => (await handleSubagentHook(input)) as never],
};
const SUBAGENT_HOOKS: Partial<Record<HookEvent, HookCallbackMatcher[]>> = {
  PreToolUse: [{ matcher: "Agent|Task|mcp__scriptorium__build", ...subagentHook }],
  PostToolUse: [{ matcher: "Agent|Task", ...subagentHook }],
  PostToolUseFailure: [{ matcher: "Agent|Task", ...subagentHook }],
  SubagentStop: [subagentHook],
  // The builder gets the user's latest message (builder.ts)
  UserPromptSubmit: [subagentHook],
};

/** A single chat session connected to Claude Code running in the background. */
export class ClaudeSession {
  private inbox = new MessageQueue();
  private q: Query;
  sessionId: string | undefined;
  /** Ends when the session closes or errors out. */
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
        model: opts.model || undefined,
        effort: opts.effort,
        includePartialMessages: true,
        // Lets the user pick "Bypass permissions" from the mode menu; sessions don't start in it
        allowDangerouslySkipPermissions: true,
        systemPrompt: { type: "preset", preset: "claude_code", append: SYSTEM_APPEND },
        hooks: SUBAGENT_HOOKS,
        // The specialist team (agents/*.md); a copy in ~/.claude/agents loads too, these take precedence
        agents: TEAM_AGENTS,
        // If the user added the server to their global settings (claude mcp add), that one is used; both go to the same address.
        mcpServers: {
          [WORKER_SERVER_NAME]:
            opts.workerTools === "http"
              ? { type: "http", url: `http://127.0.0.1:${config.port}/mcp` }
              : createWorkerServer({ cwd, caller: { kind: "claude", label: path.basename(cwd) || "Claude" } }),
        },
        canUseTool: (toolName, input, options) =>
          // Our own worker tools run without asking for permission. We check the source not only by name but also by `source`.
          options.mcpServer?.name === WORKER_SERVER_NAME && TRUSTED_WORKER_SOURCES.has(options.mcpServer.source)
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

  /** Info panel data: context usage, MCP servers, slash commands */
  async info(chatId: string): Promise<ClaudeInfo> {
    const withTimeout = <T,>(p: Promise<T>) => Promise.race([p, new Promise<never>((_, rej) => setTimeout(() => rej(new Error("timed out")), 15_000))]);
    const [ctx, mcp, cmds, models, usage] = await Promise.allSettled([
      withTimeout(this.q.getContextUsage()),
      withTimeout(this.q.mcpServerStatus()),
      withTimeout(this.q.supportedCommands()),
      withTimeout(this.q.supportedModels()),
      // Experimental API: if it changes or errors, usage info is simply not shown
      withTimeout(this.q.usage_EXPERIMENTAL_MAY_CHANGE_DO_NOT_RELY_ON_THIS_API_YET({ skipBehaviors: true })),
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
      models:
        models.status === "fulfilled"
          ? models.value.map(
              (m): ModelOption => ({
                value: m.value,
                resolvedModel: m.resolvedModel,
                displayName: m.displayName,
                description: m.description,
                efforts: m.supportedEffortLevels ?? [],
                fastMode: !!m.supportsFastMode,
              }),
            )
          : undefined,
      usage: usage.status === "fulfilled" ? toUsage(usage.value) : undefined,
    };
  }

  setEffort(effort: EffortLevel) {
    return this.q.applyFlagSettings({ effortLevel: effort });
  }

  setFastMode(on: boolean) {
    return this.q.applyFlagSettings({ fastMode: on });
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

/** Converts the attachment into a content block Claude can understand */
function attachmentBlock(a: Attachment) {
  if (IMAGE_TYPES.has(a.mediaType)) {
    return { type: "image" as const, source: { type: "base64" as const, media_type: a.mediaType, data: a.data } };
  }
  if (a.mediaType === "application/pdf") {
    return { type: "document" as const, source: { type: "base64" as const, media_type: "application/pdf" as const, data: a.data }, title: a.name };
  }
  const text = Buffer.from(a.data, "base64").toString("utf8");
  return { type: "text" as const, text: `<attachment name="${a.name}">
${text}
</attachment>` };
}

type RawWindow = { utilization: number | null; resets_at: string | null } | undefined | null;
const win = (w: RawWindow): LimitWindow | undefined => (w ? { utilization: w.utilization, resetsAt: w.resets_at } : undefined);

function toUsage(u: {
  subscription_type: string | null;
  rate_limits_available: boolean;
  rate_limits: Record<string, unknown> | null;
  session?: { total_cost_usd?: number };
}): UsageInfo {
  const r = (u.rate_limits ?? {}) as Record<string, RawWindow>;
  return {
    subscription: u.subscription_type,
    available: u.rate_limits_available,
    fiveHour: win(r.five_hour),
    sevenDay: win(r.seven_day),
    sevenDayOpus: win(r.seven_day_opus),
    sevenDaySonnet: win(r.seven_day_sonnet),
    sessionCostUsd: u.session?.total_cost_usd,
  };
}
