import { Button, Chip, Spinner, Tooltip } from "@heroui/react";
import { Brain, FileDiff, Folder, GitBranch, PanelRight, SquarePen, X } from "lucide-react";
import { useShallow } from "zustand/react/shallow";
import { actions, useApp } from "../../store";
import type { PermissionMode } from "../../protocol";
import { AgentSelect } from "./AgentSelect";
import { MiniSelect, StreamingDots, useAutoScroll, type Option } from "./common";
import { Composer } from "./Composer";
import { Collapsible, ItemView } from "./ItemView";
import { Markdown } from "./Markdown";
import { PermissionCard } from "./PermissionCard";

const MODELS: Option[] = [
  { value: "", label: "Varsayılan model" },
  { value: "opus", label: "Opus" },
  { value: "sonnet", label: "Sonnet" },
  { value: "haiku", label: "Haiku" },
];

const MODES: Option[] = [
  { value: "default", label: "Her adımda sor" },
  { value: "acceptEdits", label: "Düzenlemeleri kabul et" },
  { value: "plan", label: "Plan modu" },
  { value: "auto", label: "Otomatik" },
];

export function ClaudeChatPanel({ chatId }: { chatId: string }) {
  const chat = useApp((s) => s.chats[chatId]);
  const branch = useApp((s) => s.git[s.chats[chatId]?.cwd ?? ""]?.branch);
  const infoOpen = useApp((s) => s.ui.infoOpen);
  const permissions = useApp(useShallow((s) => s.permissions.filter((p) => p.chatId === chatId)));
  const { ref, onScroll } = useAutoScroll<HTMLDivElement>([chat?.items.length, chat?.streamText, chat?.streamThinking, permissions.length]);

  if (!chat) return null;
  const isSide = chat.isSide;
  const folder = chat.cwd.replaceAll("\\", "/").split("/").filter(Boolean).pop();
  const onReply = (quote: string) => actions.setQuote(chatId, quote);
  const onSideChat = isSide ? undefined : (quote: string) => actions.openSideChat(quote);

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {/* Başlık */}
      <div className="flex flex-col gap-2 border-b border-separator px-3 py-2">
        <div className="flex items-center gap-2">
          {isSide ? (
            <>
              <GitBranch size={16} className="text-accent" />
              <span className="flex-1 text-sm font-semibold">Yan sohbet</span>
              <Tooltip delay={300}>
                <Button isIconOnly size="sm" variant="ghost" aria-label="Yan sohbeti kapat" onPress={() => actions.closeSideChat()}>
                  <X size={16} />
                </Button>
                <Tooltip.Content>Yan sohbeti kapat</Tooltip.Content>
              </Tooltip>
            </>
          ) : (
            <>
              <AgentSelect />
              <Tooltip delay={300}>
                <Button isIconOnly size="sm" variant="ghost" aria-label="Değişiklikler" onPress={() => actions.showGitDiff(chat.cwd)}>
                  <FileDiff size={16} />
                </Button>
                <Tooltip.Content>Değişiklikleri gör (git)</Tooltip.Content>
              </Tooltip>
              <Tooltip delay={300}>
                <Button
                  isIconOnly
                  size="sm"
                  variant={infoOpen ? "secondary" : "ghost"}
                  aria-label="Oturum bilgisi"
                  onPress={() => actions.setUi({ infoOpen: !infoOpen })}
                >
                  <PanelRight size={16} />
                </Button>
                <Tooltip.Content>Oturum bilgisi</Tooltip.Content>
              </Tooltip>
              <Tooltip delay={300}>
                <Button isIconOnly size="sm" variant="ghost" aria-label="Yeni sohbet" onPress={() => actions.newClaudeChat()}>
                  <SquarePen size={16} />
                </Button>
                <Tooltip.Content>Yeni sohbet</Tooltip.Content>
              </Tooltip>
            </>
          )}
        </div>
        <div className="flex items-center gap-2">
          <MiniSelect
            label="Model"
            value={chat.wantModel ?? ""}
            options={MODELS}
            onChange={(v) => actions.setModel(chatId, v)}
            className="w-36"
          />
          <MiniSelect
            label="İzin modu"
            value={chat.permissionMode ?? "default"}
            options={MODES}
            onChange={(v) => actions.setMode(chatId, v as PermissionMode)}
            className="w-44"
          />
          <span className="flex-1" />
          {branch && (
            <Chip size="sm" variant="soft" className="max-w-28">
              <GitBranch size={12} />
              <span className="truncate">{branch}</span>
            </Chip>
          )}
          <Tooltip delay={300}>
            <Chip size="sm" variant="soft" className="max-w-32">
              <Folder size={12} />
              <span className="truncate">{folder}</span>
            </Chip>
            <Tooltip.Content>
              <span className="font-code text-xs">{chat.cwd}</span>
              {chat.model && <div className="text-xs text-muted">Model: {chat.model}</div>}
            </Tooltip.Content>
          </Tooltip>
        </div>
      </div>

      {/* Mesajlar */}
      <div ref={ref} onScroll={onScroll} className="min-h-0 flex-1 overflow-y-auto px-4 py-4">
        <div className="flex flex-col gap-3">
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
            <Collapsible icon={<Brain size={13} />} label="Düşünüyor…" defaultOpen>
              <div className="whitespace-pre-wrap text-xs leading-relaxed text-muted">{chat.streamThinking}</div>
            </Collapsible>
          )}
          {chat.streamText && <Markdown text={chat.streamText} />}
          {chat.busy && !chat.streamText && permissions.length === 0 && (
            <div className="flex items-center gap-2 text-xs text-muted">
              <StreamingDots /> Claude çalışıyor
            </div>
          )}
          {permissions.map((p) => (
            <PermissionCard key={p.requestId} req={p} />
          ))}
        </div>
      </div>

      <Composer
        quoteKey={chatId}
        placeholder={isSide ? "Yan sohbette sor…" : "Claude'a yaz… (işçilere iş vermesini de isteyebilirsin)"}
        busy={chat.busy}
        claudeChatId={chatId}
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
      <p className="font-semibold">Baş yazıcı hazır</p>
      <p className="text-sm text-muted">
        Claude'a ne istediğini yaz. Uygun görürse işi DeepSeek'e ya da local modellere kendisi devreder; kütüphanede kimin çalıştığını ortada görürsün.
      </p>
    </div>
  );
}
