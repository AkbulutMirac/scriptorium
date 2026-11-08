import { Button } from "@heroui/react";
import { Plus } from "lucide-react";
import { truncate } from "../lib/format";
import { actions, agentMeta, CLAUDE_ID, useApp } from "../store";

/** Buttons and agent status list above the 3D scene */
export function SceneOverlay() {
  const workers = useApp((s) => s.workers);
  const activity = useApp((s) => s.activity);
  const requests = useApp((s) => s.workerRequests);
  const selected = useApp((s) => s.selected);
  const ids = [CLAUDE_ID, ...workers.map((w) => w.id)];

  return (
    <>
      <div className="absolute right-3 top-3 z-30">
        <Button size="sm" variant="secondary" onPress={() => actions.openWorkerModal()}>
          <Plus size={15} /> Add worker
        </Button>
      </div>

      <ul className="absolute bottom-3 left-3 z-30 flex max-w-[calc(100%-1.5rem)] flex-wrap gap-1.5" aria-label="Agent status">
        {ids.map((id) => {
          const meta = agentMeta(id, workers);
          const worker = workers.find((w) => w.id === id);
          const mine = requests.filter((r) => r.workerId === id);
          const running = worker ? mine.filter((r) => r.status === "running") : [];
          const queued = mine.filter((r) => r.status === "queued").length;
          const failed = mine.find((r) => r.status === "error");
          const a = worker ? undefined : activity[id];
          const working = worker ? running.length > 0 : a?.status === "working";
          const error = worker ? !!failed : a?.status === "error";
          const offline = worker?.available && !worker.available.ok;
          const status = working
            ? `working${running.length > 1 ? ` ×${running.length}` : ""}`
            : error
              ? "error"
              : offline
                ? "unreachable"
                : "idle";
          const task = worker ? running[0]?.task : a?.task;
          const title = worker
            ? [...running.map((r) => `• ${truncate(r.task, 80)}`), failed?.error, worker.available?.reason].filter(Boolean).join("\n")
            : (a?.task ?? a?.error ?? "");
          return (
            <li key={id}>
              <button
                type="button"
                onClick={() => actions.selectAgent(id)}
                title={title}
                className={`flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs backdrop-blur transition ${
                  selected === id ? "border-accent bg-surface" : "border-separator bg-surface/80 hover:bg-surface"
                }`}
              >
                <span className="size-2 rounded-full" style={{ background: meta.color }} />
                <span className="font-medium">{meta.name}</span>
                <span className={working ? "text-accent" : error ? "text-danger" : "text-muted"}>{status}</span>
                {queued > 0 && <span className="text-muted">· {queued} queued</span>}
                {working && task && running.length <= 1 && <span className="hidden max-w-40 truncate text-muted xl:inline">· {truncate(task, 40)}</span>}
              </button>
            </li>
          );
        })}
      </ul>
    </>
  );
}
