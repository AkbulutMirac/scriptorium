import { randomUUID } from "node:crypto";
import type { Worker } from "./agents.js";
import { bus } from "./events.js";
import type { WorkerCaller, WorkerRequest } from "./protocol.js";

/**
 * İşçi istekleri. Birden fazla Claude oturumu (Scriptorium, terminal, masaüstü uygulaması) aynı
 * işçiyi aynı anda kullanabilir. Her istek ayrı kaydedilir; arayüz her çalışan isteği ayrı bir
 * işçi kopyası olarak çizer. Local model aynı anda tek iş kaldırır, API işçileri birkaç tane.
 */
const parallelLimit = (w: Worker) => (w.local ? 1 : 4);
const ERROR_VISIBLE_MS = 12_000;

const requests = new Map<string, WorkerRequest>();
const running = new Map<string, number>();
const waiting = new Map<string, (() => void)[]>();

const changed = () => bus.emit("requests");

export function listRequests(): WorkerRequest[] {
  return [...requests.values()].sort((a, b) => a.createdAt - b.createdAt);
}

function acquire(w: Worker, signal?: AbortSignal): Promise<void> {
  const n = running.get(w.id) ?? 0;
  if (n < parallelLimit(w)) {
    running.set(w.id, n + 1);
    return Promise.resolve();
  }
  return new Promise((resolve, reject) => {
    const queue = waiting.get(w.id) ?? [];
    waiting.set(w.id, queue);
    const onAbort = () => {
      const i = queue.indexOf(go);
      if (i >= 0) queue.splice(i, 1);
      reject(new Error("Durduruldu."));
    };
    function go() {
      signal?.removeEventListener("abort", onAbort);
      running.set(w.id, (running.get(w.id) ?? 0) + 1);
      resolve();
    }
    queue.push(go);
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

function release(w: Worker) {
  running.set(w.id, Math.max(0, (running.get(w.id) ?? 1) - 1));
  waiting.get(w.id)?.shift()?.();
}

/** İşi işçinin sırasına koyar, sırası gelince çalıştırır. Hata bir süre 3D ofiste görünür. */
export async function withWorkerSlot<T>(
  worker: Worker,
  info: { task: string; caller: WorkerCaller; signal?: AbortSignal },
  fn: () => Promise<T>,
): Promise<T> {
  const req: WorkerRequest = {
    id: randomUUID().slice(0, 8),
    workerId: worker.id,
    status: "queued",
    task: info.task,
    caller: info.caller,
    createdAt: Date.now(),
  };
  requests.set(req.id, req);
  changed();
  try {
    await acquire(worker, info.signal);
  } catch (err) {
    requests.delete(req.id);
    changed();
    throw err;
  }
  req.status = "running";
  req.startedAt = Date.now();
  changed();
  try {
    const out = await fn();
    requests.delete(req.id);
    return out;
  } catch (err) {
    if (info.signal?.aborted) {
      requests.delete(req.id);
    } else {
      req.status = "error";
      req.error = err instanceof Error ? err.message : String(err);
      setTimeout(() => {
        requests.delete(req.id);
        changed();
      }, ERROR_VISIBLE_MS);
    }
    throw err;
  } finally {
    release(worker);
    changed();
  }
}
