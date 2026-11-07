import { Button, Chip, Tooltip } from "@heroui/react";
import { Settings2, SquarePen, TriangleAlert } from "lucide-react";
import { useRef } from "react";
import { actions, useApp } from "../../store";
import type { WorkerChatMessage } from "../../protocol";
import { AgentSelect } from "./AgentSelect";
import { StreamingDots, useAutoScroll } from "./common";
import { Composer } from "./Composer";
import { MessageActions } from "./ItemView";
import { Markdown } from "./Markdown";

/** Bir işçiyle (DeepSeek, local model) doğrudan sohbet */
export function WorkerChatPanel({ workerId }: { workerId: string }) {
  const worker = useApp((s) => s.workers.find((w) => w.id === workerId));
  const chatId = useApp((s) => s.activeWorkerChat[workerId]);
  const chat = useApp((s) => (chatId ? s.workerChats[chatId] : undefined));
  const { ref, onScroll } = useAutoScroll<HTMLDivElement>([chat?.messages.length, chat?.stream]);
  const quoteKey = `w:${workerId}`;

  if (!worker) return null;
  const unavailable = worker.available && !worker.available.ok ? worker.available.reason : undefined;

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex flex-col gap-2 border-b border-separator px-3 py-2">
        <div className="flex items-center gap-2">
          <AgentSelect />
          <Tooltip delay={300}>
            <Button isIconOnly size="sm" variant="ghost" aria-label="İşçiyi düzenle" onPress={() => actions.openWorkerModal(worker)}>
              <Settings2 size={16} />
            </Button>
            <Tooltip.Content>İşçiyi düzenle</Tooltip.Content>
          </Tooltip>
          <Tooltip delay={300}>
            <Button isIconOnly size="sm" variant="ghost" aria-label="Yeni sohbet" onPress={() => actions.newWorkerChat(workerId)}>
              <SquarePen size={16} />
            </Button>
            <Tooltip.Content>Yeni sohbet</Tooltip.Content>
          </Tooltip>
        </div>
        <div className="flex flex-wrap items-center gap-2 text-xs text-muted">
          <Chip size="sm" variant="soft">
            {worker.provider === "deepseek" ? "DeepSeek API" : "Ollama"}
          </Chip>
          <span className="font-code truncate">{worker.model}</span>
          {worker.local && (
            <Chip size="sm" variant="soft" color="success">
              veri dışarı çıkmaz
            </Chip>
          )}
        </div>
      </div>

      {unavailable && (
        <div className="mx-3 mt-3 flex items-start gap-2 rounded-lg bg-warning-soft p-2.5 text-xs text-warning-soft-foreground">
          <TriangleAlert size={14} className="mt-0.5 shrink-0" />
          <span>
            Şu an ulaşılamıyor: <b>{unavailable}</b>.{" "}
            {worker.provider === "deepseek" ? "DeepSeek anahtarını .env dosyasına ekleyip sunucuyu yeniden başlat." : "Ollama'yı kurup çalıştır."}
          </span>
        </div>
      )}

      <div ref={ref} onScroll={onScroll} className="min-h-0 flex-1 overflow-y-auto px-4 py-4">
        <div className="flex flex-col gap-3">
          {!chat && (
            <div className="mx-auto mt-10 flex max-w-sm flex-col items-center gap-2 text-center">
              <span className="size-10 rounded-full" style={{ background: worker.color }} />
              <p className="font-semibold">{worker.name}</p>
              <p className="text-sm text-muted">{worker.description || "Bu işçiyle doğrudan sohbet edebilirsin."}</p>
            </div>
          )}
          {chat?.messages.map((m, i) => (
            <WorkerMessage key={i} m={m} onReply={(q) => actions.setQuote(quoteKey, q)} />
          ))}
          {chat?.stream && <Markdown text={chat.stream} />}
          {chat?.busy && !chat.stream && (
            <div className="flex items-center gap-2 text-xs text-muted">
              <StreamingDots /> {worker.name} yazıyor
            </div>
          )}
        </div>
      </div>

      <Composer
        quoteKey={quoteKey}
        placeholder={`${worker.name}'e yaz…`}
        busy={!!chat?.busy}
        onSend={(text) => actions.sendWorker(workerId, text)}
        onStop={() => chatId && actions.stopWorker(chatId)}
      />
    </div>
  );
}

function WorkerMessage({ m, onReply }: { m: WorkerChatMessage; onReply: (q: string) => void }) {
  const ref = useRef<HTMLDivElement>(null);
  if (m.role === "user") {
    return (
      <div className="group flex flex-col items-end gap-0.5">
        <div ref={ref} className="max-w-[88%] whitespace-pre-wrap break-words rounded-2xl rounded-br-md bg-accent-soft px-3.5 py-2 text-[0.9375rem]">
          {m.content}
        </div>
        <MessageActions text={m.content} elRef={ref} onReply={onReply} />
      </div>
    );
  }
  if (m.error) {
    return <p className="rounded-lg bg-danger-soft px-3 py-2 text-xs text-danger-soft-foreground">{m.content}</p>;
  }
  return (
    <div className="group flex flex-col gap-0.5">
      <div ref={ref}>
        <Markdown text={m.content} />
      </div>
      <MessageActions text={m.content} elRef={ref} onReply={onReply} />
    </div>
  );
}
