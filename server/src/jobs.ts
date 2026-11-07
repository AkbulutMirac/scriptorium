import { randomUUID } from "node:crypto";
import type { Worker } from "./agents.js";
import { bus } from "./events.js";
import type { JobInfo } from "./protocol.js";
import { runWorkerTask } from "./workerTasks.js";

/**
 * Arka plan işleri. Uzun işlerde (örneğin local modelle yüzlerce dosya) Claude beklemez:
 * işi başlatır, iş numarası alır, sonucu sonra job_status ile sorar.
 * Aynı işçinin işleri sırayla çalışır (local model aynı anda tek iş kaldırır).
 */
const jobs = new Map<string, JobInfo>();
const queues = new Map<string, Promise<unknown>>();

const MAX_KEPT_JOBS = 50;

function changed() {
  // Eski bitmiş işleri temizle
  const finished = [...jobs.values()].filter((j) => j.finishedAt).sort((a, b) => a.createdAt - b.createdAt);
  while (jobs.size > MAX_KEPT_JOBS && finished.length) jobs.delete(finished.shift()!.id);
  bus.emit("jobs");
}

export function startJob(args: { worker: Worker; task: string; files?: string[]; cwd: string }): JobInfo {
  const job: JobInfo = {
    id: randomUUID().slice(0, 8),
    workerId: args.worker.id,
    task: args.task,
    status: "queued",
    createdAt: Date.now(),
  };
  jobs.set(job.id, job);
  changed();

  const previous = queues.get(args.worker.id) ?? Promise.resolve();
  const run = previous.then(async () => {
    job.status = "running";
    changed();
    try {
      job.result = await runWorkerTask(args);
      job.status = "done";
    } catch (err) {
      job.error = err instanceof Error ? err.message : String(err);
      job.status = "error";
    }
    job.finishedAt = Date.now();
    changed();
  });
  queues.set(args.worker.id, run);
  return job;
}

export function getJob(id: string): JobInfo | undefined {
  return jobs.get(id);
}

export function listJobs(): JobInfo[] {
  return [...jobs.values()].sort((a, b) => b.createdAt - a.createdAt);
}
