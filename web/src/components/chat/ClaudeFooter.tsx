import { Button, Popover, Switch, Tooltip } from "@heroui/react";
import { Check, ChevronDown, Folder, FolderOpen, GitBranch, Laptop, Search, Zap } from "lucide-react";
import { useState } from "react";
import { relativeTime } from "../../lib/format";
import type { EffortLevel, ModelOption, PermissionMode } from "../../protocol";
import { pct, UsageCard } from "./UsageCard";
import { actions, useApp, type ClaudeChat } from "../../store";

export const EFFORT_LABEL: Record<EffortLevel, string> = { low: "Low", medium: "Medium", high: "High", xhigh: "Extra", max: "Max" };
const ALL_EFFORTS: EffortLevel[] = ["low", "medium", "high", "xhigh", "max"];

const MODES: { value: PermissionMode; label: string; hint: string }[] = [
  { value: "default", label: "Ask every step", hint: "Asks permission before commands and edits" },
  { value: "acceptEdits", label: "Accept edits", hint: "Makes file edits without asking" },
  { value: "plan", label: "Plan mode", hint: "Plans first, changes nothing" },
  { value: "auto", label: "Automatic", hint: "Approves safe steps on its own" },
];

/** Currently selected model (the user's choice or the model reported by the session) */
function currentModel(chat: ClaudeChat, models: ModelOption[]): ModelOption | undefined {
  if (chat.wantModel) return models.find((m) => m.value === chat.wantModel);
  return models.find((m) => m.resolvedModel === chat.model || m.value === chat.model) ?? models.find((m) => m.value === "default");
}

/** The name of the real model behind "Default (recommended)" (e.g. "Opus 5.5") */
function modelLabel(m: ModelOption | undefined, models: ModelOption[], fallback?: string): string {
  if (!m) return fallback ? fallback.replace(/^claude-/, "") : "Model";
  if (m.value === "default") {
    const real = models.find((x) => x.value !== "default" && x.resolvedModel && x.resolvedModel === m.resolvedModel);
    if (real) return real.displayName;
    return m.displayName.replace(/\s*\(.*\)\s*$/, "");
  }
  return m.displayName;
}

/** The bar below the compose box (like in the Claude app) */
export function ClaudeFooter({ chatId }: { chatId: string }) {
  const chat = useApp((s) => s.chats[chatId]);
  if (!chat) return null;
  return (
    <div className="mt-1.5 flex items-center gap-1 text-xs">
      <Tooltip delay={300}>
        <span className="flex items-center px-1.5 text-muted" aria-label="This computer">
          <Laptop size={14} />
        </span>
        <Tooltip.Content>Running on this computer</Tooltip.Content>
      </Tooltip>
      {!chat.isSide && <FolderButton chat={chat} />}
      <span className="flex-1" />
      <ModelMenu chat={chat} />
      <ModeMenu chat={chat} />
      <UsageRing chat={chat} />
    </div>
  );
}

function FolderButton({ chat }: { chat: ClaudeChat }) {
  const projects = useApp((s) => s.projects);
  const branch = useApp((s) => s.git[chat.cwd]?.branch);
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const started = !!chat.sessionId || chat.items.length > 0;
  const folder = chat.cwd.replaceAll("\\", "/").split("/").filter(Boolean).pop() || "Select folder";
  const shown = projects.filter((p) => !q || p.name.toLowerCase().includes(q.toLowerCase()) || p.path.toLowerCase().includes(q.toLowerCase()));

  const pick = (path: string) => {
    setOpen(false);
    actions.setChatCwd(chat.chatId, path);
  };

  return (
    <Popover
      isOpen={open}
      onOpenChange={(o) => {
        setOpen(o);
        if (o) {
          setQ("");
          actions.loadProjects();
        }
      }}
    >
      <Button size="sm" variant="ghost" className="h-7 gap-1.5 px-2 text-xs" aria-label="Working folder">
        <Folder size={13} />
        <span className="max-w-36 truncate">{folder}</span>
        {branch && (
          <span className="flex items-center gap-0.5 text-muted">
            <GitBranch size={11} />
            {branch}
          </span>
        )}
        <ChevronDown size={12} className="text-muted" />
      </Button>
      <Popover.Content placement="top start" className="w-96">
        <Popover.Dialog className="flex flex-col gap-2 p-1">
          <p className="px-1 text-xs text-muted">
            {started ? "This chat has started. A new chat opens in the folder you select." : "Claude works in the folder you select for this chat."}
          </p>
          <div className="flex items-center gap-2 rounded-lg border border-field-border bg-field px-2">
            <Search size={13} className="text-muted" />
            <input autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search projects" className="min-w-0 flex-1 bg-transparent py-1.5 text-sm outline-none" />
          </div>
          <ul className="flex max-h-72 flex-col overflow-y-auto">
            {shown.map((p) => {
              const active = p.path.toLowerCase() === chat.cwd.toLowerCase();
              return (
                <li key={p.path}>
                  <button
                    type="button"
                    onClick={() => pick(p.path)}
                    title={p.path}
                    className={`flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left ${active ? "bg-accent-soft" : "hover:bg-default-soft"}`}
                  >
                    <Folder size={14} className="shrink-0 text-muted" />
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-sm">{p.name}</div>
                      <div className="font-code truncate text-[10px] text-muted">{p.path}</div>
                    </div>
                    <span className="shrink-0 text-[10px] text-muted">
                      {p.sessionCount > 0 ? `${p.sessionCount} chats · ${relativeTime(p.lastUsed)}` : "new"}
                    </span>
                    {active && <Check size={14} className="shrink-0 text-accent" />}
                  </button>
                </li>
              );
            })}
            {shown.length === 0 && <li className="px-2 py-3 text-center text-xs text-muted">No matching projects.</li>}
          </ul>
          <Button
            size="sm"
            variant="secondary"
            onPress={() => {
              setOpen(false);
              actions.openFolderPicker("cwd", chat.chatId);
            }}
          >
            <FolderOpen size={14} /> Choose another folder…
          </Button>
        </Popover.Dialog>
      </Popover.Content>
    </Popover>
  );
}

