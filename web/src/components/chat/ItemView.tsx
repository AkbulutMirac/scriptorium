import { Button, Tooltip } from "@heroui/react";
import { Brain, ChevronRight, GitBranch, Puzzle, Quote } from "lucide-react";
import { memo, useRef, useState, type ReactNode } from "react";
import { itemPlainText, type ChatItem } from "../../lib/claudeItems";
import { seconds } from "../../lib/format";
import { CopyButton, Markdown } from "./Markdown";
import { Thumbs } from "./Thumbs";
import { ToolCard } from "./ToolCard";

type Handlers = {
  onReply: (quote: string) => void;
  /** Main Claude chat only: open a side chat about this message */
  onSideChat?: (quote: string) => void;
};

/** Quotes the selected text if it is inside this item, otherwise the whole item. */
export function quoteFrom(el: HTMLElement | null, fallback: string): string {
  const sel = window.getSelection();
  const text = sel?.toString().trim();
  if (text && el && sel?.anchorNode && el.contains(sel.anchorNode)) return text;
  return fallback.length > 800 ? `${fallback.slice(0, 800)}…` : fallback;
}

export function MessageActions({ text, elRef, onReply, onSideChat }: Handlers & { text: string; elRef: React.RefObject<HTMLElement | null> }) {
  return (
    <div className="flex gap-0.5 opacity-0 transition group-hover:opacity-100">
      <CopyButton text={text} />
      <Tooltip delay={300}>
        <Button isIconOnly size="sm" variant="ghost" aria-label="Quote" onPress={() => onReply(quoteFrom(elRef.current, text))}>
          <Quote size={13} />
        </Button>
        <Tooltip.Content>Reply with quote (you can select text first)</Tooltip.Content>
      </Tooltip>
      {onSideChat && (
        <Tooltip delay={300}>
          <Button isIconOnly size="sm" variant="ghost" aria-label="Ask in side chat" onPress={() => onSideChat(quoteFrom(elRef.current, text))}>
            <GitBranch size={13} />
          </Button>
          <Tooltip.Content>Ask in side chat (main chat stays intact)</Tooltip.Content>
        </Tooltip>
      )}
    </div>
  );
}

export const ItemView = memo(function ItemView({ item, ...handlers }: Handlers & { item: ChatItem }) {
  const ref = useRef<HTMLDivElement>(null);

  switch (item.kind) {
    case "user":
      return (
        <div className="group flex min-w-0 flex-col items-end gap-1">
          <Thumbs images={item.images} align="end" />
          {item.text && (
            <div ref={ref} className="max-w-[88%] whitespace-pre-wrap rounded-2xl rounded-br-md bg-accent-soft px-3.5 py-2 text-[0.9375rem] [overflow-wrap:anywhere]">
              {item.text}
            </div>
          )}
          <MessageActions text={item.text} elRef={ref} onReply={handlers.onReply} />
        </div>
      );

    case "text":
      return (
        <Nested parent={item.parent}>
          <div className="group flex flex-col gap-0.5">
            <div ref={ref}>
              <Markdown text={item.text} />
            </div>
            <MessageActions text={item.text} elRef={ref} {...handlers} />
          </div>
        </Nested>
      );

    case "thinking":
      return (
        <Nested parent={item.parent}>
          <Collapsible icon={<Brain size={13} />} label="Thinking">
            <div className="whitespace-pre-wrap text-xs leading-relaxed text-muted">{item.text}</div>
          </Collapsible>
        </Nested>
      );

    case "tool":
      return (
        <Nested parent={item.parent}>
          <ToolCard name={item.name} input={item.input} result={item.result} />
        </Nested>
      );

    case "notice":
      return (
        <p className={`px-2 text-center text-xs ${item.tone === "danger" ? "rounded-lg bg-danger-soft py-1.5 text-danger-soft-foreground" : "text-muted"}`}>
          {item.text}
        </p>
      );

    case "result":
      return item.durationMs ? <p className="text-right text-[11px] text-muted">✓ {seconds(item.durationMs)}</p> : null;

    case "unknown":
      return (
        <Collapsible icon={<Puzzle size={13} />} label={item.label}>
          <pre className="font-code max-h-60 overflow-auto rounded-md bg-background-secondary p-2 text-[11px]">{JSON.stringify(item.data, null, 2)}</pre>
        </Collapsible>
      );
  }
});

/** Shows the sub-agent's (Task) steps indented */
function Nested({ parent, children }: { parent: string | null; children: ReactNode }) {
  if (!parent) return <>{children}</>;
  return <div className="ml-3 border-l-2 border-separator pl-3 opacity-90">{children}</div>;
}

export function Collapsible({ icon, label, children, defaultOpen = false }: { icon: ReactNode; label: string; children: ReactNode; defaultOpen?: boolean }) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="text-sm">
      <button type="button" onClick={() => setOpen(!open)} className="flex items-center gap-1.5 text-xs text-muted hover:text-foreground">
        <ChevronRight size={13} className={`transition-transform ${open ? "rotate-90" : ""}`} />
        {icon}
        {label}
      </button>
      {open && <div className="mt-1.5 pl-5">{children}</div>}
    </div>
  );
}

export { itemPlainText };
