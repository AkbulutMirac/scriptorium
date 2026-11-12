import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { loadWorkers, type Worker } from "../agents.js";
import { SERVER_ROOT } from "../config.js";
import { chat, clientFor, supportsVision } from "../llm.js";
import type { WorkerCaller } from "../protocol.js";
import { setRequestTask, withWorkerSlot } from "../requests.js";
import { runExplore } from "./explore.js";
import { isLocalQaHost } from "./hosts.js";
import { runSweep, type Shot } from "./sweep.js";
import { DEFAULT_DENY, type QaIssue, type QaReport, type Theme, type ViewportName } from "./types.js";

/**
 * Glue for the two QA tools. Both drive a real (headless) Edge/Chrome on this computer; screenshots are
 * reviewed by a vision worker (the "qa" worker if it exists). Reports and screenshots go to server/data/qa/.
 */

const QA_DIR = path.join(SERVER_ROOT, "data", "qa");

/** Only local and private addresses: the tools really click, so they must not roam the public web */
export function checkQaUrl(url: string): string | null {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return "Not a valid URL.";
  }
  if (u.protocol !== "http:" && u.protocol !== "https:") return "Only http and https URLs.";
  return isLocalQaHost(u.hostname) ? null : "QA tools only test local or private addresses (localhost, a private IP address, a .localhost or .test name, or a remote address set up for Scriptorium).";
}

/** The reviewer: a worker with vision, preferring the one called "qa" */
export async function pickQaWorker(): Promise<Worker> {
  const workers = await loadWorkers();
  const ordered = [...workers.filter((w) => w.id === "qa"), ...workers.filter((w) => w.id !== "qa" && w.provider === "deepseek")];
  for (const w of ordered) if (await supportsVision(w)) return w;
  throw new Error('No worker that can read images. Add a "qa" worker on deepseek-flash (or another vision model).');
}

async function newRunDir(mode: string): Promise<string> {
  const stamp = new Date().toISOString().replace(/[:T]/g, "-").slice(0, 19);
  const dir = path.join(QA_DIR, `${stamp}-${mode}`);
  await mkdir(dir, { recursive: true });
  return dir;
}

/** Sends a batch of screenshots to the vision worker and turns its answer into issues */
async function judgeShots(worker: Worker, dir: string, shots: Shot[], focus: string): Promise<QaIssue[]> {
  const { readFile } = await import("node:fs/promises");
  const images = await Promise.all(shots.map((s) => readFile(path.join(dir, s.file))));
  const list = shots.map((s, i) => `${i + 1}. ${s.caption}`).join("\n");
  const prompt = [
    "You review screenshots of a web app for UI problems. The screenshots are numbered in this order:",
    list,
    focus ? `Focus: ${focus}` : "",
    'Answer with JSON only: {"issues":[{"shot":<number>,"severity":"high"|"medium"|"low","problem":"...","fix":"..."}]}.',
    "Report concrete, visible problems only (layout, overflow, cut-off or overlapping text, contrast, broken or empty states, inconsistent wording or spacing). Don't invent problems; an empty list is fine.",
  ]
    .filter(Boolean)
    .join("\n");
  const { content } = await chat(
    worker,
    [
      ...(worker.system ? [{ role: "system" as const, content: worker.system }] : []),
      {
        role: "user",
        content: [
          { type: "text", text: prompt },
          ...images.map((b) => ({ type: "image_url" as const, image_url: { url: `data:image/jpeg;base64,${b.toString("base64")}` } })),
        ],
      },
    ],
    { json: true },
  );
  try {
    const parsed = JSON.parse(content) as { issues?: { shot?: number; severity?: string; problem?: string; fix?: string }[] };
    return (parsed.issues ?? [])
      .filter((x) => x.problem)
      .map((x) => {
        const shot = shots[(x.shot ?? 1) - 1] ?? shots[0];
        const severity = x.severity === "high" || x.severity === "low" ? x.severity : "medium";
        return { severity, where: shot.caption, problem: String(x.problem), fix: x.fix, screenshot: shot.file, source: "model" as const };
      });
  } catch {
    return [{ severity: "low", where: "reviewer", problem: `The reviewer's answer was not valid JSON: ${content.slice(0, 200)}`, source: "check" }];
  }
}

