import { Button, Chip, Input, Label, Modal, Spinner, TextField } from "@heroui/react";
import { Check, ExternalLink, RefreshCw } from "lucide-react";
import { useState } from "react";
import type { WorkerInfo, WorkerModel } from "../protocol";
import { actions, useApp } from "../store";

const LOCAL_COLORS = ["#7F77DD", "#22A06B", "#14B8A6", "#A855F7", "#E8A23A"];

/** Worker id from the Ollama model name: "hf.co/x/Qwen3-8B-GGUF:Q4" → "qwen3-8b-gguf-q4" */
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
          {optional && <span className="text-xs text-muted">optional</span>}
        </div>
        {children}
      </div>
    </section>
  );
}

/** Initial setup: Claude sign-in, DeepSeek key, local models, hooking into all Claude Code sessions */
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
      description: `${m.size ? `${m.size} ` : ""}local model${m.vision ? ", reads images too" : ""}. Free, data never leaves this computer.`,
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
            <Modal.Heading>Setup</Modal.Heading>
            <Button isIconOnly size="sm" variant="ghost" aria-label="Refresh" className="ml-auto" onPress={() => actions.openSetup()}>
              <RefreshCw size={15} />
            </Button>
          </Modal.Header>
          <Modal.Body className="flex flex-col gap-3">
            {!status ? (
              <div className="flex items-center gap-2 py-6 text-sm text-muted">
                <Spinner size="sm" /> Checking…
              </div>
            ) : (
              <>
                <Step n={1} title="Claude account" done={!!c?.loggedIn}>
                  {c?.loggedIn ? (
                    <p className="text-sm">
                      Signed in{c.email ? `: ${c.email}` : ""}. {c.cliSource === "bundled" && <span className="text-muted">(Scriptorium's own Claude Code)</span>}
                    </p>
                  ) : !c?.found ? (
                    <p className="text-sm text-danger">Claude Code not found. Run npm install in the project folder, then refresh.</p>
                  ) : (
                    <>
                      <p className="text-sm text-muted">
                        Sign in with your Claude subscription (Pro, Max). Anthropic's sign-in page opens in your browser; when done, come back here and refresh.
                      </p>
                      <div className="flex gap-2">
                        <Button size="sm" variant="primary" isPending={busy === "claudeLogin"} onPress={() => actions.setupAction("claudeLogin")}>
                          Sign in with Claude <ExternalLink size={13} />
                        </Button>
                        <Button size="sm" variant="secondary" onPress={() => actions.openSetup()}>
                          Check sign-in
                        </Button>
                      </div>
                    </>
                  )}
                </Step>

                <Step n={2} title="DeepSeek workers" optional done={status.deepseek.configured}>
                  {status.deepseek.configured ? (
                    <p className="text-sm">API key saved. You can see your balance in the top bar.</p>
                  ) : (
                    <>
                      <p className="text-sm text-muted">
                        Cheap and fast workers. Create an account at platform.deepseek.com, add balance, create an API key and paste it here. The key is
                        written only to the .env file on this computer.
                      </p>
                      <div className="flex items-end gap-2">
                        <TextField value={key} onChange={setKey} type="password" className="flex-1">
                          <Label className="sr-only">DeepSeek API key</Label>
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
                          Save
                        </Button>
                      </div>
                      <a href="https://platform.deepseek.com/api_keys" target="_blank" rel="noreferrer" className="flex items-center gap-1 text-xs text-accent">
                        Create API key <ExternalLink size={11} />
                      </a>
                    </>
                  )}
                </Step>

                <Step n={3} title="Local workers (Ollama)" optional done={workers.some((w) => w.local)}>
                  {!status.ollama.running ? (
                    <>
                      <p className="text-sm text-muted">
                        Free, and your data never leaves your computer. Install Ollama, download a model (example: <span className="font-code">ollama pull qwen3.5:9b</span>), then refresh.
                      </p>
                      <a href="https://ollama.com/download" target="_blank" rel="noreferrer" className="flex items-center gap-1 text-xs text-accent">
                        Download Ollama <ExternalLink size={11} />
                      </a>
                    </>
                  ) : status.ollama.models.length === 0 ? (
                    <p className="text-sm text-muted">
                      Ollama is running but there are no models. Example: <span className="font-code">ollama pull qwen3.5:9b</span>, then refresh.
                    </p>
                  ) : (
                    <>
                      <p className="text-sm text-muted">Add any of your installed models as a worker. On an 8 GB GPU, models up to 9B run comfortably.</p>
                      <ul className="flex flex-col gap-1">
                        {status.ollama.models.map((m) => {
                          const added = workers.some((w) => w.provider === "ollama" && w.model.replace(/:latest$/, "") === m.id);
                          return (
                            <li key={m.id} className="flex items-center gap-2 rounded-lg bg-default-soft px-2.5 py-1.5">
                              <div className="min-w-0 flex-1">
                                <div className="font-code truncate text-xs">{m.id}</div>
                                <div className="text-[10px] text-muted">{[m.size, m.vision ? "reads images too" : "text only"].filter(Boolean).join(" · ")}</div>
                              </div>
                              {added ? (
                                <Chip size="sm" variant="soft" color="success">
                                  added
                                </Chip>
                              ) : (
                                <Button size="sm" variant="secondary" onPress={() => addLocalWorker(m)}>
                                  Add as worker
                                </Button>
                              )}
                            </li>
                          );
                        })}
                      </ul>
                    </>
                  )}
                </Step>

                <Step n={4} title="In all Claude Code sessions" optional done={status.mcp && status.rules}>
                  <p className="text-sm text-muted">Let Claude in the terminal and in the Claude desktop app use the workers too.</p>
                  <div className="flex flex-col gap-1.5 text-sm">
                    <div className="flex items-center gap-2">
                      <span className="flex-1">Add worker tools (MCP)</span>
                      {status.mcp ? (
                        <Chip size="sm" variant="soft" color="success">
                          added
                        </Chip>
                      ) : (
                        <Button size="sm" variant="secondary" isDisabled={!c?.found} isPending={busy === "mcp"} onPress={() => actions.setupAction("mcp")}>
                          Add
                        </Button>
                      )}
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="flex-1">Add rules for when to use them (~/.claude/CLAUDE.md)</span>
                      {status.rules ? (
                        <Chip size="sm" variant="soft" color="success">
                          added
                        </Chip>
                      ) : (
                        <Button size="sm" variant="secondary" isPending={busy === "rules"} onPress={() => actions.setupAction("rules")}>
                          Add
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
              {c?.loggedIn ? "Done" : "Later"}
            </Button>
          </Modal.Footer>
        </Modal.Dialog>
      </Modal.Container>
    </Modal.Backdrop>
  );
}
