import { createSdkMcpServer, tool } from "@anthropic-ai/claude-agent-sdk";
import path from "node:path";
import { z } from "zod";
import { findWorker, loadWorkers, type Worker } from "./agents.js";
import { getJob, listJobs, startJob } from "./jobs.js";
import { isAvailable, supportsVision } from "./llm.js";
import type { WorkerCaller } from "./protocol.js";
import { listRequests } from "./requests.js";
import { runWorkerTask } from "./workerTasks.js";
import { checkQaUrl, pickQaWorker, runQaExplore, runQaSweep } from "./qa/run.js";

/** The Claude session calling the tool: the folder file paths are relative to, and the name shown in the 3D office */
export type ToolCtx = { cwd?: string; caller: WorkerCaller };

type ToolResult = { content: { type: "text"; text: string }[]; isError?: boolean };
const ok = (text: string): ToolResult => ({ content: [{ type: "text", text }] });
const fail = (text: string): ToolResult => ({ content: [{ type: "text", text }], isError: true });

/** Usage summary the MCP server gives Claude (Claude Code adds this to the system prompt) */
export const WORKER_INSTRUCTIONS = [
  "Scriptorium helpers. Workers: DeepSeek (API, cheap) and local LLMs (Ollama, data never leaves the computer).",
  'Claude subagents: start them with the Agent tool and model "haiku" or "sonnet"; they appear in the Scriptorium office as well.',
  "Use helpers when they save time or Claude usage. Doing the work yourself is fine when that is simpler: you decide.",
  "DeepSeek suits self-contained code (a function, a script, tests), summaries of long input and classification. It costs nothing from the Claude subscription,",
  "but it can't read files, write files or run commands: pass the files with files, set project_dir to the full path of the working folder, and check what comes back.",
  "deepseek-pro for harder code; deepseek (Flash) for easy jobs and anything with images (the only DeepSeek model with vision).",
  "Local workers are small models: check their model with list_workers first and give only short, single-step jobs. For confidential data use sensitive: true (only local workers accept it).",
  "ask_worker waits for the answer; for jobs longer than a few minutes use start_job, then job_status. Send independent parts in parallel.",
  "UI testing: qa_sweep clicks every visible control in a real browser and measures layout problems; qa_explore is an agent that explores flows on its own.",
  "When you used helpers, say at the end which one did what.",
].join(" ");

/** Finds the worker and enforces the confidentiality rule. Returns an error text if there is a problem. */
async function pickWorker(workerId: string, sensitive?: boolean): Promise<Worker | string> {
  const worker = await findWorker(workerId);
  if (!worker) return `No such worker: ${workerId}. Check with list_workers.`;
  if (worker.provider === "claude") return `${worker.name} is a Claude subagent: start it with the Agent tool and model "${worker.model}" instead.`;
  if (sensitive && !worker.local) {
    return `Sensitive data can only be sent to local workers. ${worker.name} is not local; pick a worker with local: true.`;
  }
  return worker;
}

