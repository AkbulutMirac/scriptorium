import { Button, Spinner, Switch, Tooltip } from "@heroui/react";
import {
  ChevronRight,
  CircleStop,
  Cpu,
  FileCode2,
  Folder,
  FolderPlus,
  GitBranch,
  GitCompareArrows,
  Info,
  Monitor,
  RefreshCw,
  RotateCw,
  X,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { load, save } from "../../lib/storage";
import { UsageCard } from "./UsageCard";
import { actions, agentMeta, useApp, type ClaudeChat } from "../../store";

const fmt = (n: number) => n.toLocaleString("tr-TR");

/** Claude oturumunun bilgi paneli: ortam, bağlam, bağlayıcılar, çıktılar, değişiklikler, arka plan görevleri */
export function InfoPanel({ chatId }: { chatId: string }) {
  const chat = useApp((s) => s.chats[chatId]);
  const git = useApp((s) => s.git[s.chats[chatId]?.cwd ?? ""]);

  useEffect(() => {
    actions.requestInfo(chatId);
  }, [chatId]);

  if (!chat) return null;

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex items-center gap-2 border-b border-separator px-3 py-2.5">
        <Info size={16} className="text-accent" />
        <span className="flex-1 text-sm font-semibold">Oturum bilgisi</span>
        <Tooltip delay={300}>
          <Button isIconOnly size="sm" variant="ghost" aria-label="Yenile" onPress={() => actions.requestInfo(chatId)}>
            <RefreshCw size={14} />
          </Button>
          <Tooltip.Content>Yenile</Tooltip.Content>
        </Tooltip>
        <Button isIconOnly size="sm" variant="ghost" aria-label="Paneli kapat" onPress={() => actions.setUi({ infoOpen: false })}>
          <X size={16} />
        </Button>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto px-3 py-2 text-sm">
        <Environment chat={chat} branch={git?.branch} />
        <ContextSection chat={chat} />
        <Section id="usage" title="Kullanım">
          <UsageCard usage={chat.info?.usage} />
        </Section>
        <Connectors chat={chat} />
        <Outputs chat={chat} isRepo={!!git?.isRepo} />
        <Changes chat={chat} />
        <BackgroundTasks chat={chat} />
      </div>
    </div>
  );
}

/** Bölümlerin varsayılan açık/kapalı durumu; kullanıcının seçimi hatırlanır */
const SECTION_DEFAULTS: Record<string, boolean> = {
  env: true,
  context: true,
  usage: true,
  connectors: false,
  outputs: false,
  changes: false,
  tasks: false,
};

function Section({ id, title, right, children }: { id: string; title: string; right?: ReactNode; children: ReactNode }) {
  const [open, setOpen] = useState(() => load<Record<string, boolean>>("infoSections", {})[id] ?? SECTION_DEFAULTS[id] ?? true);
  const focus = useApp((s) => s.infoFocus);
  const ref = useRef<HTMLElement>(null);

  // "Tümünü gör" gibi bir yerden bu bölüme odaklanıldıysa aç ve görünür kıl
  useEffect(() => {
    if (focus?.section !== id) return;
    setOpen(true);
    setTimeout(() => ref.current?.scrollIntoView({ behavior: "smooth", block: "start" }), 50);
  }, [focus, id]);

  const toggle = () => {
    const next = !open;
    setOpen(next);
    save("infoSections", { ...load<Record<string, boolean>>("infoSections", {}), [id]: next });
  };

  return (
    <section ref={ref} className="border-b border-separator py-2.5 last:border-b-0">
      <div className="flex items-center gap-1">
        <button type="button" onClick={toggle} className="flex flex-1 items-center gap-1 text-left text-xs font-semibold text-muted hover:text-foreground">
          <ChevronRight size={13} className={`transition-transform ${open ? "rotate-90" : ""}`} />
          {title}
        </button>
        {right}
      </div>
      {open && <div className="mt-2 flex flex-col gap-1.5">{children}</div>}
    </section>
  );
}

function Row({ icon, children, title }: { icon: ReactNode; children: ReactNode; title?: string }) {
  return (
    <div className="flex min-w-0 items-center gap-2" title={title}>
      <span className="shrink-0 text-muted">{icon}</span>
      <div className="min-w-0 flex-1 truncate">{children}</div>
    </div>
  );
}

