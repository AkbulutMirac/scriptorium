import path from "node:path";
import { loadWorkers } from "./agents.js";
import { trackRequest } from "./requests.js";
import { saveDelegatedTask } from "./workerChats.js";

/**
 * Claude Code subagents (the Agent tool) running on Haiku or Sonnet, shown as workers: in the 3D office while
 * they run, and in that worker's history once they finish. Fed by Claude Code hooks: in-process for Scriptorium's
 * own sessions, and over HTTP (POST /hooks) for terminal and desktop app sessions. The same event can arrive
 * both ways, so everything is keyed by the session and tool call and handled once.
 */

type HookInput = {
  hook_event_name?: string;
  session_id?: string;
  cwd?: string;
  tool_name?: string;
  tool_input?: unknown;
  tool_response?: unknown;
  tool_use_id?: string;
  agent_id?: string;
  last_assistant_message?: string;
  error?: string;
};

type Running = {
  workerId: string;
  model: string;
  task: string;
  label: string;
  finish: (error?: string) => void;
  timer: ReturnType<typeof setTimeout>;
};

const AGENT_TOOLS = new Set(["Agent", "Task"]);
/** A subagent whose end never arrives (the session was killed) leaves the office after this long */
const MAX_RUN_MS = 3 * 60 * 60_000;

/** Tool calls already seen: the same hook can come in-process and over HTTP */
const seen = new Set<string>();
const byToolUse = new Map<string, Running>();
const byAgent = new Map<string, Running>();

const text = (v: unknown) => (typeof v === "string" ? v : "");

/** Text of a finished Agent tool result ({ content: [{ type: "text", text }] }) */
function resultText(response: unknown): string {
  if (typeof response === "string") return response;
  const content = (response as { content?: unknown })?.content;
  if (Array.isArray(content)) {
    const joined = content.map((c) => text((c as { text?: unknown })?.text)).filter(Boolean).join("\n\n");
    // Claude Code prefixes the report with a note for the parent model; the history only needs the report
    return joined.replace(/<tools-used-before-summary>[\s\S]*?<\/tools-used-before-summary>/g, "").trim();
  }
  return response === undefined ? "" : JSON.stringify(response, null, 2);
}

function end(r: Running, answer: string, error?: string) {
  clearTimeout(r.timer);
  r.finish(error);
  saveDelegatedTask({ workerId: r.workerId, task: r.task, label: r.label, answer: error ?? (answer || "(no report)"), model: r.model, error: !!error }).catch(() => {});
}

async function onPreToolUse(key: string, input: HookInput) {
  const args = (input.tool_input ?? {}) as { description?: unknown; prompt?: unknown; model?: unknown };
  const model = text(args.model).toLowerCase();
  if (!model) return;
  const worker = (await loadWorkers()).find((w) => w.provider === "claude" && model.includes(w.model.toLowerCase()));
  if (!worker) return;
  const description = text(args.description);
  const prompt = text(args.prompt);
  const label = input.cwd ? path.basename(input.cwd) : "Claude Code";
  const r: Running = {
    workerId: worker.id,
    model: worker.model,
    task: description ? `${description}\n\n${prompt}` : prompt,
    label,
    finish: trackRequest(worker.id, { task: description || prompt.split("\n")[0], caller: { kind: "claude", label } }),
    timer: setTimeout(() => {
      byToolUse.delete(key);
      for (const [id, x] of byAgent) if (x === r) byAgent.delete(id);
      r.finish();
    }, MAX_RUN_MS),
  };
  byToolUse.set(key, r);
}

function onPostToolUse(key: string, input: HookInput) {
  const r = byToolUse.get(key);
  if (!r) return;
  byToolUse.delete(key);
  const res = input.tool_response as { status?: unknown; agentId?: unknown } | undefined;
  // Background agent: the tool returns at once, the work ends with SubagentStop
  if (res?.status === "async_launched" && typeof res.agentId === "string") {
    byAgent.set(res.agentId, r);
    return;
  }
  end(r, resultText(input.tool_response));
}

/**
 * Added to the end of every subagent's task, so its last message is a report the parent (and the worker's
 * history) can use as the answer.
 */
export const REPORT_NOTE = [
  "When you finish, your final message is your answer to the agent that started you. Make it this short report:",
  "Report",
  "- Done: what you did, or the answer you found",
  "- Files: files you changed, or none",
  "- Checks: commands or tests you ran and their results, or none",
  "- Open: anything unfinished, uncertain or worth a look",
].join("\n");

/** The Agent tool's input with the report note added to its task (unless it is already there) */
function withReportNote(toolInput: unknown): Record<string, unknown> | undefined {
  const args = toolInput as Record<string, unknown> | undefined;
  if (!args || typeof args.prompt !== "string" || args.prompt.includes(REPORT_NOTE)) return undefined;
  return { ...args, prompt: `${args.prompt}\n\n${REPORT_NOTE}` };
}

/**
 * Handles one Claude Code hook event and returns the hook's output. Before a subagent starts, its task gets the
 * report note; the events also update the office and history. Unrelated events are ignored.
 */
export async function handleSubagentHook(input: HookInput): Promise<Record<string, unknown>> {
  await track(input).catch(() => {});
  if (input.hook_event_name !== "PreToolUse" || !AGENT_TOOLS.has(input.tool_name ?? "")) return {};
  const updatedInput = withReportNote(input.tool_input);
  return updatedInput ? { hookSpecificOutput: { hookEventName: "PreToolUse", updatedInput } } : {};
}

async function track(input: HookInput): Promise<void> {
  const event = input.hook_event_name;
  if (event === "SubagentStop") {
    const r = input.agent_id ? byAgent.get(input.agent_id) : undefined;
    if (!r) return;
    byAgent.delete(input.agent_id!);
    return end(r, text(input.last_assistant_message));
  }
  if (!AGENT_TOOLS.has(input.tool_name ?? "") || !input.tool_use_id) return;
  const key = `${input.session_id ?? ""}:${input.tool_use_id}`;
  if (event === "PreToolUse") {
    if (seen.has(key)) return;
    seen.add(key);
    if (seen.size > 5000) seen.delete(seen.values().next().value!);
    return onPreToolUse(key, input);
  }
  if (event === "PostToolUse") return onPostToolUse(key, input);
  if (event === "PostToolUseFailure") {
    const r = byToolUse.get(key);
    if (!r) return;
    byToolUse.delete(key);
    end(r, "", text(input.error) || "The subagent failed.");
  }
}
