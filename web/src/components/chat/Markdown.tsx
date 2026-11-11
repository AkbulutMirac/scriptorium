import { Button, Tooltip } from "@heroui/react";
import { Check, Copy, Maximize2 } from "lucide-react";
import { isValidElement, memo, useState, type ReactNode } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { actions } from "../../store";
import { copyText } from "../../lib/clipboard";

/** A line that starts a block of its own: blank, a list item, a table row, a heading or a quote */
const BLOCK_LINE = /^\s*([-*+] |\d+[.)] |\||#|>|$)/;
/** Blocks that would swallow a plain line after them (a list item, a table row, a quote) */
const CONTINUED = /^\s*([-*+] |\d+[.)] |\||>)/;

/**
 * Keeps single line breaks, which Markdown would join into one paragraph. Worker answers and reports are often
 * plain lines ("Result: Done" / "Tests: ..."). Code blocks are left alone.
 */
function keepLineBreaks(text: string): string {
  return text
    .split(/(^```[\s\S]*?^```)/m)
    .map((part, i) => {
      if (i % 2) return part;
      const lines = part.split("\n");
      return lines
        .map((line, j) => {
          const next = lines[j + 1];
          if (next === undefined || BLOCK_LINE.test(next)) return line;
          // A plain line after a list item or table row would become part of it: end that block first
          if (CONTINUED.test(line)) return /^\s/.test(next) ? line : `${line}\n`;
          return BLOCK_LINE.test(line) ? line : `${line}  `;
        })
        .join("\n");
    })
    .join("");
}

export const Markdown = memo(function Markdown({ text, breaks }: { text: string; breaks?: boolean }) {
  return (
    <div className="md">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          pre: ({ children }) => <CodeBlock>{children}</CodeBlock>,
          a: ({ children, href }) => (
            <a href={href} target="_blank" rel="noreferrer">
              {children}
            </a>
          ),
        }}
      >
        {breaks ? keepLineBreaks(text) : text}
      </ReactMarkdown>
    </div>
  );
});

function CodeBlock({ children }: { children: ReactNode }) {
  const code = isValidElement<{ children?: ReactNode; className?: string }>(children) ? children : null;
  const text = String(code?.props.children ?? "").replace(/\n$/, "");
  const lang = /language-(\S+)/.exec(code?.props.className ?? "")?.[1];
  return (
    <div className="group relative my-2 overflow-hidden rounded-lg border border-separator bg-background-secondary">
      <div className="flex items-center justify-between border-b border-separator px-3 py-1 text-[11px] text-muted">
        <span>{lang ?? "code"}</span>
        <div className="flex gap-0.5 opacity-60 transition group-hover:opacity-100">
          <CopyButton text={text} />
          <Tooltip delay={300}>
            <Button
              isIconOnly
              size="sm"
              variant="ghost"
              aria-label="Open centered"
              onPress={() => actions.showOverlay({ title: lang ? `Code (${lang})` : "Code", body: text, mono: true })}
            >
              <Maximize2 size={13} />
            </Button>
            <Tooltip.Content>Open large centered</Tooltip.Content>
          </Tooltip>
        </div>
      </div>
      <pre className="font-code overflow-x-auto p-3 text-[13px] leading-relaxed">{text}</pre>
    </div>
  );
}

export function CopyButton({ text, label = "Copy" }: { text: string; label?: string }) {
  const [done, setDone] = useState(false);
  return (
    <Tooltip delay={300}>
      <Button
        isIconOnly
        size="sm"
        variant="ghost"
        aria-label={label}
        onPress={async () => {
          await copyText(text);
          setDone(true);
          setTimeout(() => setDone(false), 1200);
        }}
      >
        {done ? <Check size={13} /> : <Copy size={13} />}
      </Button>
      <Tooltip.Content>{done ? "Copied" : label}</Tooltip.Content>
    </Tooltip>
  );
}