function Environment({ chat, branch }: { chat: ClaudeChat; branch?: string }) {
  const [adding, setAdding] = useState(false);
  const [path, setPath] = useState("");
  const folder = chat.cwd.replaceAll("\\", "/").split("/").filter(Boolean).pop();
  const add = () => {
    if (!path.trim()) return;
    actions.setDirs(chat.chatId, [...chat.dirs, path.trim()]);
    setPath("");
    setAdding(false);
  };
  return (
    <Section id="env" title="Ortam">
      <Row icon={<Monitor size={14} />}>Bu bilgisayar</Row>
      <Row icon={<Folder size={14} />} title={chat.cwd}>
        <span className="font-medium">{folder}</span> <span className="font-code text-xs text-muted">{chat.cwd}</span>
      </Row>
      {chat.dirs.map((d) => (
        <Row key={d} icon={<FolderPlus size={14} />} title={d}>
          <span className="flex items-center gap-1">
            <span className="font-code min-w-0 flex-1 truncate text-xs">{d}</span>
            <button
              type="button"
              aria-label="Klasörü çıkar"
              className="shrink-0 text-muted hover:text-danger"
              onClick={() => actions.setDirs(chat.chatId, chat.dirs.filter((x) => x !== d))}
            >
              <X size={12} />
            </button>
          </span>
        </Row>
      ))}
      {branch && <Row icon={<GitBranch size={14} />}>{branch}</Row>}
      {(chat.init?.version || chat.model) && (
        <Row icon={<Cpu size={14} />}>
          <span className="text-xs text-muted">
            {chat.model}
            {chat.init?.version && ` · Claude Code ${chat.init.version}`}
          </span>
        </Row>
      )}
      {adding ? (
        <div className="flex gap-1">
          <input
            autoFocus
            value={path}
            onChange={(e) => setPath(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") add();
              if (e.key === "Escape") setAdding(false);
            }}
            placeholder="C:\Users\...\proje"
            className="font-code min-w-0 flex-1 rounded-md border border-field-border bg-field px-2 py-1 text-xs outline-none focus:border-accent"
          />
          <Button size="sm" variant="secondary" onPress={add}>
            Ekle
          </Button>
        </div>
      ) : (
        <div className="flex items-center gap-3">
          <button type="button" onClick={() => actions.openFolderPicker("dir", chat.chatId)} className="flex items-center gap-2 text-xs text-muted hover:text-foreground">
            <FolderPlus size={14} /> Klasör ekle
          </button>
          <button type="button" onClick={() => setAdding(true)} className="text-[11px] text-muted hover:text-foreground">
            yol yaz
          </button>
        </div>
      )}
    </Section>
  );
}

function ContextSection({ chat }: { chat: ClaudeChat }) {
  const ctx = chat.info?.context;
  return (
    <Section id="context" title="Bağlam" right={ctx && <span className="text-xs tabular-nums text-muted">%{Math.round(ctx.percentage)}</span>}>
      {ctx ? (
        <>
          <div className="h-1.5 overflow-hidden rounded-full bg-default-soft">
            <div
              className={`h-full rounded-full ${ctx.percentage > 85 ? "bg-danger" : ctx.percentage > 65 ? "bg-warning" : "bg-accent"}`}
              style={{ width: `${Math.min(100, ctx.percentage)}%` }}
            />
          </div>
          <p className="text-xs text-muted">
            {fmt(ctx.totalTokens)} / {fmt(ctx.maxTokens)} token
          </p>
        </>
      ) : (
        <Loading />
      )}
    </Section>
  );
}

const STATUS_COLOR: Record<string, string> = {
  connected: "bg-success",
  pending: "bg-warning",
  "needs-auth": "bg-warning",
  failed: "bg-danger",
  disabled: "bg-default",
};
const STATUS_TEXT: Record<string, string> = {
  connected: "bağlı",
  pending: "bağlanıyor",
  "needs-auth": "giriş gerekli",
  failed: "hata",
  disabled: "kapalı",
};

