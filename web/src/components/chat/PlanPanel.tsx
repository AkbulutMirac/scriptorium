import { Button } from "@heroui/react";
import { ClipboardList, X } from "lucide-react";
import { useMemo } from "react";
import type { ChatItem } from "../../lib/claudeItems";
import { CopyButton, Markdown } from "./Markdown";

const norm = (p: string) => p.replace(/\\/g, "/").toLowerCase();

type EditShape = { old_string?: unknown; new_string?: unknown; replace_all?: unknown };

function applyEdit(text: string, e: EditShape): string {
  const oldStr = String(e.old_string ?? "");
  if (!oldStr) return text;
  const next = String(e.new_string ?? "");
  if (e.replace_all === true) return text.split(oldStr).join(next);
  const i = text.indexOf(oldStr);
  return i < 0 ? text : text.slice(0, i) + next + text.slice(i + oldStr.length);
}

/** Rebuilds the plan file content from the chat's tool calls, in order. */
export function planText(items: ChatItem[], path: string): string | null {
  const target = norm(path);
  let text: string | null = null;
  for (const it of items) {
    if (it.kind !== "tool") continue;
    const input = it.input;
    const fp = typeof input.file_path === "string" ? norm(input.file_path) : null;
    if (it.name === "Write" && fp === target) {
      text = String(input.content ?? "");
    } else if (it.name === "Edit" && fp === target && text !== null) {
      text = applyEdit(text, input);
    } else if (it.name === "MultiEdit" && fp === target && text !== null) {
      const edits = Array.isArray(input.edits) ? (input.edits as EditShape[]) : [];
      let t: string = text;
      for (const e of edits) t = applyEdit(t, e);
      text = t;
    } else if (it.name === "ExitPlanMode" && typeof input.plan === "string") {
      const pf = input.planFilePath;
      if (typeof pf !== "string" || norm(pf) === target) text = input.plan;
    }
  }
  return text;
}

/** The plan Claude is writing, rendered beside the chat like in the Claude app */
export function PlanPanel({ path, items, onClose }: { path: string; items: ChatItem[]; onClose: () => void }) {
  const text = useMemo(() => planText(items, path), [items, path]);
  const base = path.split(/[\\/]/).pop() || path;

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex items-center gap-2 border-b border-separator px-3 py-2">
        <ClipboardList size={16} className="shrink-0 text-muted" />
        <span className="shrink-0 text-sm font-medium">Plan</span>
        <span className="min-w-0 flex-1 truncate text-xs text-muted" title={path}>
          {base}
        </span>
        {text && <CopyButton text={text} />}
        <Button isIconOnly size="sm" variant="ghost" aria-label="Close" onPress={onClose}>
          <X size={16} />
        </Button>
      </div>
      <div className="min-h-0 flex-1 overflow-auto p-4">
        {text === null ? <p className="text-xs text-muted">The plan content isn't in this chat's history.</p> : <Markdown text={text} />}
      </div>
    </div>
  );
}
