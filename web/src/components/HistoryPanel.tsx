import { Button, Modal, ScrollShadow, Tooltip } from "@heroui/react";
import { Check, ChevronRight, Copy, Eye, EyeOff, Folder, FolderOpen, FolderPlus, MessageSquare, PanelLeftOpen, Pencil, Plus, RefreshCw, SquarePen, Trash2, X } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { load, save } from "../lib/storage";
import { COMPACT_QUERY, isCompactNow, MOBILE_QUERY, useMedia } from "../lib/useMedia";
import { Drawer } from "./Drawer";
import { ContextMenu, type MenuItem } from "./ContextMenu";
import type { SessionSummary } from "../protocol";
import { relativeTime } from "../lib/format";
import { actions, agentMeta, CLAUDE_ID, SEEN_SINCE, useApp } from "../store";
import { copyText } from "../lib/clipboard";

export function HistoryPanel() {
  const open = useApp((s) => s.ui.historyOpen);
  const selected = useApp((s) => s.selected);
  const workers = useApp((s) => s.workers);
  const meta = agentMeta(selected, workers);
  const compact = useMedia(COMPACT_QUERY);
  const mobile = useMedia(MOBILE_QUERY);
  const newChat = () => {
    if (selected === CLAUDE_ID) actions.newClaudeChat();
    else actions.newWorkerChat(selected);
    if (compact) actions.setUi({ historyOpen: false });
  };

  if (!open) {
    // On phones the top bar button opens the drawer, so the rail is not needed.
    if (mobile) return null;
    return (
      <nav className="flex w-12 shrink-0 flex-col items-center gap-1 border-r border-separator bg-surface py-2">
        <Tooltip delay={300}>
          <Button isIconOnly size="sm" variant="ghost" aria-label="Show history" onPress={() => actions.setUi({ historyOpen: true })}>
            <PanelLeftOpen size={18} />
          </Button>
          <Tooltip.Content placement="right">Show history</Tooltip.Content>
        </Tooltip>
        <Tooltip delay={300}>
          <Button isIconOnly size="sm" variant="ghost" aria-label="New chat" onPress={newChat}>
            <SquarePen size={18} />
          </Button>
          <Tooltip.Content placement="right">New chat</Tooltip.Content>
        </Tooltip>
      </nav>
    );
  }

  const panel = (
    <nav className={`flex flex-col bg-surface ${compact ? "h-full" : "w-64 shrink-0 border-r border-separator"}`}>
      <div className="flex items-center gap-2 px-3 pb-2 pt-3">
        <span className="size-2.5 shrink-0 rounded-full" style={{ background: meta.color }} />
        <span className="min-w-0 flex-1 truncate text-sm font-semibold">{meta.name}</span>
        {selected === CLAUDE_ID && (
          <Tooltip delay={300}>
            <Button isIconOnly size="sm" variant="ghost" aria-label="Refresh" onPress={() => actions.refreshSessions()}>
              <RefreshCw size={15} />
            </Button>
            <Tooltip.Content>Refresh list</Tooltip.Content>
          </Tooltip>
        )}
        {selected === CLAUDE_ID && (
          <Tooltip delay={300}>
            <Button isIconOnly size="sm" variant="ghost" aria-label="New chat in another folder" onPress={() => actions.openFolderPicker("cwd")}>
              <FolderPlus size={15} />
            </Button>
            <Tooltip.Content>New chat in another folder</Tooltip.Content>
          </Tooltip>
        )}
      </div>
      <div className="px-2 pb-2">
        <Button fullWidth size="sm" variant="secondary" onPress={newChat}>
          <SquarePen size={15} />
          New chat
        </Button>
      </div>
      <ScrollShadow className="min-h-0 flex-1 px-2 pb-3">
        {selected === CLAUDE_ID ? <ClaudeHistory /> : <WorkerHistory workerId={selected} />}
      </ScrollShadow>
    </nav>
  );
  return compact ? (
    <Drawer side="left" width="min(18rem, 85%)" onClose={() => actions.setUi({ historyOpen: false })}>
      {panel}
    </Drawer>
  ) : (
    panel
  );
}

const keyOf = (p: string) => p.normalize("NFC").replaceAll("\\", "/").toLowerCase().replace(/\/$/, "");

