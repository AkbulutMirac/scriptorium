import { Button, Modal, ScrollShadow, Tooltip } from "@heroui/react";
import { Check, ChevronRight, Copy, Eye, EyeOff, Folder, FolderOpen, MessageSquare, PanelLeftOpen, Pencil, Plus, RefreshCw, SquarePen, Trash2, X } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { load, save } from "../lib/storage";
import { ContextMenu, type MenuItem } from "./ContextMenu";
import type { SessionSummary } from "../protocol";
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

const keyOf = (p: string) => p.normalize("NFC").replaceAll("\\", "/").toLowerCase().replace(/\/$/, "");

/** Claude oturumları projelere (klasörlere) göre gruplanmış: Claude uygulamasının kenar çubuğu gibi */
function ClaudeHistory() {
  const all = useApp((s) => s.allSessions);
  const projects = useApp((s) => s.projects);
  const activeSession = useApp((s) => s.chats[s.mainChatId ?? ""]?.sessionId);
  const activeCwd = useApp((s) => s.chats[s.mainChatId ?? ""]?.cwd ?? "");
  const [open, setOpen] = useState<Record<string, boolean>>({});
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [menu, setMenu] = useState<{ x: number; y: number; items: MenuItem[] } | null>(null);
  const [confirm, setConfirm] = useState<{ title: string; text: string; ids: string[] } | null>(null);
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
      const k = keyOf(s.cwd);
      const g = map.get(k) ?? { path: s.cwd, name: s.cwd.replaceAll("\\", "/").split("/").filter(Boolean).pop() ?? s.cwd, sessions: [], last: 0 };
      g.sessions.push(s);
      g.last = Math.max(g.last, s.updatedAt);
      map.set(k, g);
    }
    for (const g of map.values()) g.sessions.sort((a, b) => b.updatedAt - a.updatedAt);
    // Ayırt edilebilir adlar: worktree'leri işaretle, aynı adlı projelerin yanına üst klasörü yaz
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

  if (!groups.length) return <Empty text="Henüz proje ya da sohbet yok." />;
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
        { label: "Bu klasörde yeni sohbet", icon: Plus, onSelect: () => actions.newClaudeChat(g.path) },
        { label: "Klasör yolunu kopyala", icon: Copy, onSelect: () => navigator.clipboard.writeText(g.path) },
        isHidden
          ? { label: "Listede göster", icon: Eye, onSelect: () => hide(k, false) }
          : { label: "Listeden gizle", icon: EyeOff, onSelect: () => hide(k, true) },
        ...(g.sessions.length
          ? (["separator", {
              label: `Tüm sohbetlerini sil (${g.sessions.length})`,
              icon: Trash2,
              danger: true,
              onSelect: () =>
                setConfirm({
                  title: `"${g.name}" sohbetleri silinsin mi?`,
                  text: `Bu klasördeki ${g.sessions.length} Claude sohbeti kalıcı olarak silinecek. Geri alınamaz. Diskteki klasöre ve dosyalarına dokunulmaz, sadece sohbet kayıtları silinir.`,
                  ids: g.sessions.map((s) => s.id),
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
        { label: "Aç", icon: MessageSquare, onSelect: () => actions.openClaudeSession(s.id) },
        { label: "Yeniden adlandır", icon: Pencil, onSelect: () => setEditReq({ id: s.id, n: Date.now() }) },
        "separator",
        {
          label: "Sil",
          icon: Trash2,
          danger: true,
          onSelect: () => setConfirm({ title: "Sohbet silinsin mi?", text: `"${s.title}" kalıcı olarak silinecek. Geri alınamaz.`, ids: [s.id] }),
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
                Vazgeç
              </Button>
              <Button
                size="sm"
                variant="danger"
                onPress={() => {
                  if (confirm) actions.deleteSessions(confirm.ids);
                  setConfirm(null);
                }}
              >
                Kalıcı olarak sil
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
              <button type="button" onClick={() => setOpen({ ...open, [k]: !isOpen })} className="flex min-w-0 flex-1 items-center gap-1.5 text-left" title={g.path}>
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
                  className="h-6 w-6 min-w-6 opacity-0 group-hover:opacity-100"
                  aria-label={`${g.name} klasöründe yeni sohbet`}
                  onPress={() => actions.newClaudeChat(g.path)}
                >
                  <Plus size={13} />
                </Button>
                <Tooltip.Content>Bu klasörde yeni sohbet</Tooltip.Content>
              </Tooltip>
            </div>
            {isOpen && (
              <ul className="ml-3 flex flex-col gap-0.5 border-l border-separator pl-1.5">
                {g.sessions.length === 0 && <li className="px-2 py-1 text-[11px] text-muted">Sohbet yok. + ile başlat.</li>}
                {list.map((s) => (
                  <HistoryRow
                    key={s.id}
                    title={s.title}
                    subtitle={relativeTime(s.updatedAt)}
                    active={s.id === activeSession}
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
                      {expanded[k] ? "Daha az göster" : `${g.sessions.length - 6} sohbet daha`}
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
          {showHidden ? "Gizlenenleri sakla" : `Gizlenenleri göster (${hiddenCount})`}
        </button>
      )}
    </div>
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
  onContextMenu?: (e: React.MouseEvent) => void;
  /** Değiştiğinde satır yeniden adlandırma moduna geçer (sağ tık menüsünden) */
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
      onContextMenu={props.onContextMenu}
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
