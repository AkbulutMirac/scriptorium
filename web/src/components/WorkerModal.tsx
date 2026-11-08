import { Button, Input, Label, Modal, Switch, TextField } from "@heroui/react";
import { useEffect, useState } from "react";
import type { Provider, WorkerInfo } from "../protocol";
import { actions, useApp } from "../store";

const COLORS = ["#4D6BFE", "#7F77DD", "#22A06B", "#E8A23A", "#E5487A", "#14B8A6", "#64748B", "#A855F7"];

const DEEPSEEK_MODELS = ["deepseek-flash", "deepseek-v4-pro"];

/** Simplifies Turkish characters and generates an id: "Code Master" → "kod-ustasi" */
function slugify(text: string) {
  const map: Record<string, string> = { ç: "c", ğ: "g", ı: "i", ö: "o", ş: "s", ü: "u" };
  return text
    .toLocaleLowerCase("tr")
    .replace(/[çğıöşü]/g, (c) => map[c])
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);
}

const empty = (): WorkerInfo => ({ id: "", name: "", provider: "deepseek", model: "deepseek-flash", color: COLORS[0], description: "", local: false });

/** Worker add and edit window. Claude sees the saved worker immediately. */
export function WorkerModal() {
  const { open, worker } = useApp((s) => s.workerModal);
  const workers = useApp((s) => s.workers);
  // Ollama suggestions: models installed on this computer (from setup status)
  // Selector must return a stable reference (a new array each time causes infinite re-renders)
  const ollamaList = useApp((s) => s.setup.status?.ollama.models);
  const ollamaModels = (ollamaList ?? []).map((m) => m.id);
  const hints: Record<Provider, string[]> = { deepseek: DEEPSEEK_MODELS, ollama: ollamaModels };
  const editing = !!worker;
  const [form, setForm] = useState<WorkerInfo>(empty);
  const [confirmDelete, setConfirmDelete] = useState(false);

  useEffect(() => {
    if (open) {
      setForm(worker ? { ...worker } : empty());
      setConfirmDelete(false);
      actions.loadSetupStatus();
    }
  }, [open, worker]);

  const id = editing ? form.id : slugify(form.name);
  const idTaken = !editing && workers.some((w) => w.id === id);
  const valid = !!form.name.trim() && !!form.model.trim() && !!id && !idTaken;
  const update = (patch: Partial<WorkerInfo>) => setForm((f) => ({ ...f, ...patch }));

  const setProvider = (provider: Provider) =>
    update({ provider, local: provider === "ollama", model: hints[form.provider].includes(form.model) || !form.model ? (hints[provider][0] ?? "") : form.model });

  const save = () => {
    if (!valid) return;
    const { available: _a, ...rest } = form;
    actions.saveWorker({ ...rest, id, name: form.name.trim(), model: form.model.trim(), description: form.description.trim(), system: form.system?.trim() || undefined });
    actions.closeWorkerModal();
  };

  return (
    <Modal.Backdrop isOpen={open} onOpenChange={(o) => !o && actions.closeWorkerModal()}>
      <Modal.Container size="md">
        <Modal.Dialog>
          <Modal.Header>
            <Modal.Heading>{editing ? "Edit worker" : "New worker"}</Modal.Heading>
          </Modal.Header>
          <Modal.Body className="flex flex-col gap-4">
            <TextField value={form.name} onChange={(name) => update({ name })} fullWidth autoFocus>
              <Label>Name</Label>
              <Input variant="secondary" placeholder="Code Master" />
            </TextField>
            {!editing && id && <p className={`-mt-2 text-xs ${idTaken ? "text-danger" : "text-muted"}`}>id: {id}{idTaken && " (this id already exists)"}</p>}

            <div className="flex flex-col gap-1.5">
              <span className="text-sm font-medium">Provider</span>
              <div className="grid grid-cols-2 gap-2">
                <Button size="sm" variant={form.provider === "deepseek" ? "primary" : "secondary"} onPress={() => setProvider("deepseek")}>
                  DeepSeek API
                </Button>
                <Button size="sm" variant={form.provider === "ollama" ? "primary" : "secondary"} onPress={() => setProvider("ollama")}>
                  Ollama (local)
                </Button>
              </div>
            </div>

            <div className="flex flex-col gap-1.5">
              <TextField value={form.model} onChange={(model) => update({ model })} fullWidth>
                <Label>Model</Label>
                <Input variant="secondary" className="font-code text-xs" />
              </TextField>
              <div className="flex flex-wrap gap-1">
                {form.provider === "ollama" && ollamaModels.length === 0 && (
                  <span className="text-[11px] text-muted">No models installed in Ollama. Download one first with ollama pull.</span>
                )}
                {hints[form.provider].map((m) => (
                  <button key={m} type="button" onClick={() => update({ model: m })} className="font-code rounded-md bg-default-soft px-2 py-0.5 text-[11px] hover:bg-default-soft-hover">
                    {m}
                  </button>
                ))}
              </div>
            </div>

            <label className="flex flex-col gap-1.5">
              <span className="text-sm font-medium">Description (Claude decides when to use this worker based on this)</span>
              <textarea
                value={form.description}
                onChange={(e) => update({ description: e.target.value })}
                rows={3}
                placeholder="e.g. Fast and cheap. For well-defined coding tasks."
                className="resize-none rounded-xl border border-field-border bg-field px-3 py-2 text-sm outline-none focus:border-accent"
              />
            </label>

            <label className="flex flex-col gap-1.5">
              <span className="text-sm font-medium">Role instructions (optional, sent to the worker with every task)</span>
              <textarea
                value={form.system ?? ""}
                onChange={(e) => update({ system: e.target.value || undefined })}
                rows={3}
                placeholder="e.g. You are the QA reviewer: list concrete UI problems in the screenshots, most severe first."
                className="resize-none rounded-xl border border-field-border bg-field px-3 py-2 text-sm outline-none focus:border-accent"
              />
            </label>

            <div className="flex flex-col gap-1.5">
              <span className="text-sm font-medium">Color</span>
              <div className="flex gap-2">
                {COLORS.map((c) => (
                  <button
                    key={c}
                    type="button"
                    aria-label={`Color ${c}`}
                    onClick={() => update({ color: c })}
                    className={`size-7 rounded-full transition ${form.color === c ? "ring-2 ring-offset-2 ring-offset-surface" : "hover:scale-110"}`}
                    style={{ background: c, ["--tw-ring-color" as string]: c }}
                  />
                ))}
              </div>
            </div>

            <Switch isSelected={form.local} onChange={(local) => update({ local })}>
              <Switch.Content>
                <Switch.Control>
                  <Switch.Thumb />
                </Switch.Control>
                <span className="text-sm">Local: data never leaves this computer (sensitive work only goes to these)</span>
              </Switch.Content>
            </Switch>
          </Modal.Body>
          <Modal.Footer className="flex items-center gap-2">
            {editing &&
              (confirmDelete ? (
                <Button
                  size="sm"
                  variant="danger"
                  onPress={() => {
                    actions.deleteWorker(form.id);
                    actions.closeWorkerModal();
                  }}
                >
                  Yes, delete
                </Button>
              ) : (
                <Button size="sm" variant="ghost" onPress={() => setConfirmDelete(true)}>
                  Delete worker
                </Button>
              ))}
            <span className="flex-1" />
            <Button size="sm" variant="secondary" onPress={() => actions.closeWorkerModal()}>
              Cancel
            </Button>
            <Button size="sm" variant="primary" isDisabled={!valid} onPress={save}>
              Save
            </Button>
          </Modal.Footer>
        </Modal.Dialog>
      </Modal.Container>
    </Modal.Backdrop>
  );
}
