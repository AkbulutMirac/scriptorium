import { Button } from "@heroui/react";
import { Plus } from "lucide-react";
import { truncate } from "../lib/format";
import { actions, agentMeta, CLAUDE_ID, useApp } from "../store";

const STATUS_TEXT = { idle: "boşta", working: "çalışıyor", error: "hata" } as const;

/** 3D sahnenin üstündeki düğmeler ve ajan durum listesi */
export function SceneOverlay() {
  const workers = useApp((s) => s.workers);
  const activity = useApp((s) => s.activity);
  const selected = useApp((s) => s.selected);
  const ids = [CLAUDE_ID, ...workers.map((w) => w.id)];

  return (
    <>
      <div className="absolute right-3 top-3 z-30">
        <Button size="sm" variant="secondary" onPress={() => actions.openWorkerModal()}>
          <Plus size={15} /> İşçi ekle
        </Button>
      </div>

      <ul className="absolute bottom-3 left-3 z-30 flex max-w-[calc(100%-1.5rem)] flex-wrap gap-1.5" aria-label="Ajanların durumu">
        {ids.map((id) => {
          const meta = agentMeta(id, workers);
          const a = activity[id];
          const status = a?.status ?? "idle";
          const worker = workers.find((w) => w.id === id);
          const offline = worker && worker.available && !worker.available.ok;
          return (
            <li key={id}>
              <button
                type="button"
                onClick={() => actions.selectAgent(id)}
                title={a?.task ?? a?.error ?? worker?.available?.reason ?? ""}
                className={`flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs backdrop-blur transition ${
                  selected === id ? "border-accent bg-surface" : "border-separator bg-surface/80 hover:bg-surface"
                }`}
              >
                <span className="size-2 rounded-full" style={{ background: meta.color }} />
                <span className="font-medium">{meta.name}</span>
                <span className={status === "working" ? "text-accent" : status === "error" ? "text-danger" : "text-muted"}>
                  {offline && status === "idle" ? "ulaşılamıyor" : STATUS_TEXT[status]}
                </span>
                {status === "working" && a?.task && <span className="hidden max-w-40 truncate text-muted xl:inline">· {truncate(a.task, 40)}</span>}
              </button>
            </li>
          );
        })}
      </ul>
    </>
  );
}
