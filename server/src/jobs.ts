import { randomUUID } from "node:crypto";
import type { Worker } from "./agents.js";
import { bus } from "./events.js";
import type { JobInfo, WorkerCaller } from "./protocol.js";
import { runWorkerTask } from "./workerTasks.js";

/**
 * Background jobs. For long tasks (e.g. hundreds of files with a local model) Claude does not wait:
 * it starts the job, gets a job id, and asks for the result later via job_status.
 * Jobs of the same local worker run sequentially (a local model handles only one job at a time);
 * API workers run them in parallel, limited by their slot count in requests.ts.
 */
const jobs = new Map<string, JobInfo>();
const queues = new Map<string, Promise<unknown>>();

const MAX_KEPT_JOBS = 50;

function changed() {
  // Clean up old finished jobs
  const finished = [...jobs.values()].filter((j) => j.finishedAt).sort((a, b) => a.createdAt - b.createdAt);
  while (jobs.size > MAX_KEPT_JOBS && finished.length) jobs.delete(finished.shift()!.id);
  bus.emit("jobs");
}

export function startJob(args: {
  worker: Worker;
  task: string;
  files?: string[];
  cwd?: string;
  caller: WorkerCaller;
  /** Custom work instead of a worker task (e.g. a QA run); returns the result text */
  run?: () => Promise<string>;
}): JobInfo {
  const job: JobInfo = {
    id: randomUUID().slice(0, 8),
    workerId: args.worker.id,
    task: args.task,
    status: "queued",
    createdAt: Date.now(),
  };
  jobs.set(job.id, job);
  changed();

  const previous = (args.worker.local && queues.get(args.worker.id)) || Promise.resolve();
  const run = previous.then(async () => {
    job.status = "running";
    changed();
    try {
      job.result = await (args.run ? args.run() : runWorkerTask(args));
      job.status = "done";
    } catch (err) {
      job.error = err instanceof Error ? err.message : String(err);
      job.status = "error";
    }
    job.finishedAt = Date.now();
    changed();
  });
  if (args.worker.local) queues.set(args.worker.id, run);
  return job;
}

export function getJob(id: string): JobInfo | undefined {
  return jobs.get(id);
}

export function listJobs(): JobInfo[] {
  return [...jobs.values()].sort((a, b) => b.createdAt - a.createdAt);
}
