import { Button, Modal } from "@heroui/react";
import { useEffect, useState } from "react";
import type { TeamSettings } from "../protocol";
import { actions, agentMeta, useApp } from "../store";

type Choice<T extends string> = { value: T; label: string };

const CLAUDE_MODELS: Choice<"haiku" | "sonnet" | "opus">[] = [
  { value: "haiku", label: "Haiku" },
  { value: "sonnet", label: "Sonnet" },
  { value: "opus", label: "Opus" },
];
const THINKING: Choice<"low" | "high" | "max">[] = [
  { value: "low", label: "Low" },
  { value: "high", label: "High" },
  { value: "max", label: "Max" },
];

/** One setting: its name, the default, the choices as buttons, and Reset when it differs from the default */
function Row<T extends string>(props: { name: string; hint?: string; value: T; def: string; choices: Choice<T>[]; onChange: (v: T | undefined) => void }) {
  const { name, hint, value, def, choices, onChange } = props;
  const defLabel = choices.find((c) => c.value === def)?.label ?? def;
  return (
    <div className="flex flex-col gap-1.5 rounded-lg border border-separator p-2.5">
      <div className="flex items-baseline justify-between gap-2">
        <div className="min-w-0">
          <p className="text-sm font-medium">{name}</p>
          {hint && <p className="text-xs text-muted">{hint}</p>}
        </div>
        <span className="shrink-0 text-xs text-muted">
          default: {defLabel}
          {value !== def && (
            <button type="button" className="ml-2 text-accent hover:underline" onClick={() => onChange(undefined)}>
              Reset
            </button>
          )}
        </span>
      </div>
      <div className="grid gap-1.5" style={{ gridTemplateColumns: `repeat(${choices.length}, minmax(0, 1fr))` }}>
        {choices.map((c) => (
          <Button key={c.value} size="sm" variant={value === c.value ? "primary" : "secondary"} onPress={() => onChange(c.value === def ? undefined : c.value)}>
            {c.label}
          </Button>
        ))}
      </div>
    </div>
  );
}

/** Settings → Team models: which model each specialist and the builder run on */
export function TeamModelsModal() {
  const { open, settings, defaults } = useApp((s) => s.team);
  const workers = useApp((s) => s.workers);
  const [form, setForm] = useState<TeamSettings>({ models: {}, builder: {} });

  useEffect(() => {
    if (open && settings) setForm({ models: { ...settings.models }, builder: { ...settings.builder } });
  }, [open, settings]);

  // The builder runs on a DeepSeek worker without a role of its own (not the QA reviewer)
  const builders = workers.filter((w) => w.provider === "deepseek" && !w.system?.trim()).map((w) => ({ value: w.id, label: w.name }));
  const specialists = Object.keys(defaults?.models ?? {}).filter((id) => workers.some((w) => w.id === id));
  const setModel = (id: string, v?: "haiku" | "sonnet" | "opus") =>
    setForm((f) => {
      const models = { ...f.models };
      if (v) models[id] = v;
      else delete models[id];
      return { ...f, models };
    });
  const setBuilder = (patch: Partial<TeamSettings["builder"]>) => setForm((f) => ({ ...f, builder: { ...f.builder, ...patch } }));

  return (
    <Modal.Backdrop isOpen={open} onOpenChange={(o) => !o && actions.closeTeamModels()}>
      <Modal.Container size="md">
        <Modal.Dialog>
          <Modal.Header>
            <Modal.Heading>Team models</Modal.Heading>
          </Modal.Header>
          <Modal.Body className="flex flex-col gap-4">
            <p className="text-xs text-muted">Which model each helper runs on. Changes apply to new chats and builds; chats that are already open keep their models.</p>
            {!defaults ? (
              <p className="text-sm text-muted">Loading…</p>
            ) : (
              <>
                <section className="flex flex-col gap-2">
                  <p className="text-xs font-semibold uppercase tracking-wide text-muted">Builder (DeepSeek)</p>
                  <Row
                    name="Model"
                    hint="Pro is stronger, Flash is cheaper"
                    value={form.builder.worker ?? defaults.builder.worker}
                    def={defaults.builder.worker}
                    choices={builders}
                    onChange={(worker) => setBuilder({ worker })}
                  />
                  <Row
                    name="Thinking"
                    hint="More thinking is slower and costs more"
                    value={form.builder.thinking ?? defaults.builder.thinking}
                    def={defaults.builder.thinking}
                    choices={THINKING}
                    onChange={(thinking) => setBuilder({ thinking })}
                  />
                </section>
                <section className="flex flex-col gap-2">
                  <p className="text-xs font-semibold uppercase tracking-wide text-muted">Specialists (Claude)</p>
                  {specialists.map((id) => (
                    <Row
                      key={id}
                      name={agentMeta(id, workers).name}
                      value={form.models[id] ?? defaults.models[id]}
                      def={defaults.models[id]}
                      choices={CLAUDE_MODELS}
                      onChange={(v) => setModel(id, v)}
                    />
                  ))}
                </section>
              </>
            )}
          </Modal.Body>
          <Modal.Footer className="flex items-center gap-2">
            <span className="flex-1" />
            <Button size="sm" variant="secondary" onPress={() => actions.closeTeamModels()}>
              Cancel
            </Button>
            <Button
              size="sm"
              variant="primary"
              isDisabled={!defaults}
              onPress={() => {
                actions.saveTeamSettings(form);
                actions.closeTeamModels();
              }}
            >
              Save
            </Button>
          </Modal.Footer>
        </Modal.Dialog>
      </Modal.Container>
    </Modal.Backdrop>
  );
}
