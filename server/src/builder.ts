import { query, type CanUseTool, type HookCallbackMatcher, type HookEvent, type ModelUsage } from "@anthropic-ai/claude-agent-sdk";
import { spawn } from "node:child_process";
import { existsSync, readFileSync, realpathSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { Worker } from "./agents.js";
import { config, SERVER_ROOT } from "./config.js";
import type { WorkerCaller } from "./protocol.js";
import { setRequestTask, withWorkerSlot } from "./requests.js";
import { saveDelegatedTask } from "./workerChats.js";

/**
 * The builder: a headless Claude Code session that runs on DeepSeek instead of Claude. Claude hands it a job
 * with one tool call; it reads the project, writes the change, runs the tests, fixes until they pass and
 * reports. The read-edit-test loop then costs DeepSeek tokens instead of Claude's.
 *
 * It is locked down: its process never sees Claude's login (fresh environment, empty config folder), it can only
 * read and write inside the project folder, and the only shell commands it can run are the exact test commands
 * Claude passed.
 */

const DEEPSEEK_ANTHROPIC_URL = "https://api.deepseek.com/anthropic";
const MAX_TURNS = 80;
const MAX_MS = 30 * 60_000;
const TEST_TIMEOUT_MS = 5 * 60_000;

/**
 * DeepSeek takes Claude model names: claude-opus* runs on deepseek-v4-pro, everything else on deepseek-flash
 * (api-docs.deepseek.com/guides/anthropic_api). A name Claude Code knows also turns on effort and thinking.
 */
const sessionModel = (worker: Worker) => (worker.model.includes("pro") ? "claude-opus-5-5" : "claude-sonnet-5-5");

/** The builder's role (agents/builder.md without its frontmatter) */
const ROLE = readFileSync(path.join(SERVER_ROOT, "..", "agents", "builder.md"), "utf8")
  .replace(/\r\n/g, "\n")
  .replace(/^---\n[\s\S]*?\n---\n/, "")
  .trim();

/**
 * Environment variables passed on to the session: only what a process needs to run (paths, temp folders, the
 * Windows basics). Nothing else from Scriptorium's own environment, so no Claude or other keys.
 */
const KEEP_ENV = new Set(
  [
    "PATH", "PATHEXT", "SYSTEMROOT", "WINDIR", "COMSPEC", "SYSTEMDRIVE", "TEMP", "TMP", "TMPDIR", "HOME", "USERPROFILE",
    "HOMEDRIVE", "HOMEPATH", "APPDATA", "LOCALAPPDATA", "PROGRAMFILES", "PROGRAMFILES(X86)", "PROGRAMW6432",
    "COMMONPROGRAMFILES", "PROGRAMDATA", "NUMBER_OF_PROCESSORS", "PROCESSOR_ARCHITECTURE", "OS", "LANG", "LC_ALL",
    "TERM", "SHELL", "USER", "USERNAME", "LOGNAME", "CLAUDE_CODE_GIT_BASH_PATH",
  ],
);

function baseEnv(): Record<string, string> {
  const env: Record<string, string> = {};
  for (const [k, v] of Object.entries(process.env)) if (v !== undefined && KEEP_ENV.has(k.toUpperCase())) env[k] = v;
  return env;
}

function sessionEnv(configDir: string): Record<string, string> {
  return {
    ...baseEnv(),
    ANTHROPIC_BASE_URL: DEEPSEEK_ANTHROPIC_URL,
    ANTHROPIC_API_KEY: config.deepseekApiKey,
    // Own empty config folder: no login, settings, history or MCP servers of the user's Claude Code
    CLAUDE_CONFIG_DIR: configDir,
    // No update checks, telemetry or error reports to Anthropic
    CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: "1",
  };
}

// ---------------------------------------------------------------------------------------------------------------
// What the session may do

const TOOLS = ["Read", "Grep", "Glob", "Edit", "Write", "Bash"];
/** .env files hold secrets; .env.example is a template and fine to read */
const SECRET_FILE = /^\.env(\..+)?$/i;

function within(root: string, abs: string): boolean {
  const rel = path.relative(root, abs);
  return rel === "" || (!rel.startsWith("..") && !path.isAbsolute(rel));
}

/** Is the path inside the folder, also after following links (checked on the nearest part that exists)? */
function inside(root: string, realRoot: string, p: unknown): boolean {
  if (typeof p !== "string" || !p) return false;
  const abs = path.resolve(root, p);
  if (!within(root, abs)) return false;
  let probe = abs;
  while (!existsSync(probe) && path.dirname(probe) !== probe) probe = path.dirname(probe);
  try {
    return within(realRoot, realpathSync(probe));
  } catch {
    return false;
  }
}

type Policy = { root: string; realRoot: string; commands: string[] };

/** Returns why the call is refused, or undefined if it may run */
function refuse(policy: Policy, tool: string, input: Record<string, unknown>): string | undefined {
  const outside = `Only files inside ${policy.root} are available.`;
  switch (tool) {
    case "Read":
    case "Edit":
    case "Write": {
      if (!inside(policy.root, policy.realRoot, input.file_path)) return outside;
      if (SECRET_FILE.test(path.basename(String(input.file_path))) && !/\.example$/i.test(String(input.file_path))) return ".env files are off limits.";
      return undefined;
    }
    case "Grep":
    case "Glob": {
      if (input.path !== undefined && !inside(policy.root, policy.realRoot, input.path)) return outside;
      const pattern = String(input.pattern ?? "");
      if (tool === "Glob" && (path.isAbsolute(pattern) || pattern.split(/[\\/]/).includes(".."))) return outside;
      return undefined;
    }
    case "Bash": {
      const command = String(input.command ?? "").trim();
      if (policy.commands.includes(command)) return undefined;
      return `Only these exact commands can run: ${policy.commands.map((c) => `\`${c}\``).join(", ")}. Use Read, Grep, Glob, Edit and Write for everything else.`;
    }
    default:
      return `${tool} is not available here.`;
  }
}

// ---------------------------------------------------------------------------------------------------------------
// Checking the result: Scriptorium reruns the test commands itself

/** Git Bash on Windows (the shell the session's Bash tool uses), so commands behave the same in both places */
function findBash(): string | undefined {
  if (process.platform !== "win32") return "/bin/sh";
  if (process.env.CLAUDE_CODE_GIT_BASH_PATH && existsSync(process.env.CLAUDE_CODE_GIT_BASH_PATH)) return process.env.CLAUDE_CODE_GIT_BASH_PATH;
  for (const dir of (process.env.PATH ?? "").split(path.delimiter)) {
    if (!existsSync(path.join(dir, "git.exe"))) continue;
    for (const up of ["..", path.join("..", "..")]) {
      const bash = path.resolve(dir, up, "bin", "bash.exe");
      if (existsSync(bash)) return bash;
    }
  }
  return undefined;
}

type TestRun = { command: string; code: number | null; tail: string };

function runCommand(command: string, cwd: string): Promise<TestRun> {
  return new Promise((resolve) => {
    const bash = findBash();
    // Same clean environment as the session, without the DeepSeek key
    const child = bash
      ? spawn(bash, ["-c", command], { cwd, env: baseEnv(), windowsHide: true })
      : spawn(command, { cwd, env: baseEnv(), shell: true, windowsHide: true });
    let out = "";
    const add = (d: Buffer) => {
      out = (out + d.toString("utf8")).slice(-20_000);
    };
    child.stdout.on("data", add);
    child.stderr.on("data", add);
    const timer = setTimeout(() => child.kill(), TEST_TIMEOUT_MS);
    const done = (code: number | null) => {
      clearTimeout(timer);
      const lines = out.trimEnd().split(/\r?\n/);
      resolve({ command, code, tail: lines.slice(code === 0 ? -6 : -40).join("\n") });
    };
    child.on("close", done);
    child.on("error", (err) => {
      out += `\n${err.message}`;
      done(null);
    });
  });
}

// ---------------------------------------------------------------------------------------------------------------

const k = (n: number) => (n >= 1_000_000 ? `${(n / 1_000_000).toFixed(1)}M` : n >= 1000 ? `${Math.round(n / 1000)}K` : String(n));

/** Short label for the office: what the session is doing right now */
function activity(tool: string, input: Record<string, unknown>, root: string): string {
  const file = typeof input.file_path === "string" ? path.relative(root, path.resolve(root, input.file_path)).replaceAll("\\", "/") : "";
  if (tool === "Bash") return `running ${String(input.command ?? "")}`;
  if (tool === "Edit" || tool === "Write") return `writing ${file}`;
  if (tool === "Read") return `reading ${file}`;
  return `searching ${String(input.pattern ?? "")}`;
}

// ---------------------------------------------------------------------------------------------------------------
// One build per folder: two builders in the same folder would overwrite each other's files

const busyFolders = new Set<string>();
const folderKey = (dir: string) => {
  const abs = path.resolve(dir);
  return process.platform === "win32" ? abs.toLowerCase() : abs;
};

/** Claims the folder for a build. Returns the function that frees it, or why it can't be claimed. */
export function claimFolder(dir: string): (() => void) | string {
  const key = folderKey(dir);
  if (busyFolders.has(key)) {
    return `A build is already running in ${path.resolve(dir)}. Wait for its report (job_status waits for a background build) instead of starting another one.`;
  }
  busyFolders.add(key);
  return () => busyFolders.delete(key);
}

// ---------------------------------------------------------------------------------------------------------------
// The user's own words: Claude Code hooks pass each session's latest message on to its build calls, so Claude
// doesn't have to retell the request

export const BUILD_TOOL = "mcp__scriptorium__build";
const MAX_REQUEST_CHARS = 20_000;
const latestPrompt = new Map<string, string>();
const SYSTEM_NOTICE = /^\s*<(task-notification|system-reminder|command-name|command-message|local-command-stdout|local-command-stderr|bash-input|bash-stdout|bash-stderr)>/;

/** UserPromptSubmit: remember the message. PreToolUse of the build tool: add it to the call as user_request. */
export function handleBuildHook(input: { hook_event_name?: string; session_id?: string; prompt?: unknown; tool_name?: string; tool_input?: unknown }): Record<string, unknown> {
  if (!input.session_id) return {};
  if (input.hook_event_name === "UserPromptSubmit") {
    // Claude Code also delivers its own notices this way (a background agent finished, a command's output): not the user's words
    if (typeof input.prompt !== "string" || SYSTEM_NOTICE.test(input.prompt)) return {};
    latestPrompt.delete(input.session_id);
    latestPrompt.set(input.session_id, input.prompt.slice(0, MAX_REQUEST_CHARS));
    if (latestPrompt.size > 500) latestPrompt.delete(latestPrompt.keys().next().value!);
    return {};
  }
  if (input.hook_event_name !== "PreToolUse" || input.tool_name !== BUILD_TOOL) return {};
  const request = latestPrompt.get(input.session_id);
  const args = input.tool_input as Record<string, unknown> | undefined;
  if (!request || !args || args.user_request) return {};
  return { hookSpecificOutput: { hookEventName: "PreToolUse", updatedInput: { ...args, user_request: request } } };
}

// ---------------------------------------------------------------------------------------------------------------

export async function runBuild(args: {
  worker: Worker;
  task: string;
  /** The user's latest message to the lead, added by handleBuildHook */
  userRequest?: string;
  projectDir: string;
  testCommands: string[];
  files?: string[];
  thinking?: "low" | "high" | "max";
  caller: WorkerCaller;
}): Promise<string> {
  const { worker } = args;
  if (!config.deepseekApiKey) throw new Error("DEEPSEEK_API_KEY is not set. Add it to the .env file.");
  const root = path.resolve(args.projectDir);
  if (!existsSync(root)) throw new Error(`No such folder: ${root}`);
  const commands = [...new Set(args.testCommands.map((c) => c.trim()).filter(Boolean))];
  if (!commands.length) throw new Error("Give at least one test command.");
  const policy: Policy = { root, realRoot: realpathSync(root), commands };
  const title = args.task.trim().split("\n")[0].slice(0, 80);

  const prompt = [
    args.userRequest?.trim() ? `## The user's request to the lead\n\n${args.userRequest.trim()}\n\n## The lead's instructions` : "",
    args.task.trim(),
    `Test commands: ${commands.map((c) => `\`${c}\``).join(", ")}`,
    args.files?.length ? `Start by reading: ${args.files.join(", ")}` : "",
  ]
    .filter(Boolean)
    .join("\n\n");
  const system = ROLE.replaceAll("{project_dir}", root).replaceAll("{commands}", commands.map((c) => `\`${c}\``).join(", "));

  return withWorkerSlot(worker, { task: `Build: ${title}`, caller: args.caller }, async (req) => {
    const configDir = await mkdtemp(path.join(os.tmpdir(), "scriptorium-builder-"));
    const written = new Set<string>();
    const abort = new AbortController();
    const timer = setTimeout(() => abort.abort(), MAX_MS);
    const started = Date.now();
    let report = "";
    let stopped = "";
    let turns = 0;
    let usage: Record<string, ModelUsage> = {};

    // The hook sees every tool call, also the ones Claude Code would allow without asking (reads inside the folder)
    const guard: HookCallbackMatcher = {
      hooks: [
        async (input) => {
          if (input.hook_event_name !== "PreToolUse") return {};
          const toolInput = (input.tool_input ?? {}) as Record<string, unknown>;
          const why = refuse(policy, input.tool_name, toolInput);
          if (why) return { hookSpecificOutput: { hookEventName: "PreToolUse", permissionDecision: "deny", permissionDecisionReason: why } };
          setRequestTask(req, `Build: ${title} · ${activity(input.tool_name, toolInput, root)}`);
          if ((input.tool_name === "Edit" || input.tool_name === "Write") && typeof toolInput.file_path === "string") {
            written.add(path.relative(root, path.resolve(root, toolInput.file_path)).replaceAll("\\", "/"));
          }
          return {};
        },
      ],
    };
    const hooks: Partial<Record<HookEvent, HookCallbackMatcher[]>> = { PreToolUse: [guard] };
    const canUseTool: CanUseTool = async (tool, input) => {
      const why = refuse(policy, tool, input);
      return why ? { behavior: "deny", message: why } : { behavior: "allow", updatedInput: input };
    };

    try {
      const q = query({
        prompt,
        options: {
          cwd: root,
          model: sessionModel(worker),
          effort: args.thinking ?? "low",
          env: sessionEnv(configDir),
          pathToClaudeCodeExecutable: config.claudeCodePath,
          systemPrompt: { type: "preset", preset: "claude_code", append: system },
          tools: TOOLS,
          settingSources: [],
          mcpServers: {},
          strictMcpConfig: true,
          agents: {},
          persistSession: false,
          maxTurns: MAX_TURNS,
          hooks,
          canUseTool,
          abortController: abort,
        },
      });
      for await (const msg of q) {
        if (msg.type === "assistant" && !msg.parent_tool_use_id) {
          turns++;
          const text = (msg.message.content as { type: string; text?: string }[]).filter((b) => b.type === "text").map((b) => b.text).join("\n").trim();
          if (text) report = text;
        }
        if (msg.type === "result") {
          usage = msg.modelUsage ?? {};
          turns = msg.num_turns || turns;
          // The model tends to copy the report template's code fence
          if (msg.subtype === "success") report = (msg.result || report).replace(/```\w*\n(Result:[\s\S]*?)\n```/, "$1");
          else stopped = msg.subtype === "error_max_turns" ? `turn limit (${MAX_TURNS}) reached` : msg.subtype;
        }
      }
    } catch (err) {
      stopped = abort.signal.aborted ? `time limit (${MAX_MS / 60_000} min) reached` : err instanceof Error ? err.message : String(err);
    } finally {
      clearTimeout(timer);
      await rm(configDir, { recursive: true, force: true }).catch(() => {});
    }

    setRequestTask(req, `Build: ${title} · checking the tests`);
    const checks: TestRun[] = [];
    for (const c of commands) checks.push(await runCommand(c, root));

    const totals = Object.values(usage).reduce(
      (t, u) => ({ input: t.input + u.inputTokens + u.cacheReadInputTokens + u.cacheCreationInputTokens, cached: t.cached + u.cacheReadInputTokens, output: t.output + u.outputTokens }),
      { input: 0, cached: 0, output: 0 },
    );
    const lines = [
      stopped ? `Result: Stopped (${stopped}). The builder's last words:\n${report || "(none)"}` : report || "Result: Blocked\nOpen: the builder ended without a report.",
      "",
      "Checked by Scriptorium after the session:",
      ...checks.map((c) => `- \`${c.command}\`: ${c.code === 0 ? "passed" : `FAILED (exit ${c.code ?? "none"})`}\n\`\`\`\n${c.tail.replaceAll("```", "'''")}\n\`\`\``),
      `Files the builder wrote: ${written.size ? [...written].join(", ") : "none"}`,
      `Session: ${worker.model}, ${turns} turns, ${Math.round((Date.now() - started) / 1000)}s, input ${k(totals.input)} (cached ${k(totals.cached)}), output ${k(totals.output)}`,
    ];
    const answer = lines.join("\n");
    await saveDelegatedTask({
      workerId: worker.id,
      // The first line is the chat's title in the history
      task: `Build: ${title}\n\n${prompt}`,
      label: args.caller.label,
      answer,
      usage: { prompt: totals.input, completion: totals.output, cacheHit: totals.cached || undefined },
      model: worker.model,
      error: !!stopped,
    }).catch(() => {});
    return answer;
  });
}
