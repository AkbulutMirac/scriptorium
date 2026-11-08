import { Button, Chip, Input, Label, Modal, Spinner, TextField } from "@heroui/react";
import { Check, ExternalLink, RefreshCw } from "lucide-react";
import { useState } from "react";
import type { WorkerInfo, WorkerModel } from "../protocol";
import { actions, useApp } from "../store";

const LOCAL_COLORS = ["#7F77DD", "#22A06B", "#14B8A6", "#A855F7", "#E8A23A"];

/** Ollama model adından işçi id'si: "hf.co/x/Qwen3-8B-GGUF:Q4" → "qwen3-8b-gguf-q4" */
const slug = (model: string) =>
  (model.split("/").pop() ?? model)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40) || "local";

function Step({ n, title, optional, done, children }: { n: number; title: string; optional?: boolean; done: boolean; children: React.ReactNode }) {
  return (
    <section className="flex gap-3 rounded-xl border border-separator p-3">
      <span className={`flex size-6 shrink-0 items-center justify-center rounded-full text-xs font-semibold ${done ? "bg-success text-white" : "bg-default-soft"}`}>
        {done ? <Check size={14} /> : n}
      </span>
      <div className="flex min-w-0 flex-1 flex-col gap-2">
        <div className="flex items-center gap-2">
          <span className="font-semibold">{title}</span>
          {optional && <span className="text-xs text-muted">isteğe bağlı</span>}
        </div>
        {children}
      </div>
    </section>
  );
}

