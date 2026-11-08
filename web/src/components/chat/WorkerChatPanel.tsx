import { Button, Chip, Tooltip } from "@heroui/react";
import { Brain, Settings2, SquarePen, TriangleAlert } from "lucide-react";
import { useRef } from "react";
import { actions, useApp } from "../../store";
import type { WorkerChatMessage } from "../../protocol";
import { DeepSeekBalanceChip } from "../DeepSeekBalance";
import { AgentSelect } from "./AgentSelect";
import { StreamingDots, useAutoScroll } from "./common";
import { Composer } from "./Composer";
import { Collapsible, MessageActions } from "./ItemView";
import { Markdown } from "./Markdown";
import { Thumbs } from "./Thumbs";
import { usageText, WorkerFooter, WorkerPlusMenu } from "./WorkerFooter";

/** Direct chat with a worker (DeepSeek, local model) */
export function WorkerChatPanel({ workerId }: { workerId: string }) {
  const worker = useApp((s) => s.workers.find((w) => w.id === workerId));
  const chatId = useApp((s) => s.activeWorkerChat[workerId]);
  const chat = useApp((s) => (chatId ? s.workerChats[chatId] : undefined));
  const { ref, onScroll } = useAutoScroll<HTMLDivElement>([chat?.messages.length, chat?.stream, chat?.streamReasoning]);
  const lastUsage = chat?.messages.findLast((m) => m.role === "assistant" && m.usage)?.usage;
  const quoteKey = `w:${workerId}`;

  if (!worker) return null;
  const unavailable = worker.available && !worker.available.ok ? worker.available.reason : undefined;

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex flex-col gap-2 border-b border-separator px-3 py-2">
        <div className="flex items-center gap-2">
          <AgentSelect />
          <Tooltip delay={300}>
            <Button isIconOnly size="sm" variant="ghost" aria-label="Edit worker" onPress={() => actions.openWorkerModal(worker)}>
              <Settings2 size={16} />
            </Button>
            <Tooltip.Content>Edit worker</Tooltip.Content>
          </Tooltip>
          <Tooltip delay={300}>
            <Button isIconOnly size="sm" variant="ghost" aria-label="New chat" onPress={() => actions.newWorkerChat(workerId)}>
              <SquarePen size={16} />
            </Button>
            <Tooltip.Content>New chat</Tooltip.Content>
          </Tooltip>
        </div>
        <div className="flex flex-wrap items-center gap-2 text-xs text-muted">
          <Chip size="sm" variant="soft">
            {worker.provider === "deepseek" ? "DeepSeek API" : "Ollama"}
          </Chip>
          <span className="font-code truncate">{worker.model}</span>
          {worker.local && (
            <Chip size="sm" variant="soft" color="success">
              Data stays local
            </Chip>
          )}
          {worker.provider === "deepseek" && (
            <span className="ml-auto">
              <DeepSeekBalanceChip compact />
            </span>
          )}
        </div>
      </div>

      {unavailable && (
        <div className="mx-3 mt-3 flex items-start gap-2 rounded-lg bg-warning-soft p-2.5 text-xs text-warning-soft-foreground">
          <TriangleAlert size={14} className="mt-0.5 shrink-0" />
          <span>
            Currently unavailable: <b>{unavailable}</b>.{" "}
            {worker.provider === "deepseek" ? "Add the DeepSeek key to the .env file and restart the server." : "Install and run Ollama."}
          </span>
        </div>
      )}

      <div ref={ref} onScroll={onScroll} className="min-h-0 flex-1 overflow-y-auto overflow-x-hidden px-4 py-4 [overflow-wrap:anywhere]">
        <div className="flex min-w-0 flex-col gap-3 [&>*]:min-w-0">
          {!chat && (
            <div className="mx-auto mt-10 flex max-w-sm flex-col items-center gap-2 text-center">
              <span className="size-10 rounded-full" style={{ background: worker.color }} />
              <p className="font-semibold">{worker.name}</p>
              <p className="text-sm text-muted">{worker.description || "You can chat directly with this worker."}</p>
            </div>
          )}
          {chat?.messages.map((m, i) => (
            <WorkerMessage key={i} m={m} onReply={(q) => actions.setQuote(quoteKey, q)} />
          ))}
          {chat?.streamReasoning && (
            <Collapsible icon={<Brain size={13} />} label="Thinking…" defaultOpen>
              <div className="whitespace-pre-wrap text-xs leading-relaxed text-muted">{chat.streamReasoning}</div>
            </Collapsible>
          )}
          {chat?.stream && <Markdown text={chat.stream} />}
          {chat?.busy && !chat.stream && !chat.streamReasoning && (
            <div className="flex items-center gap-2 text-xs text-muted">
              <StreamingDots /> {worker.name} typing
            </div>
          )}
        </div>
      </div>

      <Composer
        quoteKey={quoteKey}
        placeholder={`Message ${worker.name}…`}
        busy={!!chat?.busy}
        onSend={(text, attachments) => actions.sendWorker(workerId, text, attachments)}
        onStop={() => chatId && actions.stopWorker(chatId)}
        workerPlus={(pickFiles) => <WorkerPlusMenu worker={worker} onPickFiles={pickFiles} />}
        footer={<WorkerFooter worker={worker} lastUsage={lastUsage} />}
      />
    </div>
  );
}

function WorkerMessage({ m, onReply }: { m: WorkerChatMessage; onReply: (q: string) => void }) {
  const ref = useRef<HTMLDivElement>(null);
  if (m.role === "user") {
    const images = (m.attachments ?? [])
      .filter((a) => a.mediaType.startsWith("image/"))
      .map((a) => ({ src: `data:${a.mediaType};base64,${a.data}`, name: a.name }));
    const files = (m.attachments ?? []).filter((a) => !a.mediaType.startsWith("image/"));
    return (
      <div className="group flex min-w-0 flex-col items-end gap-1">
        <Thumbs images={images} align="end" />
        {files.length > 0 && <div className="text-xs text-muted">{files.map((f) => `📎 ${f.name}`).join("  ")}</div>}
        {m.content && (
          <div ref={ref} className="max-w-[88%] whitespace-pre-wrap rounded-2xl rounded-br-md bg-accent-soft px-3.5 py-2 text-[0.9375rem] [overflow-wrap:anywhere]">
            {m.content}
          </div>
        )}
        <MessageActions text={m.content} elRef={ref} onReply={onReply} />
      </div>
    );
  }
  if (m.error) {
    return <p className="rounded-lg bg-danger-soft px-3 py-2 text-xs text-danger-soft-foreground">{m.content}</p>;
  }
  return (
    <div className="group flex min-w-0 flex-col gap-1">
      {m.reasoning && (
        <Collapsible icon={<Brain size={13} />} label="Reasoning">
          <div className="whitespace-pre-wrap text-xs leading-relaxed text-muted">{m.reasoning}</div>
        </Collapsible>
      )}
      <div ref={ref}>
        <Markdown text={m.content} />
      </div>
      <div className="flex items-center gap-2">
        <MessageActions text={m.content} elRef={ref} onReply={onReply} />
        {m.usage && <span className="text-[10px] tabular-nums text-muted">{usageText(m.usage)}</span>}
      </div>
    </div>
  );
}
