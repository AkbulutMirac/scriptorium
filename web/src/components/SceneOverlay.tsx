import { Button, Popover } from "@heroui/react";
import { ChevronUp, Plus, SlidersHorizontal, Users } from "lucide-react";
import { useState } from "react";
import { truncate } from "../lib/format";
import { actions, agentMeta, CLAUDE_ID, useApp } from "../store";

type Status = { label: string; tone: "accent" | "danger" | "muted"; busy: boolean; queued: number; task?: string; title: string };

/** Buttons and agent status above the 3D scene: Claude, the selected helper and whoever is busy; the rest behind "Team" */
export function SceneOverlay() {
  const workers = useApp((s) => s.workers);
  const activity = useApp((s) => s.activity);
  const requests = useApp((s) => s.workerRequests);
  const selected = useApp((s) => s.selected);
  const [open, setOpen] = useState(false);

  const status = (id: string): Status => {
    const worker = workers.find((w) => w.id === id);
    const mine = requests.filter((r) => r.workerId === id);
    const running = worker ? mine.filter((r) => r.status === "running") : [];
    const queued = mine.filter((r) => r.status === "queued").length;
    const failed = mine.find((r) => r.status === "error");
    const a = worker ? undefined : activity[id];
    const working = worker ? running.length > 0 : a?.status === "working";
    const error = worker ? !!failed : a?.status === "error";
    const offline = !!worker?.available && !worker.available.ok;
    const label = working ? `working${running.length > 1 ? ` ×${running.length}` : ""}` : error ? "error" : offline ? "unreachable" : "idle";
    const title = worker
      ? [...running.map((r) => `• ${truncate(r.task, 80)}`), failed?.error, worker.available?.reason].filter(Boolean).join("\n")
      : (a?.task ?? a?.error ?? "");
    return { label, tone: working ? "accent" : error ? "danger" : "muted", busy: working || error || queued > 0, queued, task: worker ? running[0]?.task : a?.task, title };
  };

  const all = [CLAUDE_ID, ...workers.map((w) => w.id)];
  const shown = all.filter((id) => id === CLAUDE_ID || id === selected || status(id).busy);
  const groups = [
    { title: "Workers", ids: workers.filter((w) => w.provider !== "claude").map((w) => w.id) },
    { title: "Claude team", ids: workers.filter((w) => w.provider === "claude").map((w) => w.id) },
  ];
  const busyCount = all.filter((id) => id !== CLAUDE_ID && status(id).busy).length;

  return (
    <>
      <div className="absolute right-3 top-3 z-30">
        <Button size="sm" variant="secondary" onPress={() => actions.openWorkerModal()}>
          <Plus size={15} /> Add worker
        </Button>
      </div>

      <div className="absolute bottom-3 left-3 z-30 flex max-w-[calc(100%-1.5rem)] flex-wrap items-center gap-1.5">
        <ul className="contents" aria-label="Agent status">
          {shown.map((id) => {
            const meta = agentMeta(id, workers);
            const s = status(id);
            return (
              <li key={id}>
                <button
                  type="button"
                  onClick={() => actions.selectAgent(id)}
                  title={s.title}
                  className={`flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs backdrop-blur transition ${
                    selected === id ? "border-accent bg-surface" : "border-separator bg-surface/80 hover:bg-surface"
                  }`}
                >
                  <span className="size-2 rounded-full" style={{ background: meta.color }} />
                  <span className="font-medium">{meta.name}</span>
                  <span className={s.tone === "accent" ? "text-accent" : s.tone === "danger" ? "text-danger" : "text-muted"}>{s.label}</span>
                  {s.queued > 0 && <span className="text-muted">· {s.queued} queued</span>}
                  {s.tone === "accent" && s.task && <span className="hidden max-w-40 truncate text-muted xl:inline">· {truncate(s.task, 40)}</span>}
                </button>
              </li>
            );
          })}
        </ul>

        <Popover isOpen={open} onOpenChange={setOpen}>
          <Button size="sm" variant="secondary" className="h-7 gap-1.5 rounded-full px-2.5 text-xs backdrop-blur" aria-label="All helpers">
            <Users size={13} />
            Team
            <span className="text-muted">{busyCount ? `${busyCount} busy` : workers.length}</span>
            <ChevronUp size={12} className="text-muted" />
          </Button>
          <Popover.Content placement="top start" className="w-72 max-w-[calc(100vw-1.5rem)]">
            <Popover.Dialog className="flex max-h-[60vh] flex-col gap-2 overflow-y-auto p-1.5">
              {groups.map((g) =>
                g.ids.length ? (
                  <section key={g.title}>
                    <p className="px-2 pb-1 pt-1 text-[11px] font-semibold uppercase tracking-wide text-muted">{g.title}</p>
                    <ul className="flex flex-col">
                      {g.ids.map((id) => {
                        const meta = agentMeta(id, workers);
                        const s = status(id);
                        return (
                          <li key={id}>
                            <button
                              type="button"
                              title={s.title}
                              onClick={() => {
                                actions.selectAgent(id);
                                setOpen(false);
                              }}
                              className={`flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-sm ${selected === id ? "bg-accent-soft" : "hover:bg-default-soft"}`}
                            >
                              <span className="size-2 shrink-0 rounded-full" style={{ background: meta.color }} />
                              <span className="min-w-0 flex-1 truncate">{meta.name}</span>
                              <span className={`shrink-0 text-xs ${s.tone === "accent" ? "text-accent" : s.tone === "danger" ? "text-danger" : "text-muted"}`}>
                                {s.label}
                                {s.queued > 0 ? ` · ${s.queued} queued` : ""}
                              </span>
                            </button>
                          </li>
                        );
                      })}
                    </ul>
                  </section>
                ) : null,
              )}
              <Button
                size="sm"
                variant="ghost"
                className="mx-1 mb-1 justify-start gap-1.5 text-xs"
                onPress={() => {
                  setOpen(false);
                  actions.openTeamModels();
                }}
              >
                <SlidersHorizontal size={13} /> Models…
              </Button>
            </Popover.Dialog>
          </Popover.Content>
        </Popover>
      </div>
    </>
  );
}
