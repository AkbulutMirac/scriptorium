import { Button, Chip, Input, Label, Popover, Switch, TextField, Tooltip } from "@heroui/react";
import { BookOpen, Gauge, Monitor, Moon, PanelLeft, Settings, Sun } from "lucide-react";
import { useState } from "react";
import { ACCENTS, useTheme, type AccentName, type ThemeMode } from "../lib/theme";
import { pct, resetText } from "./chat/ClaudeFooter";
import { actions, useApp } from "../store";

export function TopBar() {
  const connection = useApp((s) => s.connection);
  const historyOpen = useApp((s) => s.ui.historyOpen);
  const runningJobs = useApp((s) => s.jobs.filter((j) => j.status === "running" || j.status === "queued").length);

  return (
    <header className="flex h-11 shrink-0 items-center gap-2 border-b border-separator bg-surface px-2">
      <Tooltip delay={400}>
        <Button
          isIconOnly
          size="sm"
          variant="ghost"
          aria-label={historyOpen ? "Geçmişi gizle" : "Geçmişi göster"}
          onPress={() => actions.setUi({ historyOpen: !historyOpen })}
        >
          <PanelLeft size={18} />
        </Button>
        <Tooltip.Content>{historyOpen ? "Geçmişi gizle" : "Geçmişi göster"}</Tooltip.Content>
      </Tooltip>

      <div className="flex items-center gap-2 font-semibold tracking-tight">
        <BookOpen size={18} className="text-accent" />
        Scriptorium
      </div>

      <div className="flex-1" />

      {runningJobs > 0 && (
        <Chip size="sm" variant="soft" color="accent">
          {runningJobs} arka plan işi
        </Chip>
      )}
      <UsageChip />
      <ConnectionDot status={connection} />
      <SettingsPopover />
    </header>
  );
}

function ConnectionDot({ status }: { status: string }) {
  const map = {
    open: { color: "bg-success", text: "Bağlı" },
    connecting: { color: "bg-warning", text: "Bağlanıyor…" },
    closed: { color: "bg-danger", text: "Bağlantı yok, yeniden deneniyor" },
  } as const;
  const m = map[status as keyof typeof map] ?? map.closed;
  return (
    <span className="flex items-center gap-1.5 px-2 text-xs text-muted">
      <span className={`size-2 rounded-full ${m.color}`} />
      {m.text}
    </span>
  );
}

const MODES: { id: ThemeMode; label: string; icon: React.ReactNode }[] = [
  { id: "light", label: "Açık", icon: <Sun size={15} /> },
  { id: "dark", label: "Koyu", icon: <Moon size={15} /> },
  { id: "system", label: "Sistem", icon: <Monitor size={15} /> },
];

function SettingsPopover() {
  const { mode, accent, pixel, setMode, setAccent, setPixel } = useTheme();
  const cwd = useApp((s) => s.cwd);
  const serverCwd = useApp((s) => s.serverCwd);
  const [draft, setDraft] = useState(cwd);

  return (
    <Popover onOpenChange={(open) => open && setDraft(cwd)}>
      <Button isIconOnly size="sm" variant="ghost" aria-label="Ayarlar">
        <Settings size={18} />
      </Button>
      <Popover.Content placement="bottom end" className="w-80">
        <Popover.Dialog className="flex flex-col gap-4 p-1">
          <Popover.Heading className="text-sm font-semibold">Görünüm</Popover.Heading>

          <div className="flex flex-col gap-2">
            <span className="text-xs text-muted">Mod</span>
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
            <span className="text-xs text-muted">Vurgu rengi</span>
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
              <span className="text-sm">Piksel görünüm (3D sahne)</span>
            </Switch.Content>
          </Switch>

          <div className="flex flex-col gap-2 border-t border-separator pt-3">
            <TextField value={draft} onChange={setDraft} fullWidth>
              <Label>Claude'un çalışma klasörü</Label>
              <Input variant="secondary" placeholder={serverCwd} className="font-code text-xs" />
            </TextField>
            <p className="text-xs text-muted">Yeni sohbetler bu klasörde açılır. Boş bırakırsan .env'deki varsayılan kullanılır.</p>
            <Button size="sm" variant="secondary" isDisabled={draft === cwd} onPress={() => actions.setCwd(draft.trim())}>
              Kaydet
            </Button>
          </div>
        </Popover.Dialog>
      </Popover.Content>
    </Popover>
  );
}

/** Claude aboneliğinin kullanım limitleri (ana sohbetin bilgisinden) */
function UsageChip() {
  const usage = useApp((s) => s.chats[s.mainChatId ?? ""]?.info?.usage);
  if (!usage?.available) return null;
  const five = pct(usage.fiveHour);
  const week = pct(usage.sevenDay);
  if (five == null && week == null) return null;
  const tone = Math.max(five ?? 0, week ?? 0) > 85 ? "text-danger" : Math.max(five ?? 0, week ?? 0) > 65 ? "text-warning" : "text-muted";
  return (
    <Tooltip delay={200}>
      <button type="button" className={`flex items-center gap-1.5 rounded-md px-2 py-1 text-xs hover:bg-default-soft ${tone}`} aria-label="Kullanım limitleri">
        <Gauge size={14} />
        {five != null && <span>5s %{five}</span>}
        {week != null && <span>· 7g %{week}</span>}
      </button>
      <Tooltip.Content>
        <div className="flex flex-col gap-0.5 text-xs">
          <span className="font-medium">Claude kullanım limitleri{usage.subscription ? ` (${usage.subscription})` : ""}</span>
          {five != null && <span>5 saatlik: %{five} {resetText(usage.fiveHour) && `· ${resetText(usage.fiveHour)}`}</span>}
          {week != null && <span>7 günlük: %{week} {resetText(usage.sevenDay) && `· ${resetText(usage.sevenDay)}`}</span>}
          {pct(usage.sevenDayOpus) != null && <span>7 günlük Opus: %{pct(usage.sevenDayOpus)}</span>}
          {pct(usage.sevenDaySonnet) != null && <span>7 günlük Sonnet: %{pct(usage.sevenDaySonnet)}</span>}
        </div>
      </Tooltip.Content>
    </Tooltip>
  );
}