const MAIN_MODEL_COUNT = 5;

function ModelMenu({ chat }: { chat: ClaudeChat }) {
  const [open, setOpen] = useState(false);
  const [more, setMore] = useState(false);
  const globalInfo = useApp((s) => s.globalInfo);
  const models = chat.info?.models ?? globalInfo?.models ?? [];
  const current = currentModel(chat, models);
  const efforts = current?.efforts.length ? current.efforts : ALL_EFFORTS;
  const effort = chat.wantEffort ?? chat.effort;
  const label = modelLabel(current, models, chat.model);

  return (
    <Popover
      isOpen={open}
      onOpenChange={(o) => {
        setOpen(o);
        if (o) actions.requestInfo(chat.chatId);
      }}
    >
      <Button size="sm" variant="ghost" className="h-7 gap-1 px-2 text-xs" aria-label="Model and effort">
        {chat.fastMode && <Zap size={12} className="text-warning" />}
        <span className="max-w-32 truncate font-medium">{label}</span>
        {effort && <span className="text-muted">{EFFORT_LABEL[effort]}</span>}
        <ChevronDown size={12} className="text-muted" />
      </Button>
      <Popover.Content placement="top end" className="w-80">
        <Popover.Dialog className="flex flex-col gap-1 p-1">
          {models.length === 0 ? (
            <p className="px-2 py-3 text-xs text-muted">Loading models…</p>
          ) : (
            <ul className="flex max-h-96 flex-col overflow-y-auto">
              {(more ? models : models.filter((m, i) => i < MAIN_MODEL_COUNT || m.value === current?.value)).map((m) => {
                const active = current?.value === m.value;
                return (
                  <li key={m.value}>
                    <button
                      type="button"
                      onClick={() => actions.setModel(chat.chatId, m.value === "default" ? "" : m.value)}
                      className={`flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-left ${active ? "bg-accent-soft" : "hover:bg-default-soft"}`}
                    >
                      <div className="min-w-0 flex-1">
                        <div className="text-sm font-medium">{m.value === "default" ? `Default (${modelLabel(m, models)})` : m.displayName}</div>
                        <div className="line-clamp-1 text-[11px] text-muted">{m.description}</div>
                      </div>
                      {active && <Check size={15} className="shrink-0 text-accent" />}
                    </button>
                  </li>
                );
              })}
              {models.length > MAIN_MODEL_COUNT && (
                <li>
                  <button type="button" onClick={() => setMore(!more)} className="flex w-full items-center gap-1 rounded-lg px-2.5 py-1.5 text-left text-xs text-muted hover:bg-default-soft">
                    <ChevronDown size={13} className={`transition-transform ${more ? "rotate-180" : ""}`} />
                    {more ? "Show less" : `Other models (${models.length - MAIN_MODEL_COUNT})`}
                  </button>
                </li>
              )}
            </ul>
          )}
          <div className="mt-1 border-t border-separator px-2 pt-2">
            <div className="mb-1.5 text-xs font-medium">Effort</div>
            <div className="grid grid-cols-5 gap-1">
              {ALL_EFFORTS.map((e) => {
                const supported = efforts.includes(e);
                return (
                  <button
                    key={e}
                    type="button"
                    disabled={!supported}
                    onClick={() => actions.setEffort(chat.chatId, e)}
                    className={`rounded-md px-1 py-1 text-[11px] transition ${
                      effort === e ? "bg-accent text-accent-foreground" : supported ? "bg-default-soft hover:bg-default-soft-hover" : "cursor-not-allowed opacity-40"
                    }`}
                  >
                    {EFFORT_LABEL[e]}
                  </button>
                );
              })}
            </div>
            <p className="mt-1 text-[10px] text-muted">Higher effort thinks more carefully but is slower and uses more of your usage limit.</p>
          </div>
          {(current?.fastMode ?? false) && (
            <div className="border-t border-separator px-2 py-2">
              <Switch isSelected={!!chat.fastMode} onChange={(on) => actions.setFastMode(chat.chatId, on)}>
                <Switch.Content>
                  <Switch.Control>
                    <Switch.Thumb />
                  </Switch.Control>
                  <span className="flex items-center gap-1 text-sm">
                    <Zap size={13} className="text-warning" /> Fast mode
                  </span>
                </Switch.Content>
              </Switch>
            </div>
          )}
        </Popover.Dialog>
      </Popover.Content>
    </Popover>
  );
}

