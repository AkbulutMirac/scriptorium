import { Button, Popover, Switch, Tooltip } from "@heroui/react";
import { Brain, Check, ChevronDown, FileJson, Paperclip, Plus, ScrollText, SlidersHorizontal } from "lucide-react";
import { useState } from "react";
import type { ReasoningLevel, TokenUsage, WorkerInfo } from "../../protocol";
import { actions, useApp } from "../../store";

const REASONING: { value: ReasoningLevel | ""; label: string; hint: string }[] = [
  { value: "", label: "Default", hint: "The model's own setting" },
  { value: "none", label: "Off", hint: "Answers right away without thinking (fast, cheap)" },
  { value: "low", label: "Low", hint: "Thinks briefly" },
  { value: "medium", label: "Medium", hint: "Same as High on DeepSeek" },
  { value: "high", label: "High", hint: "Thinks carefully" },
  { value: "max", label: "Max", hint: "Longest thinking, slowest and most expensive" },
];

const fmt = (n?: number) => (n === undefined ? "–" : n >= 1000 ? `${(n / 1000).toFixed(1)}K` : String(n));

/** Token usage: "↑1.2K ↓340 · cache 60 · thinking 120" */
export function usageText(u?: TokenUsage): string {
  if (!u) return "";
  const parts = [`↑${fmt(u.prompt)} ↓${fmt(u.completion)}`];
  if (u.cacheHit && u.prompt) parts.push(`cache ${Math.round((u.cacheHit / u.prompt) * 100)}%`);
  if (u.reasoning) parts.push(`thinking ${fmt(u.reasoning)}`);
  return parts.join(" · ");
}