/** İlk kurulum: Claude girişi, DeepSeek anahtarı, local modeller, bütün Claude Code oturumlarına bağlama */
export function SetupModal() {
  const { open, status, busy } = useApp((s) => s.setup);
  const workers = useApp((s) => s.workers);
  const [key, setKey] = useState("");

  const addLocalWorker = (m: WorkerModel) => {
    let id = slug(m.id);
    while (workers.some((w) => w.id === id)) id = `${id}-2`;
    const worker: WorkerInfo = {
      id,
      name: `${(m.id.split("/").pop() ?? m.id).replace(/:latest$/, "")} (local)`,
      provider: "ollama",
      model: m.id,
      color: LOCAL_COLORS[workers.filter((w) => w.local).length % LOCAL_COLORS.length],
      description: `${m.size ? `${m.size} parametreli ` : ""}local model${m.vision ? ", görsel de okur" : ""}. Bedava, veri bilgisayardan çıkmaz.`,
      local: true,
    };
    actions.saveWorker(worker);
  };

  const c = status?.claude;
  return (
    <Modal.Backdrop isOpen={open} onOpenChange={(o) => !o && actions.closeSetup()}>
      <Modal.Container size="lg" scroll="inside">
        <Modal.Dialog>
          <Modal.Header className="flex flex-row items-center gap-2">
            <Modal.Heading>Kurulum</Modal.Heading>
            <Button isIconOnly size="sm" variant="ghost" aria-label="Yenile" className="ml-auto" onPress={() => actions.openSetup()}>
              <RefreshCw size={15} />
            </Button>
          </Modal.Header>
          <Modal.Body className="flex flex-col gap-3">
            {!status ? (
              <div className="flex items-center gap-2 py-6 text-sm text-muted">
                <Spinner size="sm" /> Kontrol ediliyor…
              </div>
            ) : (
              <>
                <Step n={1} title="Claude hesabı" done={!!c?.loggedIn}>
                  {c?.loggedIn ? (
                    <p className="text-sm">
                      Giriş yapıldı{c.email ? `: ${c.email}` : ""}. {c.cliSource === "dahili" && <span className="text-muted">(Scriptorium'un kendi Claude Code'u)</span>}
                    </p>
                  ) : !c?.found ? (
                    <p className="text-sm text-danger">Claude Code bulunamadı. Proje klasöründe npm install çalıştır, sonra yenile.</p>
                  ) : (
                    <>
                      <p className="text-sm text-muted">
                        Claude aboneliğinle (Pro, Max) giriş yap. Tarayıcıda Anthropic'in giriş sayfası açılır; bitince buraya dönüp yenile.
                      </p>
                      <div className="flex gap-2">
                        <Button size="sm" variant="primary" isPending={busy === "claudeLogin"} onPress={() => actions.setupAction("claudeLogin")}>
                          Claude ile giriş yap <ExternalLink size={13} />
                        </Button>
                        <Button size="sm" variant="secondary" onPress={() => actions.openSetup()}>
                          Girişi kontrol et
                        </Button>
                      </div>
                    </>
                  )}
                </Step>

                <Step n={2} title="DeepSeek işçileri" optional done={status.deepseek.configured}>
                  {status.deepseek.configured ? (
                    <p className="text-sm">API anahtarı kayıtlı. Bakiyeyi üst barda görebilirsin.</p>
                  ) : (
                    <>
                      <p className="text-sm text-muted">
                        Ucuz ve hızlı işçiler. platform.deepseek.com'da hesap aç, bakiye yükle, bir API anahtarı oluştur ve buraya yapıştır. Anahtar sadece bu
                        bilgisayardaki .env dosyasına yazılır.
                      </p>
                      <div className="flex items-end gap-2">
                        <TextField value={key} onChange={setKey} type="password" className="flex-1">
                          <Label className="sr-only">DeepSeek API anahtarı</Label>
                          <Input variant="secondary" placeholder="sk-..." autoComplete="off" />
                        </TextField>
                        <Button
                          size="sm"
                          variant="primary"
                          isDisabled={!key.trim()}
                          isPending={busy === "deepseekKey"}
                          onPress={() => {
                            actions.setupAction("deepseekKey", key);
                            setKey("");
                          }}
                        >
                          Kaydet
                        </Button>
                      </div>
                      <a href="https://platform.deepseek.com/api_keys" target="_blank" rel="noreferrer" className="flex items-center gap-1 text-xs text-accent">
                        API anahtarı oluştur <ExternalLink size={11} />
                      </a>
                    </>
                  )}
                </Step>

                <Step n={3} title="Local işçiler (Ollama)" optional done={workers.some((w) => w.local)}>
                  {!status.ollama.running ? (
                    <>
                      <p className="text-sm text-muted">
                        Bedava ve verin bilgisayardan çıkmaz. Ollama'yı kur, bir model indir (örnek: <span className="font-code">ollama pull qwen3.5:9b</span>), sonra yenile.
                      </p>
                      <a href="https://ollama.com/download" target="_blank" rel="noreferrer" className="flex items-center gap-1 text-xs text-accent">
                        Ollama'yı indir <ExternalLink size={11} />
                      </a>
                    </>
                  ) : status.ollama.models.length === 0 ? (
                    <p className="text-sm text-muted">
                      Ollama çalışıyor ama model yok. Örnek: <span className="font-code">ollama pull qwen3.5:9b</span>, sonra yenile.
                    </p>
                  ) : (
                    <>
                      <p className="text-sm text-muted">Kurulu modellerinden istediğini işçi olarak ekle. 8 GB ekran kartında 9B'ye kadar modeller rahat çalışır.</p>
                      <ul className="flex flex-col gap-1">
                        {status.ollama.models.map((m) => {
                          const added = workers.some((w) => w.provider === "ollama" && w.model.replace(/:latest$/, "") === m.id);
                          return (
                            <li key={m.id} className="flex items-center gap-2 rounded-lg bg-default-soft px-2.5 py-1.5">
                              <div className="min-w-0 flex-1">
                                <div className="font-code truncate text-xs">{m.id}</div>
                                <div className="text-[10px] text-muted">{[m.size, m.vision ? "görsel de okur" : "sadece metin"].filter(Boolean).join(" · ")}</div>
                              </div>
                              {added ? (
                                <Chip size="sm" variant="soft" color="success">
                                  eklendi
                                </Chip>
                              ) : (
                                <Button size="sm" variant="secondary" onPress={() => addLocalWorker(m)}>
                                  İşçi olarak ekle
                                </Button>
                              )}
                            </li>
                          );
                        })}
                      </ul>
                    </>
                  )}
                </Step>

                <Step n={4} title="Bütün Claude Code oturumlarında" optional done={status.mcp && status.rules}>
                  <p className="text-sm text-muted">Terminaldeki ve Claude masaüstü uygulamasındaki Claude da işçileri kullanabilsin.</p>
                  <div className="flex flex-col gap-1.5 text-sm">
                    <div className="flex items-center gap-2">
                      <span className="flex-1">İşçi araçlarını ekle (MCP)</span>
                      {status.mcp ? (
                        <Chip size="sm" variant="soft" color="success">
                          eklendi
                        </Chip>
                      ) : (
                        <Button size="sm" variant="secondary" isDisabled={!c?.found} isPending={busy === "mcp"} onPress={() => actions.setupAction("mcp")}>
                          Ekle
                        </Button>
                      )}
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="flex-1">Ne zaman devredeceği kurallarını ekle (~/.claude/CLAUDE.md)</span>
                      {status.rules ? (
                        <Chip size="sm" variant="soft" color="success">
                          eklendi
                        </Chip>
                      ) : (
                        <Button size="sm" variant="secondary" isPending={busy === "rules"} onPress={() => actions.setupAction("rules")}>
                          Ekle
                        </Button>
                      )}
                    </div>
                  </div>
                </Step>
              </>
            )}
          </Modal.Body>
          <Modal.Footer>
            <Button variant="primary" onPress={() => actions.closeSetup()}>
              {c?.loggedIn ? "Bitti" : "Sonra"}
            </Button>
          </Modal.Footer>
        </Modal.Dialog>
      </Modal.Container>
    </Modal.Backdrop>
  );
}
