import { Button, ScrollShadow, Tooltip } from "@heroui/react";
import { Check, PanelLeftOpen, Pencil, RefreshCw, SquarePen, Trash2, X } from "lucide-react";
import { useState } from "react";
import { relativeTime } from "../lib/format";
import { actions, agentMeta, CLAUDE_ID, useApp } from "../store";

export function HistoryPanel() {
  const open = useApp((s) => s.ui.historyOpen);
  const selected = useApp((s) => s.selected);
  const workers = useApp((s) => s.workers);
  const meta = agentMeta(selected, workers);
  const newChat = () => (selected === CLAUDE_ID ? actions.newClaudeChat() : actions.newWorkerChat(selected));

  if (!open) {
    return (
      <nav className="flex w-12 shrink-0 flex-col items-center gap-1 border-r border-separator bg-surface py-2">
        <Tooltip delay={300}>
          <Button isIconOnly size="sm" variant="ghost" aria-label="Geçmişi göster" onPress={() => actions.setUi({ historyOpen: true })}>
            <PanelLeftOpen size={18} />
          </Button>
          <Tooltip.Content placement="right">Geçmişi göster</Tooltip.Content>
        </Tooltip>
        <Tooltip delay={300}>
          <Button isIconOnly size="sm" variant="ghost" aria-label="Yeni sohbet" onPress={newChat}>
            <SquarePen size={18} />
          </Button>
          <Tooltip.Content placement="right">Yeni sohbet</Tooltip.Content>
        </Tooltip>
      </nav>
    );
  }

  return (
    <nav className="flex w-64 shrink-0 flex-col border-r border-separator bg-surface">
      <div className="flex items-center gap-2 px-3 pb-2 pt-3">
        <span className="size-2.5 shrink-0 rounded-full" style={{ background: meta.color }} />
        <span className="min-w-0 flex-1 truncate text-sm font-semibold">{meta.name}</span>
        {selected === CLAUDE_ID && (
          <Tooltip delay={300}>
            <Button isIconOnly size="sm" variant="ghost" aria-label="Yenile" onPress={() => actions.refreshSessions()}>
              <RefreshCw size={15} />
            </Button>
            <Tooltip.Content>Listeyi yenile</Tooltip.Content>
          </Tooltip>
        )}
      </div>
      <div className="px-2 pb-2">
        <Button fullWidth size="sm" variant="secondary" onPress={newChat}>
          <SquarePen size={15} />
          Yeni sohbet
        </Button>
      </div>
      <ScrollShadow className="min-h-0 flex-1 px-2 pb-3">
        {selected === CLAUDE_ID ? <ClaudeHistory /> : <WorkerHistory workerId={selected} />}
      </ScrollShadow>
    </nav>
  );
}

function ClaudeHistory() {
  const sessions = useApp((s) => s.sessions);
  const activeSession = useApp((s) => s.chats[s.mainChatId ?? ""]?.sessionId);
  if (!sessions.length) return <Empty text="Bu klasörde henüz Claude sohbeti yok." />;
  return (
    <ul className="flex flex-col gap-0.5">
      {sessions.map((s) => (
        <HistoryRow
          key={s.id}
          title={s.title}
          subtitle={relativeTime(s.updatedAt)}
          active={s.id === activeSession}
          onOpen={() => actions.openClaudeSession(s.id)}
          onRename={(t) => actions.renameSession(s.id, t)}
          onDelete={() => actions.deleteSession(s.id)}
        />
      ))}
    </ul>
  );
}

function WorkerHistory({ workerId }: { workerId: string }) {
  const chats = useApp((s) => s.workerChatLists[workerId]);
  const active = useApp((s) => s.activeWorkerChat[workerId]);
  if (!chats?.length) return <Empty text="Bu işçiyle henüz sohbet yok." />;
  return (
    <ul className="flex flex-col gap-0.5">
      {chats.map((c) => (
        <HistoryRow
          key={c.id}
          title={c.title}
          subtitle={relativeTime(c.updatedAt)}
          active={c.id === active}
          onOpen={() => actions.openWorkerChat(workerId, c.id)}
          onDelete={() => actions.deleteWorkerChat(workerId, c.id)}
        />
      ))}
    </ul>
  );
}

function HistoryRow(props: {
  title: string;
  subtitle: string;
  active: boolean;
  onOpen: () => void;
  onRename?: (title: string) => void;
  onDelete: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(props.title);
  const [confirmDelete, setConfirmDelete] = useState(false);

  if (editing) {
    const commit = () => {
      if (draft.trim() && draft !== props.title) props.onRename?.(draft.trim());
      setEditing(false);
    };
    return (
      <li className="flex items-center gap-1 rounded-lg bg-default-soft px-2 py-1">
        <input
          autoFocus
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") commit();
            if (e.key === "Escape") setEditing(false);
          }}
          className="min-w-0 flex-1 bg-transparent text-sm outline-none"
          aria-label="Sohbet adı"
        />
        <Button isIconOnly size="sm" variant="ghost" aria-label="Kaydet" onPress={commit}>
          <Check size={14} />
        </Button>
      </li>
    );
  }

  return (
    <li
      className={`group flex cursor-pointer items-center gap-1 rounded-lg px-2 py-1.5 transition-colors ${
        props.active ? "bg-accent-soft" : "hover:bg-default-soft"
      }`}
      onClick={props.onOpen}
      onMouseLeave={() => setConfirmDelete(false)}
    >
      <div className="min-w-0 flex-1">
        <div className={`truncate text-sm ${props.active ? "font-medium text-accent-soft-foreground" : ""}`}>{props.title}</div>
        <div className="text-[11px] text-muted">{props.subtitle}</div>
      </div>
      <div className="hidden shrink-0 items-center group-hover:flex" onClick={(e) => e.stopPropagation()}>
        {confirmDelete ? (
          <>
            <Button isIconOnly size="sm" variant="danger" aria-label="Silmeyi onayla" onPress={props.onDelete}>
              <Check size={14} />
            </Button>
            <Button isIconOnly size="sm" variant="ghost" aria-label="Vazgeç" onPress={() => setConfirmDelete(false)}>
              <X size={14} />
            </Button>
          </>
        ) : (
          <>
            {props.onRename && (
              <Button
                isIconOnly
                size="sm"
                variant="ghost"
                aria-label="Yeniden adlandır"
                onPress={() => {
                  setDraft(props.title);
                  setEditing(true);
                }}
              >
                <Pencil size={13} />
              </Button>
            )}
            <Button isIconOnly size="sm" variant="ghost" aria-label="Sil" onPress={() => setConfirmDelete(true)}>
              <Trash2 size={13} />
            </Button>
          </>
        )}
      </div>
    </li>
  );
}

function Empty({ text }: { text: string }) {
  return <p className="px-2 py-6 text-center text-xs text-muted">{text}</p>;
}
