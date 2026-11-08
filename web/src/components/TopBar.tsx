import { Button, Chip, Input, Label, Popover, Switch, TextField, Tooltip } from "@heroui/react";
import { BookOpen, Gauge, Monitor, Moon, PanelLeft, Power, Settings, Sun, X } from "lucide-react";
import { useState } from "react";
import { ACCENTS, useTheme, type AccentName, type ThemeMode } from "../lib/theme";
import { pct, UsageCard } from "./chat/UsageCard";
import { DeepSeekBalanceChip } from "./DeepSeekBalance";
import { actions, useApp } from "../store";

export function TopBar() {
  const connection = useApp((s) => s.connection);
  const historyOpen = useApp((s) => s.ui.historyOpen);
  const runningJobs = useApp((s) => s.jobs.filter((j) => j.status === "running" || j.status === "queued").length);

  return (
    <header className="flex h-11 shrink-0 items-center gap-1 sm:gap-2 border-b border-separator bg-surface px-2">
      <Tooltip delay={400}>
        <Button
          isIconOnly
          size="sm"
          variant="ghost"
          aria-label={historyOpen ? "Hide history" : "Show history"}
          onPress={() => actions.setUi({ historyOpen: !historyOpen })}
        >
          <PanelLeft size={18} />
        </Button>
        <Tooltip.Content>{historyOpen ? "Hide history" : "Show history"}</Tooltip.Content>
      </Tooltip>

      <div className="flex items-center gap-2 font-semibold tracking-tight">
        <BookOpen size={18} className="text-accent" />
        <span className="hidden min-[400px]:inline">Scriptorium</span>
      </div>

      <div className="flex-1" />

      {runningJobs > 0 && (
        <Chip size="sm" variant="soft" color="accent">
          {runningJobs}<span className="hidden sm:inline"> background jobs</span>
        </Chip>
      )}
      <span className="hidden sm:contents">
        <DeepSeekBalanceChip />
      </span>
      <UsageChip />
      <ConnectionDot status={connection} />
      <SettingsPopover />
    </header>
  );
}

function ConnectionDot({ status }: { status: string }) {
  const map = {
    open: { color: "bg-success", text: "Connected" },
    connecting: { color: "bg-warning", text: "Connecting…" },
    closed: { color: "bg-danger", text: "No connection, retrying" },
  } as const;
  const m = map[status as keyof typeof map] ?? map.closed;
  return (
    <span className="flex items-center gap-1.5 px-2 text-xs text-muted" title={m.text}>
      <span className={`size-2 rounded-full ${m.color}`} />
      <span className="hidden md:inline">{m.text}</span>
    </span>
  );
}

const MODES: { id: ThemeMode; label: string; icon: React.ReactNode }[] = [
  { id: "light", label: "Light", icon: <Sun size={15} /> },
  { id: "dark", label: "Dark", icon: <Moon size={15} /> },
  { id: "system", label: "System", icon: <Monitor size={15} /> },
];

