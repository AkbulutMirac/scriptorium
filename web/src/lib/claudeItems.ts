/**
 * Converts messages coming from Claude Code (SDK) into items on the chat screen.
 * Live messages and messages read from history go through the same function.
 * If an unrecognized new message type arrives, it appears as an "unknown" card; the UI won't break when Claude Code is updated.
 */

/** Image in the message: a data: address if base64, otherwise the direct address */
export type ChatImage = { src: string; name?: string };

export type ToolResult = { text: string; isError: boolean; images?: ChatImage[] };

export type ChatItem =
  | { kind: "user"; id: string; text: string; images?: ChatImage[] }
  | { kind: "text"; id: string; text: string; parent: string | null }
  | { kind: "thinking"; id: string; text: string; parent: string | null }
  | { kind: "tool"; id: string; name: string; input: Record<string, unknown>; result?: ToolResult; parent: string | null }
  | { kind: "notice"; id: string; text: string; tone: "info" | "danger" }
  | { kind: "result"; id: string; durationMs?: number; costUsd?: number }
  | { kind: "unknown"; id: string; label: string; data: unknown };

type Block = { type: string; [k: string]: unknown };
type AnyMsg = { type: string; subtype?: string; uuid?: string; message?: unknown; parent_tool_use_id?: string | null; [k: string]: unknown };

/** Internal events that are silently skipped */
const IGNORED_TYPES = new Set([
  "stream_event",
  "tool_progress",
  "auth_status",
  "tool_use_summary",
  "rate_limit_event",
  "prompt_suggestion",
  "keep_alive",
]);
const IGNORED_SYSTEM = new Set([
  "init",
  "status",
  "control_request_progress",
  "hook_started",
  "hook_progress",
  "hook_response",
  "plugin_install",
  "task_started",
  "task_updated",
  "task_progress",
  "task_notification",
  "background_tasks_changed",
  "thinking_tokens",
  "session_state_changed",
  "worker_shutting_down",
  "commands_changed",
  "files_persisted",
  "memory_recall",
  "elicitation_complete",
  "post_turn_summary",
  "task_summary",
]);
/** System events shown as info notices */
const NOTICE_SYSTEM: Record<string, { text: string; tone: "info" | "danger" }> = {
  compact_boundary: { text: "Chat summarized, context compacted.", tone: "info" },
  api_retry: { text: "Couldn't reach the API, retrying…", tone: "info" },
  model_refusal_fallback: { text: "Model declined the request, switched to fallback model.", tone: "info" },
  model_refusal_no_fallback: { text: "Model declined the request.", tone: "danger" },
  permission_denied: { text: "Tool permission denied.", tone: "danger" },
  mirror_error: { text: "Session log error.", tone: "danger" },
  session_writes_lost: { text: "Part of the session couldn't be written to disk.", tone: "danger" },
};

let seq = 0;
const uid = (prefix: string) => `${prefix}-${Date.now().toString(36)}-${(seq++).toString(36)}`;

function contentOf(message: unknown): Block[] | string | undefined {
  const content = (message as { content?: unknown } | undefined)?.content;
  if (typeof content === "string") return content;
  if (Array.isArray(content)) return content as Block[];
  return undefined;
}

/** Converts the image in an Anthropic content block into a displayable address */
export function imageOf(b: Block): ChatImage | null {
  const src = b.source as { type?: string; media_type?: string; data?: string; url?: string } | undefined;
  if (!src) return null;
  if (src.type === "base64" && src.data) return { src: `data:${src.media_type ?? "image/png"};base64,${src.data}` };
  if (src.type === "url" && src.url) return { src: src.url };
  return null;
}

function imagesOf(content: unknown): ChatImage[] {
  if (!Array.isArray(content)) return [];
  return (content as Block[]).filter((c) => c.type === "image").map(imageOf).filter((x): x is ChatImage => !!x);
}

export function toolResultText(content: unknown): string {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return (content as Block[])
      .filter((c) => c.type !== "image")
      .map((c) => (c.type === "text" ? String(c.text ?? "") : `[${c.type}]`))
      .join("\n");
  }
  return "";
}

/** The first meaningful text field in the message (for info notices) */
function firstText(msg: AnyMsg): string | undefined {
  for (const key of ["content", "text", "message", "error", "reason", "title"]) {
    const v = msg[key];
    if (typeof v === "string" && v.trim()) return v.trim();
  }
  return undefined;
}

/** Cleans up the internal tags Claude Code adds to user messages */
function cleanUserText(text: string): string {
  return text
    .replace(/<system-reminder>[\s\S]*?<\/system-reminder>/g, "")
    .replace(/<(command-name|command-message|command-args|local-command-stdout|local-command-caveat)>[\s\S]*?<\/\1>/g, "")
    .trim();
}

function attachResult(items: ChatItem[], toolUseId: string, result: ToolResult): ChatItem[] {
  for (let i = items.length - 1; i >= 0; i--) {
    const it = items[i];
    if (it.kind === "tool" && it.id === toolUseId) {
      const copy = [...items];
      copy[i] = { ...it, result };
      return copy;
    }
  }
  return items;
}

