import { Button, Popover, Switch, Tooltip } from "@heroui/react";
import { Brain, Check, ChevronDown, FileJson, Paperclip, Plus, ScrollText, SlidersHorizontal } from "lucide-react";
import { useState } from "react";
import type { ReasoningLevel, TokenUsage, WorkerInfo } from "../../protocol";
import { actions, useApp } from "../../store";

const REASONING: { value: ReasoningLevel | ""; label: string; hint: string }[] = [
  { value: "", label: "Varsayılan", hint: "Modelin kendi ayarı" },
  { value: "none", label: "Kapalı", hint: "Düşünmeden hemen cevap verir (hızlı, ucuz)" },
  { value: "low", label: "Düşük", hint: "Kısa düşünür" },
  { value: "medium", label: "Orta", hint: "DeepSeek'te Yüksek ile aynı" },
  { value: "high", label: "Yüksek", hint: "Dikkatli düşünür" },
  { value: "max", label: "Maks", hint: "En uzun düşünme, en yavaş ve pahalı" },
];

const fmt = (n?: number) => (n === undefined ? "–" : n >= 1000 ? `${(n / 1000).toFixed(1)}K` : String(n));

/** Token kullanımı: "↑1,2K ↓340 · önbellek %60 · düşünme 120" */
export function usageText(u?: TokenUsage): string {
  if (!u) return "";
  const parts = [`↑${fmt(u.prompt)} ↓${fmt(u.completion)}`];
  if (u.cacheHit && u.prompt) parts.push(`önbellek %${Math.round((u.cacheHit / u.prompt) * 100)}`);
  if (u.reasoning) parts.push(`düşünme ${fmt(u.reasoning)}`);
  return parts.join(" · ");
}

/** İşçi yazma kutusunun solundaki "+" menüsü */
export function WorkerPlusMenu({ worker, onPickFiles }: { worker: WorkerInfo; onPickFiles: () => void }) {
  const settings = useApp((s) => s.workerSettings[worker.id]) ?? {};
  const [open, setOpen] = useState(false);
  const [system, setSystem] = useState(settings.system ?? "");
  const [view, setView] = useState<"main" | "system">("main");

  return (
    <Popover
      isOpen={open}
      onOpenChange={(o) => {
        setOpen(o);
        if (o) {
          setView("main");
          setSystem(settings.system ?? "");
        }
      }}
    >
      <Button isIconOnly size="sm" variant="ghost" aria-label="Ekle ve ayarlar">
        <Plus size={18} />
      </Button>
      <Popover.Content placement="top start" className="w-80">
        <Popover.Dialog className="p-1">
          {view === "main" ? (
            <ul className="flex flex-col">
              <MenuButton
                icon={<Paperclip size={15} />}
                label="Dosya veya fotoğraf ekle"
                hint={worker.provider === "deepseek" ? "Görsel, PDF, metin" : "Görsel, metin"}
                onPress={() => {
                  setOpen(false);
                  onPickFiles();
                }}
              />
              <MenuButton
                icon={<ScrollText size={15} />}
                label="Sistem talimatı"
                hint={settings.system ? "açık" : undefined}
                onPress={() => setView("system")}
              />
              <li className="flex items-center gap-2.5 rounded-lg px-2.5 py-2 text-sm">
                <FileJson size={15} className="text-muted" />
                <span className="flex-1">JSON çıktı</span>
                <Switch size="sm" isSelected={!!settings.json} onChange={(json) => actions.setWorkerSettings(worker.id, { json })} aria-label="JSON çıktı">
                  <Switch.Control>
                    <Switch.Thumb />
                  </Switch.Control>
                </Switch>
              </li>
            </ul>
          ) : (
            <div className="flex flex-col gap-2 p-1">
              <span className="text-sm font-semibold">Sistem talimatı</span>
              <p className="text-xs text-muted">Bu işçiyle her sohbetin başına eklenir. Örn: "Kısa ve Türkçe cevap ver."</p>
              <textarea
                autoFocus
                value={system}
                onChange={(e) => setSystem(e.target.value)}
                rows={5}
                className="resize-none rounded-lg border border-field-border bg-field px-2.5 py-2 text-sm outline-none focus:border-accent"
              />
              <div className="flex justify-end gap-2">
                <Button size="sm" variant="ghost" onPress={() => setView("main")}>
                  Geri
                </Button>
                <Button
                  size="sm"
                  variant="primary"
                  onPress={() => {
                    actions.setWorkerSettings(worker.id, { system: system.trim() || undefined });
                    setOpen(false);
                  }}
                >
                  Kaydet
                </Button>
              </div>
            </div>
          )}
        </Popover.Dialog>
      </Popover.Content>
    </Popover>
  );
}