/** Writes report.json and report.md and returns the short text the tool gives back to Claude */
async function writeReport(report: QaReport): Promise<string> {
  await writeFile(path.join(report.dir, "report.json"), JSON.stringify(report, null, 2), "utf8");
  const count = (s: string) => report.issues.filter((i) => i.severity === s).length;
  const line = (i: QaIssue) =>
    `- **${i.severity}** (${i.source === "check" ? "measured" : "seen"}) ${i.where}: ${i.problem}${i.fix ? ` → ${i.fix}` : ""}${i.screenshot ? ` [${i.screenshot}]` : ""}`;
  const md = [
    `# QA ${report.mode}: ${report.url}`,
    "",
    `${new Date(report.startedAt).toLocaleString("en-US")} · ${Math.round((report.finishedAt - report.startedAt) / 1000)} s · ${report.viewports.join(", ")}`,
    `Steps: ${report.stepsTaken} · clicked: ${report.elementsClicked} · elements seen: ${report.elementsSeen}`,
    "",
    report.summary,
    "",
    `## Issues (${report.issues.length}: ${count("high")} high, ${count("medium")} medium, ${count("low")} low)`,
    "",
    ...report.issues.map(line),
  ].join("\n");
  await writeFile(path.join(report.dir, "report.md"), md + "\n", "utf8");
  return [
    `QA ${report.mode} finished: ${report.issues.length} issues (${count("high")} high, ${count("medium")} medium, ${count("low")} low).`,
    `Clicked ${report.elementsClicked} of ${report.elementsSeen} elements in ${report.stepsTaken} steps (${report.viewports.join(", ")}).`,
    report.summary,
    `Report: ${path.join(report.dir, "report.md")} (screenshots in the same folder; open them to verify before fixing).`,
    "",
    ...report.issues.slice(0, 25).map(line),
    report.issues.length > 25 ? `…and ${report.issues.length - 25} more in report.md` : "",
  ]
    .filter((x) => x !== "")
    .join("\n");
}

export async function runQaSweep(args: {
  url: string;
  viewports: ViewportName[];
  themes: Theme[];
  maxClicksPerView: number;
  focus: string;
  storage?: Record<string, string>;
  caller: WorkerCaller;
}): Promise<string> {
  const worker = await pickQaWorker();
  const dir = await newRunDir("sweep");
  const startedAt = Date.now();
  return withWorkerSlot(worker, { task: `QA sweep: ${args.url}`, caller: args.caller }, async (req) => {
    const result = await runSweep({
      url: args.url,
      viewports: args.viewports,
      themes: args.themes,
      maxClicksPerView: args.maxClicksPerView,
      deny: DEFAULT_DENY,
      outDir: dir,
      storage: args.storage,
      judge: (shots) => {
        setRequestTask(req, `QA sweep: reviewing ${shots.length} screenshots`);
        return judgeShots(worker, dir, shots, args.focus);
      },
      onProgress: (text) => setRequestTask(req, `QA sweep · ${text}`),
    });
    const n = result.issues.length;
    const summary = `Clicked every visible control on the start screen of each view and reviewed the screenshots. ${n ? `${n} issues found.` : "No issues found."}`;
    return writeReport({ ...result, summary, dir, startedAt, finishedAt: Date.now() });
  });
}

export async function runQaExplore(args: {
  url: string;
  goal: string;
  viewport: ViewportName;
  theme: Theme;
  maxSteps: number;
  storage?: Record<string, string>;
  caller: WorkerCaller;
}): Promise<string> {
  const worker = await pickQaWorker();
  const dir = await newRunDir("explore");
  const startedAt = Date.now();
  return withWorkerSlot(worker, { task: `QA explore: ${args.goal}`, caller: args.caller }, async (req) => {
    const result = await runExplore({
      url: args.url,
      goal: args.goal,
      viewport: args.viewport,
      theme: args.theme,
      maxSteps: args.maxSteps,
      deny: DEFAULT_DENY,
      outDir: dir,
      storage: args.storage,
      client: clientFor(worker),
      model: worker.model,
      system: worker.system,
      onProgress: (text) => setRequestTask(req, `QA explore · ${text}`),
    });
    return writeReport({ ...result, dir, startedAt, finishedAt: Date.now() });
  });
}