function userTextItem(text: string, idSource?: string, images: ChatImage[] = []): ChatItem | null {
  if (/^\[Request interrupted/i.test(text)) return { kind: "notice", id: idSource ?? uid("n"), text: "Stopped.", tone: "info" };
  const clean = cleanUserText(text);
  if (!clean && !images.length) return null;
  return { kind: "user", id: idSource ?? uid("u"), text: clean, images: images.length ? images : undefined };
}

/**
 * Applies an SDK message to the item list and returns the new list.
 * live=true: live stream (the user's own message is already on screen, so it isn't added again).
 * live=false: loading from history.
 */
export function applyMessage(items: ChatItem[], raw: unknown, live: boolean): ChatItem[] {
  const msg = raw as AnyMsg;
  const parent = msg.parent_tool_use_id ?? null;

  switch (msg.type) {
    case "assistant": {
      const blocks = contentOf(msg.message);
      if (!Array.isArray(blocks)) return items;
      let out = [...items];
      blocks.forEach((b, i) => {
        const id = `${msg.uuid ?? uid("a")}:${i}`;
        if (out.some((x) => x.id === id)) return;
        if (b.type === "text") {
          if (String(b.text ?? "").trim()) out.push({ kind: "text", id, text: String(b.text), parent });
        } else if (b.type === "thinking") {
          if (String(b.thinking ?? "").trim()) out.push({ kind: "thinking", id, text: String(b.thinking), parent });
        } else if (b.type === "redacted_thinking") {
          // no content to display
        } else if (b.type === "tool_use" || b.type === "server_tool_use" || b.type === "mcp_tool_use") {
          out.push({ kind: "tool", id: String(b.id), name: String(b.name), input: (b.input ?? {}) as Record<string, unknown>, parent });
        } else if (b.type.endsWith("_tool_result")) {
          out = attachResult(out, String(b.tool_use_id), { text: toolResultText(b.content), isError: !!b.is_error, images: imagesOf(b.content) });
        } else {
          out.push({ kind: "unknown", id, label: `Content block: ${b.type}`, data: b });
        }
      });
      return out;
    }

    case "user": {
      const content = contentOf(msg.message);
      const showText = !live || msg.isSynthetic === true;
      if (typeof content === "string") {
        if (!showText) return items;
        const item = userTextItem(content, msg.uuid);
        return item ? [...items, item] : items;
      }
      if (!Array.isArray(content)) return items;
      let out = items;
      const texts: string[] = [];
      const images: ChatImage[] = [];
      for (const b of content) {
        if (b.type === "tool_result") {
          out = attachResult(out, String(b.tool_use_id), { text: toolResultText(b.content), isError: !!b.is_error, images: imagesOf(b.content) });
        } else if (b.type === "text") {
          texts.push(String(b.text ?? ""));
        } else if (b.type === "image") {
          const img = imageOf(b);
          if (img) images.push(img);
        }
      }
      if ((texts.length || images.length) && showText && parent === null) {
        const item = userTextItem(texts.join("\n"), msg.uuid, images);
        if (item) out = [...out, item];
      }
      return out;
    }

    case "result": {
      if (msg.is_error) {
        const errors = Array.isArray(msg.errors) ? (msg.errors as string[]).join("\n") : "";
        const text = (typeof msg.result === "string" && msg.result) || errors || `Turn ended with an error (${msg.subtype}).`;
        return [...items, { kind: "notice", id: uid("r"), text, tone: "danger" }];
      }
      return [
        ...items,
        { kind: "result", id: uid("r"), durationMs: msg.duration_ms as number | undefined, costUsd: msg.total_cost_usd as number | undefined },
      ];
    }

    case "system": {
      const sub = msg.subtype ?? "";
      if (IGNORED_SYSTEM.has(sub)) return items;
      const known = NOTICE_SYSTEM[sub];
      if (known) return [...items, { kind: "notice", id: uid("s"), text: known.text, tone: known.tone }];
      if (sub === "local_command_output" || sub === "notification" || sub === "informational") {
        const text = firstText(msg);
        return text ? [...items, { kind: "notice", id: uid("s"), text, tone: "info" }] : items;
      }
      return [...items, { kind: "unknown", id: uid("s"), label: `System event: ${sub || "?"}`, data: msg }];
    }

    case "conversation_reset":
      return [...items, { kind: "notice", id: uid("s"), text: "Chat reset.", tone: "info" }];

    default:
      if (IGNORED_TYPES.has(msg.type)) return items;
      return [...items, { kind: "unknown", id: uid("x"), label: `Message type: ${msg.type}`, data: msg }];
  }
}

export function historyToItems(messages: unknown[]): ChatItem[] {
  return messages.reduce<ChatItem[]>((items, m) => applyMessage(items, m, false), []);
}

/** Returns the streaming text chunk (main agent only, not subagents) */
export function streamDelta(raw: unknown): { text?: string; thinking?: string } | null {
  const msg = raw as AnyMsg;
  if (msg.type !== "stream_event" || msg.parent_tool_use_id) return null;
  const ev = msg.event as { type?: string; delta?: { type?: string; text?: string; thinking?: string } } | undefined;
  if (ev?.type !== "content_block_delta" || !ev.delta) return null;
  if (ev.delta.type === "text_delta") return { text: ev.delta.text ?? "" };
  if (ev.delta.type === "thinking_delta") return { thinking: ev.delta.thinking ?? "" };
  return null;
}

/** Plain text form of an item (for copying and quoting) */
export function itemPlainText(item: ChatItem): string {
  switch (item.kind) {
    case "user":
    case "text":
    case "thinking":
    case "notice":
      return item.text;
    case "tool":
      return `${item.name} ${JSON.stringify(item.input)}`;
    default:
      return "";
  }
}