export function ConnectorList({ chat }: { chat: ClaudeChat }) {
  const list = chat.info?.mcp ?? chat.init?.mcpServers ?? [];
  if (!chat.info && !chat.init) return <Loading />;
  if (!list.length) return <p className="text-xs text-muted">Bağlayıcı yok.</p>;
  return (
    <ul className="flex flex-col gap-1.5">
      {list.map((m) => {
        const extra = m as { error?: string; toolCount?: number };
        return (
          <li key={m.name} className="flex items-center gap-2">
            <span className={`size-2 shrink-0 rounded-full ${STATUS_COLOR[m.status] ?? "bg-default"}`} />
            <div className="min-w-0 flex-1">
              <div className="truncate text-sm">{m.name === "workers" ? "Scriptorium işçileri" : m.name}</div>
              <div className="truncate text-[11px] text-muted" title={extra.error}>
                {STATUS_TEXT[m.status] ?? m.status}
                {extra.toolCount !== undefined && ` · ${extra.toolCount} araç`}
                {extra.error && ` · ${extra.error}`}
              </div>
            </div>
            {(m.status === "failed" || m.status === "needs-auth") && (
              <Tooltip delay={300}>
                <Button isIconOnly size="sm" variant="ghost" aria-label="Yeniden bağlan" onPress={() => actions.reconnectMcp(chat.chatId, m.name)}>
                  <RotateCw size={13} />
                </Button>
                <Tooltip.Content>Yeniden bağlan</Tooltip.Content>
              </Tooltip>
            )}
            {m.name !== "workers" && (
              <Switch size="sm" isSelected={m.status !== "disabled"} onChange={(on) => actions.toggleMcp(chat.chatId, m.name, on)} aria-label={`${m.name} aç/kapat`}>
                <Switch.Control>
                  <Switch.Thumb />
                </Switch.Control>
              </Switch>
            )}
          </li>
        );
      })}
    </ul>
  );
}

function Connectors({ chat }: { chat: ClaudeChat }) {
  const count = (chat.info?.mcp ?? chat.init?.mcpServers ?? []).length;
  return (
    <Section id="connectors" title="Bağlayıcılar" right={count > 0 && <span className="text-xs text-muted">{count}</span>}>
      <ConnectorList chat={chat} />
    </Section>
  );
}

const WRITE_TOOLS = new Set(["Write", "Edit", "MultiEdit", "NotebookEdit"]);

