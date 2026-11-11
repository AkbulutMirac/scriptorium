/**
 * Scriptorium benchmark: runs the same coding tasks with Claude alone (A) and with the Scriptorium team (B),
 * grades each result with hidden tests the agent never sees, and records what each session cost.
 *
 *   npx tsx --env-file-if-exists=.env bench/run.ts --config A            # Claude alone
 *   npx tsx --env-file-if-exists=.env bench/run.ts --config B            # Claude + Scriptorium (needs Scriptorium running)
 *   npx tsx --env-file-if-exists=.env bench/run.ts --usage               # subscription limits and DeepSeek balance only
 *
 * Options: --suite v2 (bench/tasks-v2)  --tasks a,b  --model opus  --label name  --effort high  --prompt-suffix file
 *
 * Costs come from each session's own result message (modelUsage covers the main loop and every subagent),
 * so other Claude sessions on the same account don't mix into the numbers. Subscription utilization and the
 * DeepSeek balance are recorded before and after a run as a second, coarser check.
 */
import { query, type HookCallbackMatcher, type HookEvent, type ModelUsage, type SDKMessage } from "@anthropic-ai/claude-agent-sdk";
import { execFileSync, spawnSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { SYSTEM_APPEND } from "../server/src/claude.js";
import { deepseekBalance } from "../server/src/llm.js";
import { TEAM_AGENTS } from "../server/src/team.js";

const BENCH = path.dirname(fileURLToPath(import.meta.url));
const FIXTURE = path.join(BENCH, "fixture");
const TASKS_DIR = path.join(BENCH, process.argv.includes("--suite") ? `tasks-${process.argv[process.argv.indexOf("--suite") + 1]}` : "tasks");
// Outside the repo (and outside OneDrive or other synced folders) so syncing never touches a run
const WORK = path.join(os.tmpdir(), "scriptorium-bench");
const RESULTS = path.join(BENCH, "results");
const SCRIPTORIUM = `http://127.0.0.1:${process.env.PORT || 7777}`;
const TASK_TIMEOUT_MS = 30 * 60_000;

const args = process.argv.slice(2);
const opt = (name: string, def?: string) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : def;
};

type Snapshot = { at: string; fiveHour?: number | null; sevenDay?: number | null; deepseekUsd?: number };

/** Subscription limits (same experimental call the app uses) and the DeepSeek balance */
async function snapshot(): Promise<Snapshot> {
  const q = query({
    prompt: (async function* () {
      await new Promise(() => {});
    })() as never,
    options: { settingSources: [], persistSession: false, tools: [] },
  });
  let fiveHour: number | null | undefined;
  let sevenDay: number | null | undefined;
  try {
    const u = (await q.usage_EXPERIMENTAL_MAY_CHANGE_DO_NOT_RELY_ON_THIS_API_YET({ skipBehaviors: true })) as {
      rate_limits?: Record<string, { utilization: number | null } | null> | null;
    };
    fiveHour = u.rate_limits?.five_hour?.utilization;
    sevenDay = u.rate_limits?.seven_day?.utilization;
  } catch {
    /* not available */
  }
  q.close();
  const b = await deepseekBalance();
  return { at: new Date().toISOString(), fiveHour, sevenDay, deepseekUsd: b.ok ? b.total : undefined };
}

/** In config B the session reports its subagents to the running Scriptorium (office, history, report request) */
const forwardHook: HookCallbackMatcher = {
  hooks: [
    async (input) => {
      try {
        const res = await fetch(`${SCRIPTORIUM}/hooks`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(input), signal: AbortSignal.timeout(5000) });
        return (await res.json()) as never;
      } catch {
        return {};
      }
    },
  ],
};
const B_HOOKS: Partial<Record<HookEvent, HookCallbackMatcher[]>> = {
  PreToolUse: [{ matcher: "Agent|Task|mcp__scriptorium__build", ...forwardHook }],
  PostToolUse: [{ matcher: "Agent|Task", ...forwardHook }],
  PostToolUseFailure: [{ matcher: "Agent|Task", ...forwardHook }],
  SubagentStop: [forwardHook],
  UserPromptSubmit: [forwardHook],
};

