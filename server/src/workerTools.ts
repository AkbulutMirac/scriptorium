import { createSdkMcpServer, tool } from "@anthropic-ai/claude-agent-sdk";
import path from "node:path";
import { z } from "zod";
import { findWorker, loadWorkers, type Worker } from "./agents.js";
import { getJob, listJobs, startJob } from "./jobs.js";
import { isAvailable } from "./llm.js";
import type { WorkerCaller } from "./protocol.js";
import { listRequests } from "./requests.js";
import { runWorkerTask } from "./workerTasks.js";

/** The Claude session calling the tool: the folder file paths are relative to, and the name shown in the 3D office */
export type ToolCtx = { cwd?: string; caller: WorkerCaller };

type ToolResult = { content: { type: "text"; text: string }[]; isError?: boolean };
const ok = (text: string): ToolResult => ({ content: [{ type: "text", text }] });
const fail = (text: string): ToolResult => ({ content: [{ type: "text", text }], isError: true });

/** Usage summary the MCP server gives Claude (Claude Code adds this to the system prompt) */
export const WORKER_INSTRUCTIONS = [
  "Scriptorium workers: DeepSeek (API, cheap and fast) and local LLMs (Ollama, data never leaves the computer).",
  "Default is deepseek-pro; easy jobs go to deepseek (Flash). Local workers are small models: first check their model with list_workers, and only give short, single-step jobs.",
  "Check who is ready with list_workers. ask_worker waits for the answer; for jobs longer than a few minutes use start_job, then job_status.",
  "The worker cannot read files, write files, or run commands: provide the needed files via files and set project_dir to the full path of the working folder.",
  "Writing the returned code to a file and testing it is your job. For confidential data use sensitive: true (only local workers accept it).",
  "You can dispatch independent jobs in parallel with multiple ask_worker calls at once; local workers run in order.",
].join(" ");

/** Finds the worker and enforces the confidentiality rule. Returns an error text if there is a problem. */
async function pickWorker(workerId: string, sensitive?: boolean): Promise<Worker | string> {
  const worker = await findWorker(workerId);
  if (!worker) return `No such worker: ${workerId}. Check with list_workers.`;
  if (sensitive && !worker.local) {
    return `Sensitive data can only be sent to local workers. ${worker.name} is not local; pick a worker with local: true.`;
  }
  return worker;
}

const taskArgs = {
  worker_id: z.string().describe("Worker id from list_workers"),
  task: z.string().describe("Task for the worker, understandable on its own"),
  files: z.array(z.string()).optional().describe("File paths relative to project_dir. The tool reads the files and sends them to the worker."),
  project_dir: z
    .string()
    .optional()
    .describe("Full path of the working folder. Required if files is given; also shows in the 3D office which project the job came from."),
  sensitive: z
    .boolean()
    .optional()
    .describe("true if the task or files contain confidential/personal data. If true, only local workers are accepted."),
};
type TaskArgs = { worker_id: string; task: string; files?: string[]; project_dir?: string; sensitive?: boolean };

/** Uses project_dir if given and sets the 3D office name to the folder name */
function withProjectDir(ctx: ToolCtx, projectDir?: string): ToolCtx {
  if (!projectDir) return ctx;
  return { cwd: projectDir, caller: { ...ctx.caller, label: path.basename(projectDir) || ctx.caller.label } };
}

/** The four worker tools. The same in both Scriptorium sessions (in-SDK) and other Claude Code sessions (HTTP). */
export const WORKER_TOOLS = [
  {
    name: "list_workers",
    description:
      "Lists worker models (DeepSeek, local LLMs) with descriptions: whether they are currently reachable, how many jobs they are running, how many are queued.",
    schema: {},
    handler: async (): Promise<ToolResult> => {
      const [workers, requests] = [await loadWorkers(), listRequests()];
      const rows = await Promise.all(
        workers.map(async (w) => ({
          id: w.id,
          name: w.name,
          model: w.model,
          local: w.local,
          description: w.description,
          available: await isAvailable(w),
          running: requests.filter((r) => r.workerId === w.id && r.status === "running").length,
          queued: requests.filter((r) => r.workerId === w.id && r.status === "queued").length,
        })),
      );
      return ok(JSON.stringify(rows, null, 2));
    },
  },
  {
    name: "ask_worker",
    description: [
      "Hands a task to a worker model and waits for its answer, then returns it.",
      "The worker cannot read files, write files, or run commands: provide the files it needs via `files`. Writing the returned code to a file and testing it is your job.",
      "When to use: clearly defined, self-contained code tasks (function, script, test, code conversion); jobs that take large input and produce small output (summary, classification).",
      "When not to use: debugging and architecture decisions that require looking at the whole project.",
      "For confidential data pass sensitive: true, then only local workers are accepted. Do not accept the worker's answer as correct without checking it.",
      "For jobs that will take more than a few minutes (especially batch jobs with local models), use start_job.",
    ].join(" "),
    schema: taskArgs,
    handler: async (args: TaskArgs, ctx: ToolCtx): Promise<ToolResult> => {
      const worker = await pickWorker(args.worker_id, args.sensitive);
      if (typeof worker === "string") return fail(worker);
      const c = withProjectDir(ctx, args.project_dir);
      try {
        return ok(await runWorkerTask({ worker, task: args.task, files: args.files, cwd: c.cwd, caller: c.caller }));
      } catch (err) {
        return fail(err instanceof Error ? err.message : String(err));
      }
    },
  },
  {
    name: "start_job",
    description:
      "Starts a long-running job on a worker in the background and immediately returns a job number. Ask for the result with job_status. Jobs for the same worker run in order. Rules are the same as ask_worker.",
    schema: taskArgs,
    handler: async (args: TaskArgs, ctx: ToolCtx): Promise<ToolResult> => {
      const worker = await pickWorker(args.worker_id, args.sensitive);
      if (typeof worker === "string") return fail(worker);
      const c = withProjectDir(ctx, args.project_dir);
      if (args.files?.length && !c.cwd) return fail("To send files, provide project_dir (the full path of the project folder).");
      const job = startJob({ worker, task: args.task, files: args.files, cwd: c.cwd, caller: c.caller });
      return ok(`Job started. Job number: ${job.id}. Ask for the result with job_status.`);
    },
  },
  {
    name: "job_status",
    description: "Returns the status of a background job and its result if finished. If job_id is not given, lists recent jobs.",
    schema: { job_id: z.string().optional().describe("Job number returned by start_job") },
    handler: async ({ job_id }: { job_id?: string }): Promise<ToolResult> => {
      if (job_id) {
        const job = getJob(job_id);
        return job ? ok(JSON.stringify(job, null, 2)) : fail(`No such job: ${job_id}`);
      }
      const summary = listJobs()
        .slice(0, 20)
        .map(({ id, workerId, status, task }) => ({ id, workerId, status, task: task.slice(0, 100) }));
      return ok(JSON.stringify(summary, null, 2));
    },
  },
] as const;

/** Name of the MCP server: the tools appear as mcp__scriptorium__* inside Claude Code */
export const WORKER_SERVER_NAME = "scriptorium";

/** In-SDK server for Scriptorium's own Claude sessions */
export function createWorkerServer(ctx: ToolCtx) {
  return createSdkMcpServer({
    name: WORKER_SERVER_NAME,
    version: "0.2.0",
    instructions: WORKER_INSTRUCTIONS,
    tools: WORKER_TOOLS.map((t) =>
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      tool(t.name, t.description, t.schema, (args: any) => t.handler(args, ctx), { alwaysLoad: true }),
    ),
  });
}
