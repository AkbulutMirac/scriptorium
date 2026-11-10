import { query, type SDKUserMessage } from "@anthropic-ai/claude-agent-sdk";
import os from "node:os";
import type { Worker } from "./agents.js";
import { config } from "./config.js";
import type { ChatMessage, ChatOptions, ChatPart, ChatResult } from "./llm.js";

/**
 * Direct chat with a Claude worker (Haiku, Sonnet) on the user's subscription. A plain chat: no tools, no
 * CLAUDE.md or MCP servers, nothing saved to the Claude Code session history (the chat lives in the worker's history).
 */

const DEFAULT_SYSTEM = "You are a helpful assistant. Answer clearly and to the point.";

type Block =
  | { type: "text"; text: string }
  | { type: "image"; source: { type: "base64"; media_type: string; data: string } }
  | { type: "document"; source: { type: "base64"; media_type: "application/pdf"; data: string }; title?: string };

/** "data:image/png;base64,AAAA" → media type and data */
function dataUrl(url: string): { mediaType: string; data: string } | undefined {
  const m = /^data:([^;]+);base64,(.*)$/s.exec(url);
  return m ? { mediaType: m[1], data: m[2] } : undefined;
}

function toBlocks(content: string | ChatPart[]): Block[] {
  if (typeof content === "string") return [{ type: "text", text: content }];
  return content.flatMap((p): Block[] => {
    if (p.type === "text") return [{ type: "text", text: p.text }];
    const d = dataUrl(p.type === "image_url" ? p.image_url.url : p.file.file_data);
    if (!d) return [];
    if (p.type === "image_url") return [{ type: "image", source: { type: "base64", media_type: d.mediaType, data: d.data } }];
    return [{ type: "document", source: { type: "base64", media_type: "application/pdf", data: d.data }, title: p.file.filename }];
  });
}

const plain = (content: string | ChatPart[]) =>
  typeof content === "string" ? content : content.map((p) => (p.type === "text" ? p.text : "[attachment]")).join("\n");

export async function claudeChat(worker: Worker, messages: ChatMessage[], opts: ChatOptions = {}): Promise<ChatResult> {
  const system = messages.filter((m) => m.role === "system").map((m) => plain(m.content)).join("\n\n") || DEFAULT_SYSTEM;
  const turns = messages.filter((m) => m.role !== "system");
  const last = turns.at(-1);
  if (!last || last.role !== "user") throw new Error("Nothing to answer.");
  // Earlier turns go in as text; the latest message keeps its images and PDFs
  const earlier = turns.slice(0, -1);
  const intro = earlier.length
    ? `Conversation so far:\n<conversation>\n${earlier.map((m) => `<${m.role}>\n${plain(m.content)}\n</${m.role}>`).join("\n")}\n</conversation>\n\nReply to the user's latest message:\n\n`
    : "";
  const blocks = toBlocks(last.content);
  const content = intro ? [{ type: "text" as const, text: intro }, ...blocks] : blocks;

  const abort = new AbortController();
  const onAbort = () => abort.abort();
  opts.signal?.addEventListener("abort", onAbort, { once: true });
  const level = opts.reasoning;
  const q = query({
    prompt: (async function* () {
      yield { type: "user", message: { role: "user", content }, parent_tool_use_id: null } as SDKUserMessage;
    })(),
    options: {
      model: opts.model || worker.model,
      pathToClaudeCodeExecutable: config.claudeCodePath,
      cwd: os.tmpdir(),
      systemPrompt: system,
      tools: [],
      settingSources: [],
      mcpServers: {},
      strictMcpConfig: true,
      maxTurns: 1,
      persistSession: false,
      includePartialMessages: true,
      ...(level === "none" ? { thinking: { type: "disabled" as const } } : level ? { effort: level } : {}),
      abortController: abort,
    },
  });

  let streamed = "";
  let reasoning = "";
  try {
    for await (const msg of q) {
      if (msg.type === "stream_event") {
        const ev = msg.event as { type?: string; delta?: { type?: string; text?: string; thinking?: string } };
        if (ev.type !== "content_block_delta") continue;
        if (ev.delta?.type === "text_delta" && ev.delta.text) {
          streamed += ev.delta.text;
          opts.onToken?.(ev.delta.text);
        } else if (ev.delta?.type === "thinking_delta" && ev.delta.thinking) {
          reasoning += ev.delta.thinking;
          opts.onReasoning?.(ev.delta.thinking);
        }
        continue;
      }
      if (msg.type !== "result") continue;
      if (msg.subtype !== "success" || msg.is_error) {
        const errors = "errors" in msg && Array.isArray(msg.errors) ? msg.errors.join(" ") : "";
        throw new Error(errors || ("result" in msg ? String(msg.result) : "") || `Claude stopped (${msg.subtype}).`);
      }
      const u = msg.usage;
      const cacheRead = u.cache_read_input_tokens ?? 0;
      return {
        content: msg.result || streamed,
        reasoning,
        usage: {
          prompt: u.input_tokens + cacheRead + (u.cache_creation_input_tokens ?? 0),
          completion: u.output_tokens,
          cacheHit: cacheRead || undefined,
          contextWindow: Object.values(msg.modelUsage ?? {})[0]?.contextWindow,
        },
      };
    }
    throw new Error("Claude ended without an answer.");
  } finally {
    opts.signal?.removeEventListener("abort", onAbort);
    q.close();
  }
}
