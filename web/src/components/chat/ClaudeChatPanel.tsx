import { Button, Spinner, Tooltip } from "@heroui/react";
import { Brain, FileDiff, GitBranch, PanelRight, SquarePen, X } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { useShallow } from "zustand/react/shallow";
import { actions, useApp, type ClaudeChat } from "../../store";
import { AgentSelect } from "./AgentSelect";
import { ClaudeFooter } from "./ClaudeFooter";
import { useAutoScroll, WorkingDots } from "./common";
import { describe } from "./ToolCard";
import { Composer } from "./Composer";
import { Collapsible, ItemView } from "./ItemView";
import { groupSteps, StepGroup } from "./StepGroup";
import { Markdown } from "./Markdown";
import { PermissionCard } from "./PermissionCard";

export function ClaudeChatPanel({ chatId }: { chatId: string }) {
  const chat = useApp((s) => s.chats[chatId]);
  const infoOpen = useApp((s) => s.ui.infoOpen);
  const permissions = useApp(useShallow((s) => s.permissions.filter((p) => p.chatId === chatId)));
  const { ref, onScroll } = useAutoScroll<HTMLDivElement>([chat?.items.length, chat?.streamText, chat?.streamThinking, permissions.length]);

  // Runs of tool calls fold into one row, like in the Claude app
  const blocks = useMemo(() => groupSteps(chat?.items ?? []), [chat?.items]);

  // When the panel opens, request model, effort, context and usage info (without waiting for the first message)
  useEffect(() => {
    actions.requestInfo(chatId);
  }, [chatId]);

  if (!chat) return null;
  const isSide = chat.isSide;
  const onReply = (quote: string) => actions.setQuote(chatId, quote);
  const onSideChat = isSide ? undefined : (quote: string) => actions.openSideChat(quote);

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {/* Header */}
      <div className="flex flex-col gap-2 border-b border-separator px-3 py-2">
        <div className="flex items-center gap-2">
          {isSide ? (
            <>
              <GitBranch size={16} className="text-accent" />
              <span className="flex-1 text-sm font-semibold">Side chat</span>
              <Tooltip delay={300}>
                <Button isIconOnly size="sm" variant="ghost" aria-label="Close side chat" onPress={() => actions.closeSideChat()}>
                  <X size={16} />
                </Button>
                <Tooltip.Content>Close side chat</Tooltip.Content>
              </Tooltip>
            </>
          ) : (
            <>
              <AgentSelect />
              <Tooltip delay={300}>
                <Button isIconOnly size="sm" variant="ghost" aria-label="Changes" onPress={() => actions.showGitDiff(chat.cwd)}>
                  <FileDiff size={16} />
                </Button>
                <Tooltip.Content>View changes (git)</Tooltip.Content>
              </Tooltip>
              <Tooltip delay={300}>
                <Button
                  isIconOnly
                  size="sm"
                  variant={infoOpen ? "secondary" : "ghost"}
                  aria-label="Session info"
                  onPress={() => actions.setUi({ infoOpen: !infoOpen })}
                >
                  <PanelRight size={16} />
                </Button>
                <Tooltip.Content>Session info</Tooltip.Content>
              </Tooltip>
              <Tooltip delay={300}>
                <Button isIconOnly size="sm" variant="ghost" aria-label="New chat" onPress={() => actions.newClaudeChat()}>
                  <SquarePen size={16} />
                </Button>
                <Tooltip.Content>New chat</Tooltip.Content>
              </Tooltip>
            </>
          )}
        </div>
      </div>

      {/* Messages */}
      <div ref={ref} onScroll={onScroll} className="min-h-0 flex-1 overflow-y-auto overflow-x-hidden px-4 py-4 [overflow-wrap:anywhere]">
        <div className="flex min-w-0 flex-col gap-3 [&>*]:min-w-0">
          {chat.loadingHistory && (
            <div className="flex justify-center py-6">
              <Spinner size="sm" />
            </div>
          )}
          {!chat.loadingHistory && chat.items.length === 0 && !isSide && <EmptyState />}
          {blocks.map((b, i) =>
            b.kind === "group" ? (
              <StepGroup key={b.id} items={b.items} live={chat.busy && i === blocks.length - 1} onReply={onReply} onSideChat={onSideChat} />
            ) : (
              <ItemView key={b.item.id} item={b.item} onReply={onReply} onSideChat={onSideChat} />
            ),
          )}
          {chat.streamThinking && (
            <Collapsible icon={<Brain size={13} />} label="Thinking…" defaultOpen>
              <div className="whitespace-pre-wrap text-xs leading-relaxed text-muted">{chat.streamThinking}</div>
            </Collapsible>
          )}
          {chat.streamText && <Markdown text={chat.streamText} />}
          {permissions.map((p) => (
            <PermissionCard key={p.requestId} req={p} />
          ))}
          {chat.busy && <WorkingStatus chat={chat} waiting={permissions.length > 0} />}
        </div>
      </div>

      <Composer
        quoteKey={chatId}
        placeholder={isSide ? "Ask in side chat…" : "Message Claude… (you can also ask it to assign work to workers)"}
        busy={chat.busy}
        claudeChatId={chatId}
        footer={<ClaudeFooter chatId={chatId} />}
        onSend={(text, attachments) => actions.sendClaude(chatId, text, attachments)}
        onStop={() => actions.interruptClaude(chatId)}
      />
    </div>
  );
}

function EmptyState() {
  return (
    <div className="mx-auto mt-10 flex max-w-sm flex-col items-center gap-2 text-center">
      <div className="text-3xl">📜</div>
      <p className="font-semibold">Head scribe ready</p>
      <p className="text-sm text-muted">
        Tell Claude what you want. If it sees fit, it delegates the work to DeepSeek or local models; you can see who is working in the library in the middle.
      </p>
    </div>
  );
}

/** Elapsed time that ticks every second: "8s", "1m 12s" */
function Elapsed({ since }: { since?: number }) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);
  if (!since) return null;
  const s = Math.max(0, Math.floor((now - since) / 1000));
  return <span className="shrink-0 tabular-nums">{s < 60 ? `${s}s` : `${Math.floor(s / 60)}m ${String(s % 60).padStart(2, "0")}s`}</span>;
}

/** Status line at the bottom while Claude works: turning dots, what it is doing right now, and for how long */
function WorkingStatus({ chat, waiting }: { chat: ClaudeChat; waiting: boolean }) {
  const pending = chat.items.findLast((i) => i.kind === "tool" && !i.result);
  const d = pending?.kind === "tool" ? describe(pending.name, pending.input) : null;
  const label = waiting
    ? "Waiting for your approval"
    : d
      ? d.title
      : chat.streamThinking
        ? "Thinking"
        : chat.streamText
          ? "Writing"
          : "Working";
  return (
    <div className="flex min-w-0 items-center gap-2 text-xs text-muted">
      <WorkingDots />
      <span className="min-w-0 truncate text-foreground">{label}</span>
      {d?.detail && !waiting && <span className="font-code min-w-0 truncate">{d.detail}</span>}
      <Elapsed since={chat.busySince} />
    </div>
  );
}
