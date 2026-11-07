import { Button, Tooltip } from "@heroui/react";
import { Check, Copy, Maximize2 } from "lucide-react";
import { isValidElement, memo, useState, type ReactNode } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { actions } from "../../store";

export const Markdown = memo(function Markdown({ text }: { text: string }) {
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
        {text}
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
        <span>{lang ?? "kod"}</span>
        <div className="flex gap-0.5 opacity-60 transition group-hover:opacity-100">
          <CopyButton text={text} />
          <Tooltip delay={300}>
            <Button
              isIconOnly
              size="sm"
              variant="ghost"
              aria-label="Ortada aç"
              onPress={() => actions.showOverlay({ title: lang ? `Kod (${lang})` : "Kod", body: text, mono: true })}
            >
              <Maximize2 size={13} />
            </Button>
            <Tooltip.Content>Ortada büyük aç</Tooltip.Content>
          </Tooltip>
        </div>
      </div>
      <pre className="font-code overflow-x-auto p-3 text-[13px] leading-relaxed">{text}</pre>
    </div>
  );
}

export function CopyButton({ text, label = "Kopyala" }: { text: string; label?: string }) {
  const [done, setDone] = useState(false);
  return (
    <Tooltip delay={300}>
      <Button
        isIconOnly
        size="sm"
        variant="ghost"
        aria-label={label}
        onPress={async () => {
          await navigator.clipboard.writeText(text);
          setDone(true);
          setTimeout(() => setDone(false), 1200);
        }}
      >
        {done ? <Check size={13} /> : <Copy size={13} />}
      </Button>
      <Tooltip.Content>{done ? "Kopyalandı" : label}</Tooltip.Content>
    </Tooltip>
  );
}
