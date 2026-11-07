import { Button, Input, Label, Modal, Switch, TextField } from "@heroui/react";
import { useEffect, useState } from "react";
import type { Provider, WorkerInfo } from "../protocol";
import { actions, useApp } from "../store";

const COLORS = ["#4D6BFE", "#7F77DD", "#22A06B", "#E8A23A", "#E5487A", "#14B8A6", "#64748B", "#A855F7"];

const MODEL_HINTS: Record<Provider, string[]> = {
  deepseek: ["deepseek-flash", "deepseek-v4-pro"],
  ollama: ["hf.co/ISTA-DASLab/Qwen3.8-27B-GSQ-RCO-GGUF:IQ2_XS"],
};

/** Türkçe karakterleri sadeleştirip id üretir: "Kod Ustası" → "kod-ustasi" */
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

/** İşçi ekleme ve düzenleme penceresi. Kaydedilen işçiyi Claude anında görür. */
export function WorkerModal() {
  const { open, worker } = useApp((s) => s.workerModal);
  const workers = useApp((s) => s.workers);
  const editing = !!worker;
  const [form, setForm] = useState<WorkerInfo>(empty);
  const [confirmDelete, setConfirmDelete] = useState(false);

  useEffect(() => {
    if (open) {
      setForm(worker ? { ...worker } : empty());
      setConfirmDelete(false);
    }
  }, [open, worker]);

  const id = editing ? form.id : slugify(form.name);
  const idTaken = !editing && workers.some((w) => w.id === id);
  const valid = !!form.name.trim() && !!form.model.trim() && !!id && !idTaken;
  const update = (patch: Partial<WorkerInfo>) => setForm((f) => ({ ...f, ...patch }));

  const setProvider = (provider: Provider) =>
    update({ provider, local: provider === "ollama", model: MODEL_HINTS[provider].includes(form.model) || !form.model ? MODEL_HINTS[provider][0] : form.model });

  const save = () => {
    if (!valid) return;
    const { available: _a, ...rest } = form;
    actions.saveWorker({ ...rest, id, name: form.name.trim(), model: form.model.trim(), description: form.description.trim() });
    actions.closeWorkerModal();
  };

  return (
    <Modal.Backdrop isOpen={open} onOpenChange={(o) => !o && actions.closeWorkerModal()}>
      <Modal.Container size="md">
        <Modal.Dialog>
          <Modal.Header>
            <Modal.Heading>{editing ? "İşçiyi düzenle" : "Yeni işçi"}</Modal.Heading>
          </Modal.Header>
          <Modal.Body className="flex flex-col gap-4">
            <TextField value={form.name} onChange={(name) => update({ name })} fullWidth autoFocus>
              <Label>Ad</Label>
              <Input variant="secondary" placeholder="Kod Ustası" />
            </TextField>
            {!editing && id && <p className={`-mt-2 text-xs ${idTaken ? "text-danger" : "text-muted"}`}>id: {id}{idTaken && " (bu id zaten var)"}</p>}

            <div className="flex flex-col gap-1.5">
              <span className="text-sm font-medium">Sağlayıcı</span>
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
                {MODEL_HINTS[form.provider].map((m) => (
                  <button key={m} type="button" onClick={() => update({ model: m })} className="font-code rounded-md bg-default-soft px-2 py-0.5 text-[11px] hover:bg-default-soft-hover">
                    {m}
                  </button>
                ))}
              </div>
            </div>

            <label className="flex flex-col gap-1.5">
              <span className="text-sm font-medium">Açıklama (Claude ne zaman bu işçiyi kullanacağına buna bakarak karar verir)</span>
              <textarea
                value={form.description}
                onChange={(e) => update({ description: e.target.value })}
                rows={3}
                placeholder="Örn: Hızlı ve ucuz. Net tanımlı kod görevleri için."
                className="resize-none rounded-xl border border-field-border bg-field px-3 py-2 text-sm outline-none focus:border-accent"
              />
            </label>

            <div className="flex flex-col gap-1.5">
              <span className="text-sm font-medium">Renk</span>
              <div className="flex gap-2">
                {COLORS.map((c) => (
                  <button
                    key={c}
                    type="button"
                    aria-label={`Renk ${c}`}
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
                <span className="text-sm">Local: veri bu bilgisayardan çıkmaz (hassas işler sadece bunlara gider)</span>
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
                  Evet, sil
                </Button>
              ) : (
                <Button size="sm" variant="ghost" onPress={() => setConfirmDelete(true)}>
                  İşçiyi sil
                </Button>
              ))}
            <span className="flex-1" />
            <Button size="sm" variant="secondary" onPress={() => actions.closeWorkerModal()}>
              Vazgeç
            </Button>
            <Button size="sm" variant="primary" isDisabled={!valid} onPress={save}>
              Kaydet
            </Button>
          </Modal.Footer>
        </Modal.Dialog>
      </Modal.Container>
    </Modal.Backdrop>
  );
}