const taskArgs = {
  worker_id: z.string().describe("Worker id from list_workers"),
  task: z.string().describe("Task for the worker, understandable on its own"),
  files: z.array(z.string()).optional().describe("Images (png, jpg, webp, gif: screenshots for a UI review) may also be listed, with full paths, even outside project_dir. " + "File paths relative to project_dir. The tool reads the files and sends them to the worker."),
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

/**
 * readOnlyHint: the tools don't change the user's files, so Claude Code may run them concurrently.
 * Without it, ask_worker calls sent in parallel run one after another (and only one worker shows up in the office).
 */
export const WORKER_TOOL_ANNOTATIONS = { readOnlyHint: true, openWorldHint: true };

/** The four worker tools. The same in both Scriptorium sessions (in-SDK) and other Claude Code sessions (HTTP). */
export const WORKER_TOOLS = [
  {
    name: "list_workers",
    description:
      "Lists worker models (DeepSeek, local LLMs) with descriptions: whether they are currently reachable, how many jobs they are running, how many are queued.",
    schema: {},
    handler: async (): Promise<ToolResult> => {
      // Claude subagents (Haiku, Sonnet) run through the Agent tool, not these tools
      const [workers, requests] = [(await loadWorkers()).filter((w) => w.provider !== "claude"), listRequests()];
      const rows = await Promise.all(
        workers.map(async (w) => ({
          id: w.id,
          name: w.name,
          model: w.model,
          local: w.local,
          description: w.description,
          available: await isAvailable(w),
          vision: await supportsVision(w),
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
  {
    name: "qa_sweep",
    description: [
      "Systematic UI test. Opens the app in a real headless browser on this computer and clicks every visible control on the start screen, in each viewport (desktop, tablet, phone) and theme.",
      "Measures layout problems itself (sideways overflow, cut-off text, overlapping controls, tap targets under 32px, console errors) and sends every screen that changed to the QA worker for a visual review.",
      "Thorough and predictable: use it after UI changes. Runs in the background (a few minutes): returns a job id, then poll job_status for the report.",
      "Only local or private URLs. It never clicks controls named like send, delete, rename, sign in/out, quit, stop. Screenshots are sent to DeepSeek for review, so don't run it on pages that show secrets.",
    ].join(" "),
    schema: {
      url: z.string().describe("Address of the running app, e.g. http://localhost:5173"),
      viewports: z.array(z.enum(["desktop", "tablet", "phone"])).optional().describe("Default: all three"),
      themes: z.array(z.enum(["dark", "light"])).optional().describe('Color scheme the browser asks for. Default: ["dark"]'),
      max_clicks_per_view: z.number().int().min(1).max(80).optional().describe("Default 25"),
      focus: z.string().optional().describe("What the reviewer should pay special attention to"),
      local_storage: z
        .record(z.string(), z.string())
        .optional()
        .describe('localStorage entries set before the page loads, e.g. to skip a first-run dialog. For Scriptorium itself use {"scriptorium.setupDone":"true"}'),
    },
    handler: async (
      args: {
        url: string;
        viewports?: ("desktop" | "tablet" | "phone")[];
        themes?: ("dark" | "light")[];
        max_clicks_per_view?: number;
        focus?: string;
        local_storage?: Record<string, string>;
      },
      ctx: ToolCtx,
    ): Promise<ToolResult> => {
      const bad = checkQaUrl(args.url);
      if (bad) return fail(bad);
      const worker = await pickQaWorker().catch((e: Error) => e);
      if (worker instanceof Error) return fail(worker.message);
      const job = startJob({
        worker,
        task: `QA sweep: ${args.url}`,
        caller: ctx.caller,
        run: () =>
          runQaSweep({
            url: args.url,
            viewports: args.viewports?.length ? args.viewports : ["desktop", "tablet", "phone"],
            themes: args.themes?.length ? args.themes : ["dark"],
            maxClicksPerView: args.max_clicks_per_view ?? 25,
            focus: args.focus ?? "",
            storage: args.local_storage,
            caller: ctx.caller,
          }),
      });
      return ok(`QA sweep started (job ${job.id}). It takes a few minutes; ask job_status with job_id "${job.id}" for the report.`);
    },
  },
  {
    name: "qa_explore",
    description: [
      "Exploratory UI test. A vision model drives a real headless browser like a human tester: it looks at the screen, decides what to click, type or hover next, works through controls it hasn't tried yet, and reports the problems it sees with steps to reproduce.",
      "Goes deeper than qa_sweep (menus, dialogs, multi-step flows, hover cards) but may skip things: use it for flows and hard-to-reach states, or after qa_sweep.",
      "Runs in the background: returns a job id, then poll job_status. Same safety rules as qa_sweep (local URLs only; never sends messages, deletes, renames, signs in/out or quits; never presses Enter in a text box).",
    ].join(" "),
    schema: {
      url: z.string().describe("Address of the running app"),
      goal: z.string().describe("What to explore and check, e.g. 'every menu and dialog of the chat panel on a phone'"),
      viewport: z.enum(["desktop", "tablet", "phone"]).optional().describe("Default desktop"),
      theme: z.enum(["dark", "light"]).optional().describe("Default dark"),
      max_steps: z.number().int().min(5).max(100).optional().describe("Default 40"),
      local_storage: z
        .record(z.string(), z.string())
        .optional()
        .describe('localStorage entries set before the page loads, e.g. to skip a first-run dialog. For Scriptorium itself use {"scriptorium.setupDone":"true"}'),
    },
    handler: async (
      args: {
        url: string;
        goal: string;
        viewport?: "desktop" | "tablet" | "phone";
        theme?: "dark" | "light";
        max_steps?: number;
        local_storage?: Record<string, string>;
      },
      ctx: ToolCtx,
    ): Promise<ToolResult> => {
      const bad = checkQaUrl(args.url);
      if (bad) return fail(bad);
      const worker = await pickQaWorker().catch((e: Error) => e);
      if (worker instanceof Error) return fail(worker.message);
      const job = startJob({
        worker,
        task: `QA explore: ${args.goal}`,
        caller: ctx.caller,
        run: () =>
          runQaExplore({
            url: args.url,
            goal: args.goal,
            viewport: args.viewport ?? "desktop",
            theme: args.theme ?? "dark",
            maxSteps: args.max_steps ?? 40,
            storage: args.local_storage,
            caller: ctx.caller,
          }),
      });
      return ok(`QA explore started (job ${job.id}). Ask job_status with job_id "${job.id}" for the report.`);
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
      tool(t.name, t.description, t.schema, (args: any) => t.handler(args, ctx), { alwaysLoad: true, annotations: WORKER_TOOL_ANNOTATIONS }),
    ),
  });
}