/** Claude sessions grouped by projects (folders): like the Claude app's sidebar */
function ClaudeHistory() {
  const all = useApp((s) => s.allSessions);
  const projects = useApp((s) => s.projects);
  const activeSession = useApp((s) => s.chats[s.mainChatId ?? ""]?.sessionId);
  const seenAt = useApp((s) => s.seenAt);
  const activeCwd = useApp((s) => s.chats[s.mainChatId ?? ""]?.cwd ?? "");
  const [open, setOpen] = useState<Record<string, boolean>>({});
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [menu, setMenu] = useState<{ x: number; y: number; items: MenuItem[] } | null>(null);
  const [confirm, setConfirm] = useState<{ title: string; text: string; ids: string[]; hideKey?: string } | null>(null);
  const [hidden, setHidden] = useState<string[]>(() => load<string[]>("hiddenProjects", []));
  const [showHidden, setShowHidden] = useState(false);
  const [editReq, setEditReq] = useState<{ id: string; n: number } | null>(null);
  const hide = (k: string, on: boolean) => {
    const next = on ? [...new Set([...hidden, k])] : hidden.filter((x) => x !== k);
    setHidden(next);
    save("hiddenProjects", next);
  };

  const groups = useMemo(() => {
    const map = new Map<string, { path: string; name: string; sessions: SessionSummary[]; last: number }>();
    for (const p of projects) map.set(keyOf(p.path), { path: p.path, name: p.name, sessions: [], last: p.lastUsed });
    for (const s of all) {
      if (!s.cwd) continue;
      // The Claude app's folder-less chats each have their own scratch folder: one "This computer" group, like the app
      const root = s.scratch ? s.cwd.slice(0, s.cwd.search(/scratch-workspaces/i) + "scratch-workspaces".length) : s.cwd;
      const k = keyOf(root);
      const g = map.get(k) ?? { path: root, name: s.scratch ? "This computer" : (root.replaceAll("\\", "/").split("/").filter(Boolean).pop() ?? root), sessions: [], last: 0 };
      g.sessions.push(s);
      g.last = Math.max(g.last, s.updatedAt);
      map.set(k, g);
    }
    for (const g of map.values()) g.sessions.sort((a, b) => b.updatedAt - a.updatedAt);
    // Distinguishable names: mark worktrees, append the parent folder next to projects with the same name
    const list = [...map.values()].map((g) => {
      const parts = g.path.replaceAll("\\", "/").split("/").filter(Boolean);
      const wt = parts.indexOf("worktrees");
      return wt > 0 && parts[wt - 1] === ".claude" ? { ...g, name: `${g.name} (worktree)` } : g;
    });
    const counts = new Map<string, number>();
    for (const g of list) counts.set(g.name.toLowerCase(), (counts.get(g.name.toLowerCase()) ?? 0) + 1);
    return list
      .map((g) => {
        if ((counts.get(g.name.toLowerCase()) ?? 0) < 2) return g;
        const parent = g.path.replaceAll("\\", "/").split("/").filter(Boolean).slice(-2, -1)[0];
        return { ...g, name: `${g.name} · ${parent}` };
      })
      .sort((a, b) => b.last - a.last);
  }, [all, projects]);

  if (!groups.length) return <Empty text="No projects or chats yet." />;
  const activeKey = keyOf(activeCwd);
  const visible = groups.filter((g) => showHidden || !hidden.includes(keyOf(g.path)) || keyOf(g.path) === activeKey);
  const hiddenCount = groups.filter((g) => hidden.includes(keyOf(g.path))).length;

  const projectMenu = (e: React.MouseEvent, g: (typeof groups)[number]) => {
    e.preventDefault();
    const k = keyOf(g.path);
    const isHidden = hidden.includes(k);
    setMenu({
      x: e.clientX,
      y: e.clientY,
      items: [
        { label: "New chat in this folder", icon: Plus, onSelect: () => actions.newClaudeChat(g.path) },
        { label: "Copy folder path", icon: Copy, onSelect: () => copyText(g.path) },
        isHidden
          ? { label: "Show in list", icon: Eye, onSelect: () => hide(k, false) }
          : { label: "Hide from list", icon: EyeOff, onSelect: () => hide(k, true) },
        ...(g.sessions.length
          ? (["separator", {
              label: `Delete all its chats (${g.sessions.length})`,
              icon: Trash2,
              danger: true,
              onSelect: () =>
                setConfirm({
                  title: `Delete the chats in "${g.name}"?`,
                  text: `The ${g.sessions.length} Claude chats in this folder will be permanently deleted. This can't be undone. The folder and files on disk are left untouched; only the chat records are deleted. The project will also be hidden from the list.`,
                  ids: g.sessions.map((s) => s.id),
                  hideKey: k,
                }),
            }] as MenuItem[])
          : []),
      ],
    });
  };

  const sessionMenu = (e: React.MouseEvent, s: SessionSummary) => {
    e.preventDefault();
    setMenu({
      x: e.clientX,
      y: e.clientY,
      items: [
        { label: "Open", icon: MessageSquare, onSelect: () => actions.openClaudeSession(s.id) },
        { label: "Rename", icon: Pencil, onSelect: () => setEditReq({ id: s.id, n: Date.now() }) },
        "separator",
        {
          label: "Delete",
          icon: Trash2,
          danger: true,
          onSelect: () => setConfirm({ title: "Delete chat?", text: `"${s.title}" will be permanently deleted. This can't be undone.`, ids: [s.id] }),
        },
      ],
    });
  };

  return (
    <div className="flex flex-col gap-0.5">
      {menu && <ContextMenu x={menu.x} y={menu.y} items={menu.items} onClose={() => setMenu(null)} />}
      <Modal.Backdrop isOpen={!!confirm} onOpenChange={(o) => !o && setConfirm(null)}>
        <Modal.Container size="sm">
          <Modal.Dialog>
            <Modal.Header>
              <Modal.Heading>{confirm?.title}</Modal.Heading>
            </Modal.Header>
            <Modal.Body>
              <p className="text-sm text-muted">{confirm?.text}</p>
            </Modal.Body>
            <Modal.Footer className="flex justify-end gap-2">
              <Button size="sm" variant="secondary" onPress={() => setConfirm(null)}>
                Cancel
              </Button>
              <Button
                size="sm"
                variant="danger"
                onPress={() => {
                  if (confirm) {
                    actions.deleteSessions(confirm.ids);
                    // Keep a project folder that still exists on disk out of the list
                    if (confirm.hideKey) hide(confirm.hideKey, true);
                  }
                  setConfirm(null);
                }}
              >
                Delete permanently
              </Button>
            </Modal.Footer>
          </Modal.Dialog>
        </Modal.Container>
      </Modal.Backdrop>
      {visible.map((g) => {
        const k = keyOf(g.path);
        const isOpen = open[k] ?? k === activeKey;
        const list = expanded[k] ? g.sessions : g.sessions.slice(0, 6);
        return (
          <div key={k}>
            <div
              onContextMenu={(e) => projectMenu(e, g)}
              className={`group flex items-center gap-1 rounded-lg px-1.5 py-1 ${k === activeKey ? "text-foreground" : "text-muted"} ${hidden.includes(k) ? "opacity-60" : ""} hover:bg-default-soft`}
            >
              <button type="button" onClick={() => setOpen({ ...open, [k]: !isOpen })} className="flex min-w-0 flex-1 items-center gap-1.5 text-left [@media(pointer:coarse)]:min-h-9" title={g.path}>
                <ChevronRight size={13} className={`shrink-0 transition-transform ${isOpen ? "rotate-90" : ""}`} />
                {isOpen ? <FolderOpen size={14} className="shrink-0" /> : <Folder size={14} className="shrink-0" />}
                <span className="truncate text-[13px] font-medium">{g.name}</span>
                {g.sessions.length > 0 && <span className="shrink-0 text-[10px] text-muted">{g.sessions.length}</span>}
              </button>
              <Tooltip delay={300}>
                <Button
                  isIconOnly
                  size="sm"
                  variant="ghost"
                  className="h-6 w-6 min-w-6 opacity-0 group-hover:opacity-100 [@media(pointer:coarse)]:h-9 [@media(pointer:coarse)]:w-9 [@media(pointer:coarse)]:opacity-100"
                  aria-label={`New chat in ${g.name}`}
                  onPress={() => actions.newClaudeChat(g.path)}
                >
                  <Plus size={13} />
                </Button>
                <Tooltip.Content>New chat in this folder</Tooltip.Content>
              </Tooltip>
            </div>
            {isOpen && (
              <ul className="ml-3 flex flex-col gap-0.5 border-l border-separator pl-1.5">
                {g.sessions.length === 0 && <li className="px-2 py-1 text-[11px] text-muted">No chats. Start one with +.</li>}
                {list.map((s) => (
                  <HistoryRow
                    key={s.id}
                    title={s.title}
                    subtitle={relativeTime(s.updatedAt)}
                    active={s.id === activeSession}
                    unread={s.id !== activeSession && s.updatedAt > Math.max(seenAt[s.id] ?? 0, SEEN_SINCE)}
                    onOpen={() => actions.openClaudeSession(s.id)}
                    onRename={(t) => actions.renameSession(s.id, t)}
                    onDelete={() => actions.deleteSession(s.id)}
                    onContextMenu={(e) => sessionMenu(e, s)}
                    editRequest={editReq?.id === s.id ? editReq.n : undefined}
                  />
                ))}
                {g.sessions.length > 6 && (
                  <li>
                    <button type="button" onClick={() => setExpanded({ ...expanded, [k]: !expanded[k] })} className="px-2 py-1 text-[11px] text-muted hover:text-foreground">
                      {expanded[k] ? "Show less" : `${g.sessions.length - 6} more chats`}
                    </button>
                  </li>
                )}
              </ul>
            )}
          </div>
        );
      })}
      {hiddenCount > 0 && (
        <button type="button" onClick={() => setShowHidden(!showHidden)} className="mt-1 px-2 py-1 text-left text-[11px] text-muted hover:text-foreground">
          {showHidden ? "Keep hidden" : `Show hidden (${hiddenCount})`}
        </button>
      )}
    </div>
  );
}