/** The "+" menu to the left of the worker's input box */
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
      <Button isIconOnly size="sm" variant="ghost" aria-label="Add and settings">
        <Plus size={18} />
      </Button>
      <Popover.Content placement="top start" className="w-80">
        <Popover.Dialog className="p-1">
          {view === "main" ? (
            <ul className="flex flex-col">
              <MenuButton
                icon={<Paperclip size={15} />}
                label="Add file or photo"
                hint={worker.provider === "deepseek" ? "Image, PDF, text" : "Image, text"}
                onPress={() => {
                  setOpen(false);
                  onPickFiles();
                }}
              />
              <MenuButton
                icon={<ScrollText size={15} />}
                label="System instruction"
                hint={settings.system ? "on" : undefined}
                onPress={() => setView("system")}
              />
              <li className="flex items-center gap-2.5 rounded-lg px-2.5 py-2 text-sm">
                <FileJson size={15} className="text-muted" />
                <span className="flex-1">JSON output</span>
                <Switch size="sm" isSelected={!!settings.json} onChange={(json) => actions.setWorkerSettings(worker.id, { json })} aria-label="JSON output">
                  <Switch.Control>
                    <Switch.Thumb />
                  </Switch.Control>
                </Switch>
              </li>
            </ul>
          ) : (
            <div className="flex flex-col gap-2 p-1">
              <span className="text-sm font-semibold">System instruction</span>
              <p className="text-xs text-muted">Added to the start of every chat with this worker. E.g.: "Answer briefly and in Turkish."</p>
              <textarea
                autoFocus
                value={system}
                onChange={(e) => setSystem(e.target.value)}
                rows={5}
                className="resize-none rounded-lg border border-field-border bg-field px-2.5 py-2 text-sm outline-none focus:border-accent"
              />
              <div className="flex justify-end gap-2">
                <Button size="sm" variant="ghost" onPress={() => setView("main")}>
                  Back
                </Button>
                <Button
                  size="sm"
                  variant="primary"
                  onPress={() => {
                    actions.setWorkerSettings(worker.id, { system: system.trim() || undefined });
                    setOpen(false);
                  }}
                >
                  Save
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

/** The bar below the worker's input box: model, thinking, settings, last token usage */
export function WorkerFooter({ worker, lastUsage }: { worker: WorkerInfo; lastUsage?: TokenUsage }) {
  const settings = useApp((s) => s.workerSettings[worker.id]) ?? {};
  const models = useApp((s) => s.workerModels[worker.id]);
  const [modelOpen, setModelOpen] = useState(false);
  const [reasonOpen, setReasonOpen] = useState(false);
  // Ollama recognizes the same model both as "name" and "name:latest"
  const norm = (m: string) => m.replace(/:latest$/, "");
  const model = norm(settings.model || worker.model);
  const defaultModel = norm(worker.model);
  const shortModel = model.split("/").pop()?.replace(/^hf\.co\//, "") ?? model;
  // For local workers, thinking is off if not selected (the server sends it that way too)
  const effective = settings.reasoning ?? (worker.local ? "none" : "");
  const reasoning = REASONING.find((r) => r.value === effective) ?? REASONING[0];
  const thinkingOff = effective === "none";

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
              <p className="px-2 py-3 text-xs text-muted">Loading…</p>
            ) : models.length === 0 ? (
              <p className="px-2 py-3 text-xs text-muted">{worker.provider === "ollama" ? "Ollama is not running or no models are installed." : "No models found."}</p>
            ) : (
              <ul className="flex max-h-72 flex-col overflow-y-auto">
                {models.map((m) => (
                  <li key={m.id}>
                    <button
                      type="button"
                      onClick={() => {
                        actions.setWorkerSettings(worker.id, { model: m.id === defaultModel ? undefined : m.id });
                        setModelOpen(false);
                      }}
                      title={m.id}
                      className={`flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-left ${m.id === model ? "bg-accent-soft" : "hover:bg-default-soft"}`}
                    >
                      <div className="min-w-0 flex-1">
                        <div className="font-code truncate text-xs">{m.id}</div>
                        {worker.provider === "ollama" && (
                          <div className="text-[10px] text-muted">
                            {[m.size, m.vision ? "also reads images, slower" : "text only, faster"].filter(Boolean).join(" · ")}
                          </div>
                        )}
                      </div>
                      {m.id === defaultModel && <span className="text-[10px] text-muted">default</span>}
                      {m.id === model && <Check size={14} className="text-accent" />}
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </Popover.Dialog>
        </Popover.Content>
      </Popover>

      {/* Thinking */}
      <Popover isOpen={reasonOpen} onOpenChange={setReasonOpen}>
        <Button size="sm" variant="ghost" className="h-7 gap-1 px-2 text-xs" aria-label="Thinking">
          <Brain size={13} className={thinkingOff ? "text-muted" : "text-accent"} />
          <span>{reasoning.value ? `Thinking: ${reasoning.label}` : "Thinking"}</span>
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

      {/* Other settings */}
      <SettingsMenu worker={worker} thinkingOff={thinkingOff} />

      <span className="flex-1" />
      <ContextRing usage={lastUsage} />
      {lastUsage && (
        <Tooltip delay={200}>
          <button type="button" className="cursor-default truncate rounded px-1 text-[11px] tabular-nums text-muted hover:bg-default-soft">
            {usageText(lastUsage)}
          </button>
          <Tooltip.Content>
            <div className="flex flex-col text-xs">
              <span className="font-medium">Token usage of the last reply</span>
              <span>Input: {lastUsage.prompt.toLocaleString("en-US")}{lastUsage.cacheHit ? ` (from cache ${lastUsage.cacheHit.toLocaleString("en-US")})` : ""}</span>
              <span>Output: {lastUsage.completion.toLocaleString("en-US")}{lastUsage.reasoning ? ` (thinking ${lastUsage.reasoning.toLocaleString("en-US")})` : ""}</span>
            </div>
          </Tooltip.Content>
        </Tooltip>
      )}
    </div>
  );
}

/** Context usage ring: input + output of the last reply, relative to the model's context limit */
function ContextRing({ usage }: { usage?: TokenUsage }) {
  if (!usage?.contextWindow) return null;
  const used = usage.prompt + usage.completion;
  const pct = Math.min(100, (used / usage.contextWindow) * 100);
  const r = 6;
  const circ = 2 * Math.PI * r;
  const color = pct > 85 ? "var(--danger)" : pct > 65 ? "var(--warning)" : "var(--accent)";
  return (
    <Tooltip delay={150}>
      <button type="button" className="flex cursor-default items-center gap-1 rounded px-1 text-[11px] tabular-nums text-muted hover:bg-default-soft" aria-label="Context usage">
        <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden>
          <circle cx="8" cy="8" r={r} fill="none" stroke="var(--border)" strokeWidth="2.5" />
          <circle
            cx="8"
            cy="8"
            r={r}
            fill="none"
            stroke={color}
            strokeWidth="2.5"
            strokeLinecap="round"
            strokeDasharray={`${(circ * Math.max(pct, 1)) / 100} ${circ}`}
            transform="rotate(-90 8 8)"
          />
        </svg>
        {pct < 1 ? "<1" : Math.round(pct)}%
      </button>
      <Tooltip.Content>
        <div className="flex flex-col text-xs">
          <span className="font-medium">Context</span>
          <span>
            {used.toLocaleString("en-US")} / {usage.contextWindow.toLocaleString("en-US")} token
          </span>
          <span className="text-muted">Fills up as the chat grows; once full, the model forgets older messages.</span>
        </div>
      </Tooltip.Content>
    </Tooltip>
  );
}

function SettingsMenu({ worker, thinkingOff }: { worker: WorkerInfo; thinkingOff: boolean }) {
  const settings = useApp((s) => s.workerSettings[worker.id]) ?? {};
  const [open, setOpen] = useState(false);
  const temp = settings.temperature;
  const active = temp !== undefined || settings.maxTokens !== undefined || settings.json || !!settings.system;

  return (
    <Popover isOpen={open} onOpenChange={setOpen}>
      <Button isIconOnly size="sm" variant="ghost" className={`h-7 w-7 min-w-7 ${active ? "text-accent" : ""}`} aria-label="Settings">
        <SlidersHorizontal size={14} />
      </Button>
      <Popover.Content placement="top start" className="w-72">
        <Popover.Dialog className="flex flex-col gap-3 p-2">
          <div className="flex flex-col gap-1.5">
            <div className="flex items-baseline justify-between text-xs">
              <span className="font-medium">Temperature</span>
              <span className="tabular-nums text-muted">{temp === undefined ? "default" : temp.toFixed(1)}</span>
            </div>
            <input
              type="range"
              min={0}
              max={2}
              step={0.1}
              value={temp ?? 1}
              onChange={(e) => actions.setWorkerSettings(worker.id, { temperature: Number(e.target.value) })}
              className="accent-[var(--accent)]"
              aria-label="Temperature"
            />
            <p className="text-[10px] text-muted">
              Low: consistent, high: creative.{" "}
              {!thinkingOff && worker.provider === "deepseek" && "On DeepSeek it only takes effect when thinking is off."}
            </p>
          </div>
          <label className="flex items-center justify-between gap-2 text-xs">
            <span className="font-medium">Max tokens</span>
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
            <span className="font-medium">JSON output</span>
            <Switch size="sm" isSelected={!!settings.json} onChange={(json) => actions.setWorkerSettings(worker.id, { json })} aria-label="JSON output">
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
            Reset to default
          </Button>
        </Popover.Dialog>
      </Popover.Content>
    </Popover>
  );
}
