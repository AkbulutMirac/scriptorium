import { Button, Chip, Input, Label, Popover, Switch, TextField, Tooltip } from "@heroui/react";
import { BookOpen, Gauge, Monitor, Moon, PanelLeft, Power, Settings, Sun } from "lucide-react";
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
      <DeepSeekBalanceChip />
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

          <div className="flex flex-col gap-2 border-t border-separator pt-3">
            <Button size="sm" variant="danger-soft" onPress={() => actions.shutdownServer()}>
              <Power size={14} /> Scriptorium'u kapat
            </Button>
            <p className="text-xs text-muted">Arka planda çalışan sunucuyu kapatır. Açık Claude oturumları da kapanır. Tekrar açmak için masaüstü kısayolu.</p>
          </div>
        </Popover.Dialog>
      </Popover.Content>
    </Popover>
  );
}

/** Claude aboneliğinin kullanım limitleri (ana sohbetin bilgisinden). Üzerine gelince kart, tıklayınca ayrıntı. */
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
        aria-label="Kullanım limitleri"
      >
        <Gauge size={14} />
        {five != null && <span>5s %{five}</span>}
        {week != null && <span>· Haftalık %{week}</span>}
      </button>
      <Tooltip.Content placement="bottom end" className="p-2">
        <UsageCard usage={usage} />
      </Tooltip.Content>
    </Tooltip>
  );
}