function ModeMenu({ chat }: { chat: ClaudeChat }) {
  const [open, setOpen] = useState(false);
  const mode = chat.permissionMode ?? chat.wantMode ?? "default";
  const label = MODES.find((m) => m.value === mode)?.label ?? mode;
  return (
    <Popover isOpen={open} onOpenChange={setOpen}>
      <Button size="sm" variant="ghost" className="h-7 gap-1 px-2 text-xs" aria-label="Permission mode">
        <span className="max-w-32 truncate">{label}</span>
        <ChevronDown size={12} className="text-muted" />
      </Button>
      <Popover.Content placement="top end" className="w-72">
        <Popover.Dialog className="p-1">
          <ul className="flex flex-col">
            {MODES.map((m) => (
              <li key={m.value}>
                <button
                  type="button"
                  onClick={() => {
                    actions.setMode(chat.chatId, m.value);
                    setOpen(false);
                  }}
                  className={`flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-left ${mode === m.value ? "bg-accent-soft" : "hover:bg-default-soft"}`}
                >
                  <div className="min-w-0 flex-1">
                    <div className="text-sm">{m.label}</div>
                    <div className="text-[11px] text-muted">{m.hint}</div>
                  </div>
                  {mode === m.value && <Check size={15} className="text-accent" />}
                </button>
              </li>
            ))}
          </ul>
        </Popover.Dialog>
      </Popover.Content>
    </Popover>
  );
}

/** Usage ring: 5-hour limit (or context fullness if unavailable). Hover shows a card, click shows details. */
function UsageRing({ chat }: { chat: ClaudeChat }) {
  const globalUsage = useApp((s) => s.globalInfo?.usage);
  const usage = chat.info?.usage ?? globalUsage;
  const ctx = chat.info?.context;
  const five = pct(usage?.fiveHour);
  const value = five ?? (ctx ? Math.round(ctx.percentage) : null);
  const r = 7;
  const circ = 2 * Math.PI * r;
  const color = value == null ? "var(--muted)" : value > 85 ? "var(--danger)" : value > 65 ? "var(--warning)" : "var(--accent)";

  return (
    <Tooltip delay={150}>
      <Button
        isIconOnly
        size="sm"
        variant="ghost"
        className="h-7 w-7 min-w-7"
        aria-label="Usage"
        onPress={() => {
          actions.requestInfo(chat.chatId);
          actions.focusInfo("usage");
        }}
      >
        <svg width="18" height="18" viewBox="0 0 18 18" aria-hidden>
          <circle cx="9" cy="9" r={r} fill="none" stroke="var(--border)" strokeWidth="2.5" />
          {value != null && (
            <circle
              cx="9"
              cy="9"
              r={r}
              fill="none"
              stroke={color}
              strokeWidth="2.5"
              strokeLinecap="round"
              strokeDasharray={`${(circ * Math.min(100, value)) / 100} ${circ}`}
              transform="rotate(-90 9 9)"
            />
          )}
        </svg>
      </Button>
      <Tooltip.Content className="p-2">
        <UsageCard usage={usage} context={ctx} />
        <p className="mt-2 px-1 text-[10px] text-muted">Click for details</p>
      </Tooltip.Content>
    </Tooltip>
  );
}
