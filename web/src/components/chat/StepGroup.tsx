import { Spinner } from "@heroui/react";
import { ChevronRight } from "lucide-react";
import { useState } from "react";
import type { ChatItem } from "../../lib/claudeItems";
import { ItemView } from "./ItemView";
import { describe, isProminentTool } from "./ToolCard";

type Handlers = { onReply: (quote: string) => void; onSideChat?: (quote: string) => void };

export type Block = { kind: "item"; item: ChatItem } | { kind: "group"; id: string; items: ChatItem[] };

/** Tool calls, thinking and sub-agent text that get folded into one row, like in the Claude app */
const isStep = (it: ChatItem) =>
  (it.kind === "tool" && !isProminentTool(it.name)) || it.kind === "thinking" || (it.kind === "text" && !!it.parent);

/** Folds runs of two or more consecutive steps into a group; everything else stays as it is */
export function groupSteps(items: ChatItem[]): Block[] {
  const blocks: Block[] = [];
  let run: ChatItem[] = [];
  const flush = () => {
    if (run.length >= 2) blocks.push({ kind: "group", id: `g-${run[0].id}`, items: run });
    else for (const it of run) blocks.push({ kind: "item", item: it });
    run = [];
  };
  for (const it of items) {
    if (isStep(it)) run.push(it);
    else {
      flush();
      blocks.push({ kind: "item", item: it });
    }
  }
  flush();
  return blocks;
}

const CATEGORIES: { match: (name: string) => boolean; one: string; many: (n: number) => string }[] = [
  { match: (n) => n === "Read", one: "read a file", many: (n) => `read ${n} files` },
  { match: (n) => ["Edit", "MultiEdit", "Write", "NotebookEdit"].includes(n), one: "edited a file", many: (n) => `edited ${n} files` },
  { match: (n) => n === "Bash" || n === "PowerShell", one: "ran a command", many: (n) => `ran ${n} commands` },
  { match: (n) => n === "Grep" || n === "Glob", one: "searched", many: (n) => `searched ${n} times` },
  { match: (n) => n === "WebFetch" || n === "WebSearch", one: "looked something up online", many: (n) => `did ${n} web lookups` },
  { match: (n) => n === "Task" || n === "Agent", one: "ran a subagent", many: (n) => `ran ${n} subagents` },
];

/** "Read 3 files, ran 2 commands" */
function summarize(items: ChatItem[]): string {
  const tools = items.filter((i): i is Extract<ChatItem, { kind: "tool" }> => i.kind === "tool");
  const parts: string[] = [];
  let other = 0;
  const counted = new Set<string>();
  for (const c of CATEGORIES) {
    const n = tools.filter((t) => c.match(t.name)).length;
    tools.filter((t) => c.match(t.name)).forEach((t) => counted.add(t.id));
    if (n) parts.push(n === 1 ? c.one : c.many(n));
  }
  other = tools.filter((t) => !counted.has(t.id)).length;
  if (other) parts.push(other === 1 ? "used a tool" : `used ${other} tools`);
  if (!parts.length) parts.push("thought");
  const text = parts.join(", ");
  return text[0].toUpperCase() + text.slice(1);
}

/** One collapsed row for a run of steps. While Claude is working on it, it shows the current step instead. */
export function StepGroup({ items, live, ...handlers }: { items: ChatItem[]; live: boolean } & Handlers) {
  const [open, setOpen] = useState(false);
  const errors = items.filter((i) => i.kind === "tool" && i.result?.isError).length;
  const pending = items.findLast((i) => i.kind === "tool" && !i.result);
  const current = live && pending?.kind === "tool" ? describe(pending.name, pending.input) : null;

  return (
    <div className="min-w-0 text-sm">
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className="flex w-full min-w-0 items-center gap-2 rounded-lg px-1.5 py-1 text-left text-muted hover:bg-default-soft hover:text-foreground"
      >
        <ChevronRight size={14} className={`shrink-0 transition-transform ${open ? "rotate-90" : ""}`} />
        {current ? (
          <>
            <Spinner size="sm" />
            <span className="min-w-0 truncate text-foreground">{current.title}</span>
            {current.detail && <span className="font-code min-w-0 flex-1 truncate text-xs">{current.detail}</span>}
          </>
        ) : (
          <span className="min-w-0 truncate">{summarize(items)}</span>
        )}
        <span className="shrink-0 text-xs">· {items.length} steps</span>
        {errors > 0 && <span className="shrink-0 text-xs text-danger">· {errors === 1 ? "1 error" : `${errors} errors`}</span>}
      </button>
      {open && (
        <div className="ml-2 mt-1 flex flex-col gap-2 border-l-2 border-separator pl-3 [&>*]:min-w-0">
          {items.map((it) => (
            <ItemView key={it.id} item={it} {...handlers} />
          ))}
        </div>
      )}
    </div>
  );
}