/** Recursive copy (fs.cpSync crashes Node in some synced folders on Windows) */
function copyDir(from: string, to: string) {
  mkdirSync(to, { recursive: true });
  for (const e of readdirSync(from, { withFileTypes: true })) {
    const src = path.join(from, e.name);
    const dst = path.join(to, e.name);
    if (e.isDirectory()) copyDir(src, dst);
    else copyFileSync(src, dst);
  }
}

function git(cwd: string, ...a: string[]) {
  execFileSync("git", ["-c", "user.name=bench", "-c", "user.email=bench@example.invalid", ...a], { cwd, stdio: "ignore" });
}

/** Runs a test file or the project's suite and returns pass/fail counts from node's TAP summary */
function runTests(cwd: string, cmd: string[]): { pass: number; fail: number } {
  const r = spawnSync(cmd[0], cmd.slice(1), { cwd, encoding: "utf8", shell: process.platform === "win32", timeout: 120_000 });
  const out = `${r.stdout}\n${r.stderr}`;
  const num = (k: string) => Number(new RegExp(`^# ${k} (\\d+)`, "m").exec(out)?.[1] ?? 0);
  return { pass: num("pass"), fail: num("fail") };
}

type RunResult = {
  config: string;
  task: string;
  model: string;
  ok: boolean;
  error?: string;
  durationMs: number;
  turns?: number;
  costUsd?: number;
  modelUsage?: Record<string, ModelUsage>;
  tools: Record<string, number>;
  subagents: Record<string, number>;
  hidden: { pass: number; fail: number };
  ownTests: { pass: number; fail: number };
  summary?: string;
  /** Builder sessions (the build tool), from Scriptorium's DeepSeek history */
  builds: Build[];
  deepseekUsd: number;
  reports: { who: string; text: string }[];
};

type Build = { model: string; turns: number; seconds: number; input: number; cached: number; output: number; usd: number; checksPassed: boolean };

/**
 * DeepSeek prices per 1M tokens, off-peak (api-docs.deepseek.com/quick_start/pricing, November 2026). Peak hours
 * (01-04 and 06-10 UTC on weekdays) cost double.
 */
const DEEPSEEK_PRICE: Record<string, { hit: number; miss: number; out: number }> = {
  "deepseek-v4-pro": { hit: 0.022, miss: 0.66, out: 1.98 },
  "deepseek-flash": { hit: 0.003, miss: 0.15, out: 0.6 },
};
const isPeak = (d: Date) => d.getUTCDay() >= 1 && d.getUTCDay() <= 5 && ((d.getUTCHours() >= 1 && d.getUTCHours() < 4) || (d.getUTCHours() >= 6 && d.getUTCHours() < 10));
const CHATS = path.join(BENCH, "..", "server", "data", "chats");

/**
 * The builds a run's workspace got, from Scriptorium's DeepSeek history: exact token counts, and it also covers
 * background builds whose report reached Claude through job_status. The office label is the workspace folder's
 * name, which is unique per run.
 */