function WorkerHistory({ workerId }: { workerId: string }) {
  const chats = useApp((s) => s.workerChatLists[workerId]);
  const active = useApp((s) => s.activeWorkerChat[workerId]);
  if (!chats?.length) return <Empty text="No chats with this worker yet." />;
  // Direct chats first, then the tasks Claude delegated (from any Claude Code session)
  const groups = [
    { title: "Your chats", items: chats.filter((c) => !c.from) },
    { title: "From Claude", items: chats.filter((c) => c.from) },
  ].filter((g) => g.items.length);
  return (
    <div className="flex flex-col gap-3">
      {groups.map((g) => (
        <section key={g.title} className="flex flex-col gap-0.5">
          <h3 className="px-2 text-[11px] font-medium text-muted">
            {g.title} <span className="font-normal">{g.items.length}</span>
          </h3>
          <ul className="flex flex-col gap-0.5">
            {g.items.map((c) => (
              <HistoryRow
                key={c.id}
                title={c.title}
                subtitle={c.from?.label ? `${c.from.label} · ${relativeTime(c.updatedAt)}` : relativeTime(c.updatedAt)}
                active={c.id === active}
                onOpen={() => actions.openWorkerChat(workerId, c.id)}
                onDelete={() => actions.deleteWorkerChat(workerId, c.id)}
              />
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}

function HistoryRow(props: {
  title: string;
  subtitle: string;
  active: boolean;
  /** New messages since the chat was last opened: blue dot */
  unread?: boolean;
  onOpen: () => void;
  onRename?: (title: string) => void;
  onDelete: () => void;
  onContextMenu?: (e: React.MouseEvent) => void;
  /** When changed, the row switches to rename mode (from the right-click menu) */
  editRequest?: number;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(props.title);
  const [confirmDelete, setConfirmDelete] = useState(false);

  useEffect(() => {
    if (props.editRequest && props.onRename) {
      setDraft(props.title);
      setEditing(true);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [props.editRequest]);

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
          aria-label="Chat name"
        />
        <Button isIconOnly size="sm" variant="ghost" aria-label="Save" onPress={commit}>
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
      onClick={() => {
        props.onOpen();
        if (isCompactNow()) actions.setUi({ historyOpen: false });
      }}
      onContextMenu={props.onContextMenu}
      onMouseLeave={() => setConfirmDelete(false)}
    >
      <div className="min-w-0 flex-1">
        <div className={`truncate text-sm ${props.active ? "font-medium text-accent-soft-foreground" : ""}`}>{props.title}</div>
        <div className="text-[11px] text-muted">{props.subtitle}</div>
      </div>
      {props.unread && <span className="size-2 shrink-0 rounded-full bg-[#3b82f6] group-hover:hidden" aria-label="Unread" />}
      <div className="hidden shrink-0 items-center group-hover:flex [@media(pointer:coarse)]:flex" onClick={(e) => e.stopPropagation()}>
        {confirmDelete ? (
          <>
            <Button isIconOnly size="sm" variant="danger" aria-label="Confirm delete" onPress={props.onDelete}>
              <Check size={14} />
            </Button>
            <Button isIconOnly size="sm" variant="ghost" aria-label="Cancel" onPress={() => setConfirmDelete(false)}>
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
                aria-label="Rename"
                onPress={() => {
                  setDraft(props.title);
                  setEditing(true);
                }}
              >
                <Pencil size={13} />
              </Button>
            )}
            <Button isIconOnly size="sm" variant="ghost" aria-label="Delete" onPress={() => setConfirmDelete(true)}>
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