/** Claude'un bu oturumda yazdığı/düzenlediği dosyalar (en son dokunulan önce) */
function Outputs({ chat, isRepo }: { chat: ClaudeChat; isRepo: boolean }) {
  const files = useMemo(() => {
    const seen = new Map<string, number>();
    chat.items.forEach((it, i) => {
      if (it.kind !== "tool" || !WRITE_TOOLS.has(it.name)) return;
      const p = String(it.input.file_path ?? it.input.notebook_path ?? "");
      if (p) seen.set(p, i);
    });
    return [...seen.entries()].sort((a, b) => b[1] - a[1]).map(([p]) => p);
  }, [chat.items]);

  const rel = (p: string) => {
    const norm = p.replaceAll("\\", "/");
    const base = chat.cwd.replaceAll("\\", "/").replace(/\/$/, "");
    return norm.toLowerCase().startsWith(base.toLowerCase() + "/") ? norm.slice(base.length + 1) : norm;
  };

  return (
    <Section id="outputs" title="Çıktılar" right={files.length > 0 && <span className="text-xs text-muted">{files.length}</span>}>
      {files.length === 0 ? (
        <p className="text-xs text-muted">Bu oturumda henüz dosya yazılmadı.</p>
      ) : (
        <ul className="flex flex-col gap-0.5">
          {files.map((f) => (
            <li key={f}>
              <button
                type="button"
                title={f}
                onClick={() => (isRepo ? actions.showGitDiff(chat.cwd, rel(f)) : actions.showOverlay({ title: f, body: "Bu klasör bir git deposu değil, fark gösterilemiyor.", mono: true }))}
                className="flex w-full min-w-0 items-center gap-2 rounded-md px-1 py-0.5 text-left hover:bg-default-soft"
              >
                <FileCode2 size={14} className="shrink-0 text-muted" />
                <span className="truncate text-xs">{rel(f)}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </Section>
  );
}

function Changes({ chat }: { chat: ClaudeChat }) {
  const git = useApp((s) => s.git[chat.cwd]);
  return (
    <Section
      id="changes"
      title="Değişiklikler"
      right={
        git?.isRepo ? (
          <span className="text-xs tabular-nums">
            <span className="text-success">+{fmt(git.added)}</span> <span className="text-danger">−{fmt(git.removed)}</span>
          </span>
        ) : undefined
      }
    >
      {!git ? (
        <Loading />
      ) : !git.isRepo ? (
        <p className="text-xs text-muted">Bu klasör bir git deposu değil.</p>
      ) : git.files.length === 0 ? (
        <p className="text-xs text-muted">Değişiklik yok.</p>
      ) : (
        <>
          <ul className="flex max-h-56 flex-col gap-0.5 overflow-y-auto">
            {git.files.slice(0, 100).map((f) => (
              <li key={f.path}>
                <button
                  type="button"
                  onClick={() => actions.showGitDiff(chat.cwd, f.path)}
                  className="flex w-full min-w-0 items-center gap-2 rounded-md px-1 py-0.5 text-left hover:bg-default-soft"
                  title={f.path}
                >
                  <span className="min-w-0 flex-1 truncate text-xs">
                    {f.path}
                    {f.untracked && <span className="ml-1 text-[10px] text-success">yeni</span>}
                  </span>
                  <span className="shrink-0 text-[11px] tabular-nums">
                    <span className="text-success">+{f.added}</span> <span className="text-danger">−{f.removed}</span>
                  </span>
                </button>
              </li>
            ))}
          </ul>
          <div className="flex gap-1">
            <Button size="sm" variant="secondary" onPress={() => actions.showGitDiff(chat.cwd)}>
              <GitCompareArrows size={14} /> Tüm farkı gör
            </Button>
            <Button isIconOnly size="sm" variant="ghost" aria-label="Yenile" onPress={() => actions.refreshGit(chat.cwd)}>
              <RefreshCw size={13} />
            </Button>
          </div>
        </>
      )}
    </Section>
  );
}

const TASK_TEXT: Record<string, string> = {
  pending: "bekliyor",
  queued: "sırada",
  running: "çalışıyor",
  paused: "duraklatıldı",
  completed: "bitti",
  done: "bitti",
  failed: "hata",
  error: "hata",
  killed: "durduruldu",
  stopped: "durduruldu",
};

function BackgroundTasks({ chat }: { chat: ClaudeChat }) {
  const jobs = useApp((s) => s.jobs);
  const workers = useApp((s) => s.workers);
  const tasks = Object.values(chat.tasks);
  const running = tasks.filter((t) => t.status === "running" || t.status === "pending").length + jobs.filter((j) => j.status === "running" || j.status === "queued").length;

  return (
    <Section id="tasks" title="Arka plan görevleri" right={running > 0 && <span className="text-xs text-accent">{running} aktif</span>}>
      {tasks.length === 0 && jobs.length === 0 && <p className="text-xs text-muted">Arka planda çalışan görev yok.</p>}
      {tasks.map((t) => (
        <div key={t.id} className="flex items-center gap-2">
          {t.status === "running" ? <Spinner size="sm" /> : <span className={`size-2 rounded-full ${t.status === "failed" ? "bg-danger" : "bg-success"}`} />}
          <div className="min-w-0 flex-1">
            <div className="truncate text-xs" title={t.description}>
              {t.description}
            </div>
            <div className="truncate text-[11px] text-muted" title={t.summary ?? t.error}>
              Claude · {TASK_TEXT[t.status] ?? t.status}
              {(t.summary || t.error) && ` · ${t.summary ?? t.error}`}
            </div>
          </div>
          {t.status === "running" && (
            <Tooltip delay={300}>
              <Button isIconOnly size="sm" variant="ghost" aria-label="Görevi durdur" onPress={() => actions.stopTask(chat.chatId, t.id)}>
                <CircleStop size={14} />
              </Button>
              <Tooltip.Content>Durdur</Tooltip.Content>
            </Tooltip>
          )}
        </div>
      ))}
      {jobs.slice(0, 15).map((j) => {
        const meta = agentMeta(j.workerId, workers);
        return (
          <button
            key={j.id}
            type="button"
            onClick={() => j.result && actions.showOverlay({ title: `${meta.name} · iş ${j.id}`, body: j.result })}
            className="flex items-center gap-2 text-left"
          >
            {j.status === "running" ? <Spinner size="sm" /> : <span className="size-2 rounded-full" style={{ background: meta.color }} />}
            <div className="min-w-0 flex-1">
              <div className="truncate text-xs" title={j.task}>
                {j.task}
              </div>
              <div className="truncate text-[11px] text-muted">
                {meta.name} · {TASK_TEXT[j.status] ?? j.status}
                {j.error && ` · ${j.error}`}
              </div>
            </div>
          </button>
        );
      })}
    </Section>
  );
}

function Loading() {
  return (
    <div className="flex items-center gap-2 text-xs text-muted">
      <Spinner size="sm" /> Yükleniyor…
    </div>
  );
}