function historyFor(workspace: string, since: number): { builds: Build[]; reports: { who: string; text: string }[] } {
  const label = path.basename(workspace);
  const builds: Build[] = [];
  const reports: { who: string; text: string }[] = [];
  for (const f of readdirSync(CHATS).filter((f) => f.endsWith(".json"))) {
    const chat = JSON.parse(readFileSync(path.join(CHATS, f), "utf8")) as {
      workerId: string;
      from?: { label?: string };
      updatedAt: number;
      messages: { content: string; model?: string; usage?: { prompt: number; completion: number; cacheHit?: number } }[];
    };
    const answer = chat.messages[1];
    if (chat.from?.label !== label || chat.updatedAt < since || !answer) continue;
    // Subagents (reviewer, security reviewer) also report here, also when they ran in the background
    if (!chat.workerId.startsWith("deepseek")) {
      reports.push({ who: chat.workerId, text: answer.content.slice(0, 6000) });
      continue;
    }
    if (!answer.usage || !answer.content.includes("Checked by Scriptorium")) continue;
    const m = /Session: \S+, (\d+) turns, (\d+)s/.exec(answer.content);
    const { prompt: input, completion: output, cacheHit: cached = 0 } = answer.usage;
    const p = DEEPSEEK_PRICE[answer.model ?? ""] ?? DEEPSEEK_PRICE["deepseek-v4-pro"];
    const usd = (((input - cached) * p.miss + cached * p.hit + output * p.out) / 1e6) * (isPeak(new Date(chat.updatedAt)) ? 2 : 1);
    builds.push({ model: answer.model ?? "?", turns: Number(m?.[1] ?? 0), seconds: Number(m?.[2] ?? 0), input, cached, output, usd, checksPassed: !/: FAILED \(exit/.test(answer.content) });
  }
  return { builds, reports };
}

type Config = "A" | "B" | "C" | "D";

/** What the task adds for C (Claude leads, the builder builds) and D (the whole team, checks included) */
const TEAM_PROMPTS: Partial<Record<Config, string>> = {
  C: "Use your Scriptorium team for this: plan the change, hand the building to the builder (the build tool), and read its report instead of the code.",
  D:
    "Use your whole Scriptorium team for this: plan the change and hand the building to the builder (the build tool). When its report is in, have the reviewer check the change, " +
    "and the security reviewer as well if the change handles file paths or user input. Fix what they mark as must fix (yourself or with the builder) before you reply.",
};

/** A task is a folder in the --suite, or "<suite>/<task>" for one from another suite */
const taskDir = (task: string) => (task.includes("/") ? path.join(BENCH, `tasks-${task.split("/")[0]}`, task.split("/")[1]) : path.join(TASKS_DIR, task));

async function runTask(config: Config, taskId: string, model: string, effort: string, label: string): Promise<RunResult> {
  const task = path.basename(taskId);
  const dir = taskDir(taskId);
  // The folder name is also the office label of its builds (see historyFor), so it carries the run's label
  const ws = path.join(WORK, label, `${label}-${config}-${task}`);
  rmSync(ws, { recursive: true, force: true });
  mkdirSync(path.dirname(ws), { recursive: true });
  copyDir(FIXTURE, ws);
  git(ws, "init", "-q");
  git(ws, "add", "-A");
  git(ws, "commit", "-q", "-m", "Initial project");

  const prompt = `${readFileSync(path.join(dir, "task.md"), "utf8").trim()}\n\nWork in the current folder. When you are done, reply with a short summary of what you changed.${TEAM_PROMPTS[config] ? `\n\n${TEAM_PROMPTS[config]}` : ""}`;
  const tools: Record<string, number> = {};
  const subagents: Record<string, number> = {};
  const started = Date.now();
  const abort = new AbortController();
  const timer = setTimeout(() => abort.abort(), TASK_TIMEOUT_MS);
  let result: Extract<SDKMessage, { type: "result" }> | undefined;
  let error: string | undefined;

  try {
    const q = query({
      prompt,
      options: {
        cwd: ws,
        model,
        effort: effort as never,
        // Same clean base for both configs: no user CLAUDE.md, plugins or MCP servers
        settingSources: [],
        persistSession: false,
        abortController: abort,
        systemPrompt: config !== "A" ? { type: "preset", preset: "claude_code", append: SYSTEM_APPEND } : { type: "preset", preset: "claude_code" },
        ...(config !== "A"
          ? { mcpServers: { scriptorium: { type: "http" as const, url: `${SCRIPTORIUM}/mcp` } }, agents: TEAM_AGENTS, hooks: B_HOOKS }
          : {}),
        // Unattended run inside a throwaway copy of the fixture
        canUseTool: async (_name, input) => ({ behavior: "allow", updatedInput: input }),
      },
    });
    for await (const msg of q) {
      if (msg.type === "assistant") {
        if (process.env.BENCH_TRACE) {
          const u = msg.message.usage as { cache_read_input_tokens?: number; cache_creation_input_tokens?: number; output_tokens?: number; input_tokens?: number };
          console.log(`  trace ${config}-${task} ${msg.parent_tool_use_id ? "sub" : "main"} read ${u?.cache_read_input_tokens} write ${u?.cache_creation_input_tokens} in ${u?.input_tokens} out ${u?.output_tokens}`);
        }
        for (const block of (msg.message.content ?? []) as { type: string; id?: string; name?: string; input?: { subagent_type?: string; model?: string } }[]) {
          if (block.type !== "tool_use" || !block.name) continue;
          tools[block.name] = (tools[block.name] ?? 0) + 1;
          if (block.name === "Agent" || block.name === "Task") {
            const who = block.input?.subagent_type || block.input?.model || "general";
            subagents[who] = (subagents[who] ?? 0) + 1;
          }
        }
      }
      if (msg.type === "result") result = msg;
    }
  } catch (err) {
    error = err instanceof Error ? err.message : String(err);
  } finally {
    clearTimeout(timer);
  }

  // Grade with the hidden tests, which the agent never saw
  const hiddenDir = path.join(ws, ".bench-hidden", task);
  mkdirSync(hiddenDir, { recursive: true });
  copyFileSync(path.join(dir, "hidden.test.js"), path.join(hiddenDir, "hidden.test.js"));
  const hidden = runTests(ws, ["node", "--test", `.bench-hidden/${task}/hidden.test.js`]);
  const ownTests = runTests(ws, ["npm", "test"]);
  const { builds, reports } = config === "A" ? { builds: [], reports: [] } : historyFor(ws, started);

  return {
    config,
    task,
    model,
    ok: !!result && result.subtype === "success" && !error,
    error: error ?? (result && result.subtype !== "success" ? result.subtype : undefined),
    durationMs: Date.now() - started,
    turns: result?.num_turns,
    costUsd: result?.total_cost_usd,
    modelUsage: result?.modelUsage,
    tools,
    subagents,
    hidden,
    ownTests,
    summary: result && "result" in result ? String(result.result).slice(0, 1500) : undefined,
    builds,
    deepseekUsd: builds.reduce((s, b) => s + b.usd, 0),
    reports,
  };
}

async function main() {
  if (args.includes("--usage")) {
    console.log(JSON.stringify(await snapshot(), null, 2));
    return;
  }
  // --configs A,C,D starts them together, so they all see the same prompt-cache state
  const configs = (opt("configs") ?? opt("config") ?? "").split(",").filter(Boolean) as Config[];
  if (!configs.length || configs.some((c) => !["A", "B", "C", "D"].includes(c))) throw new Error("--config or --configs: A, B, C or D");
  const model = opt("model", "opus")!;
  const effort = opt("effort", "high")!;
  const label = opt("label", new Date().toISOString().slice(0, 10))!;
  const tasks = (opt("tasks") ?? readdirSync(TASKS_DIR).join(",")).split(",").filter((t) => existsSync(path.join(taskDir(t), "task.md")));
  if (configs.some((c) => c !== "A")) {
    const up = await fetch(`${SCRIPTORIUM}/api/health`).then((r) => r.ok).catch(() => false);
    if (!up) throw new Error(`Scriptorium is not running at ${SCRIPTORIUM}; configs B, C and D need it.`);
  }

  const outDir = path.join(RESULTS, label);
  mkdirSync(outDir, { recursive: true });
  const tag = configs.join("");
  const before = await snapshot();
  console.log(`[${tag}] before`, JSON.stringify(before));
  console.log(`[${tag}] tasks`, tasks.join(", "));
  const started = Date.now();
  // Everything runs in parallel; each session's cost is its own, so they don't mix
  const runs = await Promise.all(
    configs.flatMap((config) =>
      tasks.map(async (t) => {
        const r = await runTask(config, t, model, effort, label);
        writeFileSync(path.join(outDir, `${config}-${r.task}.json`), JSON.stringify(r, null, 2));
        console.log(`[${config}] ${r.task}: hidden ${r.hidden.pass}/${r.hidden.pass + r.hidden.fail}, $${r.costUsd?.toFixed(3)}, DeepSeek $${r.deepseekUsd.toFixed(3)} (${r.builds.length} builds), ${Math.round(r.durationMs / 1000)}s, subagents ${JSON.stringify(r.subagents)}${r.error ? `, error ${r.error}` : ""}`);
        return r;
      }),
    ),
  );
  const after = await snapshot();
  console.log(`[${tag}] after`, JSON.stringify(after));
  for (const config of configs) {
    const own = runs.filter((r) => r.config === config);
    writeFileSync(
      path.join(outDir, `${config}-summary.json`),
      JSON.stringify({ config, ranWith: configs, model, effort, tasks, wallMs: Date.now() - started, before, after, runs: own.map((r) => ({ task: r.task, hidden: r.hidden, costUsd: r.costUsd, deepseekUsd: r.deepseekUsd })) }, null, 2),
    );
  }
}

main().then(
  () => process.exit(0),
  (err) => {
    console.error(err instanceof Error ? err.message : err);
    process.exit(1);
  },
);