function MenuButton({ icon, label, hint, onPress }: { icon: React.ReactNode; label: string; hint?: string; onPress: () => void }) {
  return (
    <li>
      <button type="button" onClick={onPress} className="flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left text-sm hover:bg-default-soft">
        <span className="text-muted">{icon}</span>
        <span className="flex-1">{label}</span>
        {hint && <span className="text-[11px] text-muted">{hint}</span>}
      </button>
    </li>
  );
}

/** İşçi yazma kutusunun altındaki çubuk: model, düşünme, ayarlar, son token kullanımı */
export function WorkerFooter({ worker, lastUsage }: { worker: WorkerInfo; lastUsage?: TokenUsage }) {
  const settings = useApp((s) => s.workerSettings[worker.id]) ?? {};
  const models = useApp((s) => s.workerModels[worker.id]);
  const [modelOpen, setModelOpen] = useState(false);
  const [reasonOpen, setReasonOpen] = useState(false);
  const model = settings.model || worker.model;
  const shortModel = model.split("/").pop()?.replace(/^hf\.co\//, "") ?? model;
  const reasoning = REASONING.find((r) => r.value === (settings.reasoning ?? "")) ?? REASONING[0];
  const thinkingOff = settings.reasoning === "none";

  return (
    <div className="mt-1.5 flex min-w-0 items-center gap-1 text-xs">
      {/* Model */}
      <Popover
        isOpen={modelOpen}
        onOpenChange={(o) => {
          setModelOpen(o);
          if (o) actions.loadWorkerModels(worker.id);
        }}
      >
        <Button size="sm" variant="ghost" className="h-7 min-w-0 gap-1 px-2 text-xs" aria-label="Model">
          <span className="font-code max-w-44 truncate">{shortModel}</span>
          <ChevronDown size={12} className="shrink-0 text-muted" />
        </Button>
        <Popover.Content placement="top start" className="w-80">
          <Popover.Dialog className="p-1">
            {!models ? (
              <p className="px-2 py-3 text-xs text-muted">Yükleniyor…</p>
            ) : models.length === 0 ? (
              <p className="px-2 py-3 text-xs text-muted">{worker.provider === "ollama" ? "Ollama çalışmıyor ya da kurulu model yok." : "Model bulunamadı."}</p>
            ) : (
              <ul className="flex max-h-72 flex-col overflow-y-auto">
                {models.map((m) => (
                  <li key={m}>
                    <button
                      type="button"
                      onClick={() => {
                        actions.setWorkerSettings(worker.id, { model: m === worker.model ? undefined : m });
                        setModelOpen(false);
                      }}
                      className={`flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-left ${m === model ? "bg-accent-soft" : "hover:bg-default-soft"}`}
                    >
                      <span className="font-code min-w-0 flex-1 truncate text-xs">{m}</span>
                      {m === worker.model && <span className="text-[10px] text-muted">varsayılan</span>}
                      {m === model && <Check size={14} className="text-accent" />}
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </Popover.Dialog>
        </Popover.Content>
      </Popover>

      {/* Düşünme */}
      <Popover isOpen={reasonOpen} onOpenChange={setReasonOpen}>
        <Button size="sm" variant="ghost" className="h-7 gap-1 px-2 text-xs" aria-label="Düşünme">
          <Brain size={13} className={thinkingOff ? "text-muted" : "text-accent"} />
          <span>{reasoning.value ? `Düşünme: ${reasoning.label}` : "Düşünme"}</span>
          <ChevronDown size={12} className="text-muted" />
        </Button>
        <Popover.Content placement="top start" className="w-72">
          <Popover.Dialog className="p-1">
            <ul className="flex flex-col">
              {REASONING.map((r) => (
                <li key={r.value || "default"}>
                  <button
                    type="button"
                    onClick={() => {
                      actions.setWorkerSettings(worker.id, { reasoning: r.value || undefined });
                      setReasonOpen(false);
                    }}
                    className={`flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-left ${reasoning.value === r.value ? "bg-accent-soft" : "hover:bg-default-soft"}`}
                  >
                    <div className="min-w-0 flex-1">
                      <div className="text-sm">{r.label}</div>
                      <div className="text-[11px] text-muted">{r.hint}</div>
                    </div>
                    {reasoning.value === r.value && <Check size={14} className="text-accent" />}
                  </button>
                </li>
              ))}
            </ul>
          </Popover.Dialog>
        </Popover.Content>
      </Popover>

      {/* Diğer ayarlar */}
      <SettingsMenu worker={worker} thinkingOff={thinkingOff} />

      <span className="flex-1" />
      {lastUsage && (
        <Tooltip delay={200}>
          <span className="truncate text-[11px] tabular-nums text-muted">{usageText(lastUsage)}</span>
          <Tooltip.Content>
            <div className="flex flex-col text-xs">
              <span className="font-medium">Son cevabın token kullanımı</span>
              <span>Girdi: {lastUsage.prompt.toLocaleString("tr-TR")}{lastUsage.cacheHit ? ` (önbellekten ${lastUsage.cacheHit.toLocaleString("tr-TR")})` : ""}</span>
              <span>Çıktı: {lastUsage.completion.toLocaleString("tr-TR")}{lastUsage.reasoning ? ` (düşünme ${lastUsage.reasoning.toLocaleString("tr-TR")})` : ""}</span>
            </div>
          </Tooltip.Content>
        </Tooltip>
      )}
    </div>
  );
}

function SettingsMenu({ worker, thinkingOff }: { worker: WorkerInfo; thinkingOff: boolean }) {
  const settings = useApp((s) => s.workerSettings[worker.id]) ?? {};
  const [open, setOpen] = useState(false);
  const temp = settings.temperature;
  const active = temp !== undefined || settings.maxTokens !== undefined || settings.json || !!settings.system;

  return (
    <Popover isOpen={open} onOpenChange={setOpen}>
      <Button isIconOnly size="sm" variant="ghost" className={`h-7 w-7 min-w-7 ${active ? "text-accent" : ""}`} aria-label="Ayarlar">
        <SlidersHorizontal size={14} />
      </Button>
      <Popover.Content placement="top start" className="w-72">
        <Popover.Dialog className="flex flex-col gap-3 p-2">
          <div className="flex flex-col gap-1.5">
            <div className="flex items-baseline justify-between text-xs">
              <span className="font-medium">Sıcaklık</span>
              <span className="tabular-nums text-muted">{temp === undefined ? "varsayılan" : temp.toFixed(1)}</span>
            </div>
            <input
              type="range"
              min={0}
              max={2}
              step={0.1}
              value={temp ?? 1}
              onChange={(e) => actions.setWorkerSettings(worker.id, { temperature: Number(e.target.value) })}
              className="accent-[var(--accent)]"
              aria-label="Sıcaklık"
            />
            <p className="text-[10px] text-muted">
              Düşük: tutarlı, yüksek: yaratıcı.{" "}
              {!thinkingOff && worker.provider === "deepseek" && "DeepSeek'te sadece düşünme kapalıyken etkili."}
            </p>
          </div>
          <label className="flex items-center justify-between gap-2 text-xs">
            <span className="font-medium">En fazla token</span>
            <input
              type="number"
              min={1}
              step={500}
              value={settings.maxTokens ?? ""}
              placeholder="4000"
              onChange={(e) => actions.setWorkerSettings(worker.id, { maxTokens: e.target.value ? Number(e.target.value) : undefined })}
              className="w-24 rounded-md border border-field-border bg-field px-2 py-1 text-right text-xs outline-none focus:border-accent"
            />
          </label>
          <label className="flex items-center justify-between gap-2 text-xs">
            <span className="font-medium">JSON çıktı</span>
            <Switch size="sm" isSelected={!!settings.json} onChange={(json) => actions.setWorkerSettings(worker.id, { json })} aria-label="JSON çıktı">
              <Switch.Control>
                <Switch.Thumb />
              </Switch.Control>
            </Switch>
          </label>
          <Button
            size="sm"
            variant="ghost"
            onPress={() => actions.setWorkerSettings(worker.id, { temperature: undefined, maxTokens: undefined, json: undefined })}
          >
            Varsayılana dön
          </Button>
        </Popover.Dialog>
      </Popover.Content>
    </Popover>
  );
}