function SettingsPopover() {
  const { mode, accent, pixel, setMode, setAccent, setPixel } = useTheme();
  const cwd = useApp((s) => s.cwd);
  const serverCwd = useApp((s) => s.serverCwd);
  const [draft, setDraft] = useState(cwd);

  return (
    <Popover onOpenChange={(open) => open && setDraft(cwd)}>
      <Button isIconOnly size="sm" variant="ghost" aria-label="Settings">
        <Settings size={18} />
      </Button>
      <Popover.Content placement="bottom end" className="w-80 max-w-[calc(100vw-1rem)]">
        <Popover.Dialog className="flex flex-col gap-4 p-1">
          <div className="flex items-center justify-between">
            <Popover.Heading className="text-sm font-semibold">Appearance</Popover.Heading>
            <Button slot="close" isIconOnly size="sm" variant="ghost" aria-label="Close settings">
              <X size={16} />
            </Button>
          </div>

          <div className="flex flex-col gap-2">
            <span className="text-xs text-muted">Mode</span>
            <div className="grid grid-cols-3 gap-1">
              {MODES.map((m) => (
                <Button key={m.id} size="sm" variant={mode === m.id ? "primary" : "secondary"} onPress={() => setMode(m.id)}>
                  {m.icon}
                  {m.label}
                </Button>
              ))}
            </div>
          </div>

          <div className="flex flex-col gap-2">
            <span className="text-xs text-muted">Accent color</span>
            <div className="flex flex-wrap gap-2">
              {(Object.keys(ACCENTS) as AccentName[]).map((a) => (
                <Tooltip key={a} delay={300}>
                  <button
                    type="button"
                    aria-label={ACCENTS[a].label}
                    onClick={() => setAccent(a)}
                    className={`size-7 rounded-full transition ${accent === a ? "ring-2 ring-offset-2 ring-offset-surface" : "hover:scale-110"}`}
                    style={{ background: ACCENTS[a].hex, ["--tw-ring-color" as string]: ACCENTS[a].hex }}
                  />
                  <Tooltip.Content>{ACCENTS[a].label}</Tooltip.Content>
                </Tooltip>
              ))}
            </div>
          </div>

          <Switch isSelected={pixel} onChange={setPixel}>
            <Switch.Content>
              <Switch.Control>
                <Switch.Thumb />
              </Switch.Control>
              <span className="text-sm">Pixel view (3D scene)</span>
            </Switch.Content>
          </Switch>

          <div className="flex flex-col gap-2 border-t border-separator pt-3">
            <TextField value={draft} onChange={setDraft} fullWidth>
              <Label>Claude's working folder</Label>
              <Input variant="secondary" placeholder={serverCwd} className="font-code text-xs" />
            </TextField>
            <p className="text-xs text-muted">New chats open in this folder. If left empty, the default from .env is used.</p>
            <Button size="sm" variant="secondary" isDisabled={draft === cwd} onPress={() => actions.setCwd(draft.trim())}>
              Save
            </Button>
          </div>

          <div className="flex flex-col gap-2 border-t border-separator pt-3">
            <Button size="sm" variant="secondary" onPress={() => actions.openSetup()}>
              Setup (Claude, DeepSeek, local models)
            </Button>
            <Button size="sm" variant="danger-soft" onPress={() => actions.shutdownServer()}>
              <Power size={14} /> Shut down Scriptorium
            </Button>
            <p className="text-xs text-muted">Shuts down the background server. Open Claude sessions will close too. Use the desktop shortcut to reopen.</p>
          </div>
        </Popover.Dialog>
      </Popover.Content>
    </Popover>
  );
}

/** Claude subscription usage limits (from the main chat's info). Hover shows a card, click shows details. */
function UsageChip() {
  const usage = useApp((s) => s.chats[s.mainChatId ?? ""]?.info?.usage ?? s.globalInfo?.usage);
  if (!usage?.available) return null;
  const five = pct(usage.fiveHour);
  const week = pct(usage.sevenDay);
  if (five == null && week == null) return null;
  const worst = Math.max(five ?? 0, week ?? 0);
  const tone = worst > 85 ? "text-danger" : worst > 65 ? "text-warning" : "text-muted";
  return (
    <Tooltip delay={150}>
      <button
        type="button"
        onClick={() => actions.focusInfo("usage")}
        className={`flex items-center gap-1.5 rounded-md px-2 py-1 text-xs hover:bg-default-soft ${tone}`}
        aria-label="Usage limits"
      >
        <Gauge size={14} />
        {five != null && <span>5h {five}%</span>}
        {week != null && <span className="hidden sm:inline">· Weekly {week}%</span>}
      </button>
      <Tooltip.Content placement="bottom end" className="p-2">
        <UsageCard usage={usage} />
      </Tooltip.Content>
    </Tooltip>
  );
}
