import { Button, Spinner, Tooltip } from "@heroui/react";
import { Brain, FileDiff, GitBranch, PanelRight, SquarePen, X } from "lucide-react";
import { useEffect } from "react";
import { useShallow } from "zustand/react/shallow";
import { actions, useApp } from "../../store";
import { AgentSelect } from "./AgentSelect";
import { ClaudeFooter } from "./ClaudeFooter";
import { StreamingDots, useAutoScroll } from "./common";
import { Composer } from "./Composer";
import { Collapsible, ItemView } from "./ItemView";
import { Markdown } from "./Markdown";
import { PermissionCard } from "./PermissionCard";

export function ClaudeChatPanel({ chatId }: { chatId: string }) {
  const chat = useApp((s) => s.chats[chatId]);
  const infoOpen = useApp((s) => s.ui.infoOpen);
  const permissions = useApp(useShallow((s) => s.permissions.filter((p) => p.chatId === chatId)));
  const { ref, onScroll } = useAutoScroll<HTMLDivElement>([chat?.items.length, chat?.streamText, chat?.streamThinking, permissions.length]);

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
          {chat.items.map((item) => (
            <ItemView key={item.id} item={item} onReply={onReply} onSideChat={onSideChat} />
          ))}
          {chat.streamThinking && (
            <Collapsible icon={<Brain size={13} />} label="Thinking…" defaultOpen>
              <div className="whitespace-pre-wrap text-xs leading-relaxed text-muted">{chat.streamThinking}</div>
            </Collapsible>
          )}
          {chat.streamText && <Markdown text={chat.streamText} />}
          {chat.busy && !chat.streamText && permissions.length === 0 && (
            <div className="flex items-center gap-2 text-xs text-muted">
              <StreamingDots /> Claude working
            </div>
          )}
          {permissions.map((p) => (
            <PermissionCard key={p.requestId} req={p} />
          ))}
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
