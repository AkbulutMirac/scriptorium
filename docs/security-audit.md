# Security audit: Scriptorium backend

- **Reviewed:** commit `c529061` (clean worktree), 2026-11-11
- **Method:** Cloudflare `security-audit` skill, scoped run. Source-only: no target code was executed (no OS sandbox meeting the skill's execution rules was available), nothing was probed live. Single reviewer; the skill's independent verification pass and JSON ledger were not run, so treat this as a first pass, not full coverage.
- **Scope:** the trust boundaries in `server/src`: HTTP + WebSocket server (`index.ts`), MCP server (`mcpHttp.ts`), hook endpoint `/hooks`, worker tools (`workerTools.ts`, `workerTasks.ts`), the DeepSeek builder (`builder.ts`), QA browser tools (`server/src/qa/`), setup (`setup.ts`), and `.env` / API-key handling. The web UI was read only where a server finding depended on it (`PermissionCard.tsx`, `store.ts`). `bench/` and `scripts/` are out of scope.

## Status after the fixes (2026-11-12)

| # | Status | What changed |
|---|---|---|
| H1 | **Partly fixed** | The builder session asks for Claude Code's sandbox (no network, writes only in the project, API key hidden) and falls back to none where it isn't available. On this Windows machine the SDK reports it unavailable ("feature gate off"), so the test commands still run builder-written code with the user's rights there; the report now says "Sandbox: off" and the tool description and README say so. Scriptorium no longer reruns the commands outside the session: the report carries the last run of each command as the shell returned it, flagged when files changed after it. Writes under `.git`, `.claude`, `.vscode`, `.husky`, `.github` are refused. |
| H2 | **Fixed** | Only `list_workers` and `job_status` are marked read-only and auto-allowed; `build`, `ask_worker`/`start_job` and the QA tools follow the session's permission mode (checked with a live session: `build` reached the permission callback, `list_workers` didn't). `project_dir` must be inside the session's folder when that folder is known. Images for `files` may still come from any path (screenshots live in temp folders). |
| M1 | **Partly fixed** | The 5173 origins are trusted only when the server runs with `--watch` (`npm run dev`); in normal use the WebSocket answers 401 to them. The per-launch token for `/ws`, `/mcp` and `/hooks` is still open. |
| M2 | **Fixed for named paths** | One secret check on normalized names (case, trailing dots and spaces, `:stream`) for Read, Edit, Write and Grep `path`. A directory-wide Grep isn't filtered. |
| L1 | **Fixed** | The host is parsed: `localhost`, `*.localhost`, `*.test`, private or loopback IP literals (incl. Tailscale's 100.64/10) and the configured remote hosts; other `*.ts.net` names no longer pass. Navigations to any other host are blocked in the browser, also after redirects. |
| L2 | **Fixed** | `click_xy` applies the same do-not-click check to the element at that point. |
| I1 | **Fixed** | Scriptorium's Claude sessions get their environment without `DEEPSEEK_API_KEY`. |
| I2 | Unchanged | Documented: the user's latest message goes to DeepSeek with `build`. |
| I3 | **Fixed** | The static file guard uses `path.relative`. |
| NV3 | Resolved | By the H2 annotations. |
| NV4 | **Fixed** | `CLAUDE_CODE_SUBPROCESS_ENV_SCRUB=1` in the builder session; checked: a test command reports the key as not set. |
| NV1, NV2 | Open | Need the token (NV1) and a way to remove the hooks and MCP registration when Scriptorium isn't used (NV2). |

## Summary

| # | Severity | Finding | Who can exploit it |
|---|---|---|---|
| H1 | High | Builder lockdown can be escaped: the allowed test commands run builder-written code with the user's full rights | DeepSeek output, steered by prompt injection in project files or the task |
| H2 | High | Worker tools are auto-approved and marked read-only, but `build` runs any shell command and `output_file` writes any file | Anything that prompt-injects Claude in a Scriptorium session |
| M1 | Medium | WebSocket trusts any page on `http://localhost:5173` and has no token; it gives full control of Claude sessions | Script running on the Vite default port (another project's dev server, builder-written UI code under QA) |
| M2 | Medium | The builder's `.env` block is bypassable (Grep, Windows path aliases) | DeepSeek output / prompt injection in project files |
| L1 | Low | QA "local URLs only" check accepts public hosts | Prompt-injected Claude choosing the URL |
| L2 | Low | QA explorer's do-not-click list is bypassed by coordinate clicks | Page content steering the vision model |
| I1–I3 | Info | Key handling and hardening notes | — |
| NV1–NV4 | Needs validation | Loopback reachable by other principals, port squatting, `readOnlyHint` effects, key in builder Bash env | Depends on machine setup / Claude Code behavior |

Fix order: H1 and H2 first. They are the paths from "a model read something hostile" to "code runs as you". M1 closes the browser route to the same result.

---

## H1 — Builder lockdown can be escaped through the test commands (High)

**Claim being defeated.** `build` is described as: "It can only read and write inside project_dir and run exactly the test_commands: no network, no other commands" (`server/src/workerTools.ts:151`, header comment `server/src/builder.ts:18-20`).

**Evidence.**
- Bash is limited by exact string match only: `server/src/builder.ts:117-121`. What the command *does* is not limited.
- Write/Edit are allowed for any path inside the project, except names matching `.env*`: `server/src/builder.ts:103-109`. That includes `package.json`, test files, `.git/hooks/*`, `.claude/settings.json`, `.vscode/tasks.json`, `.husky/*`.
- `npm test`, `pytest`, `cargo test` etc. execute project files the builder just wrote. Nothing isolates them: `query()` gets no `sandbox` option (`server/src/builder.ts:298-318`), and the SDK in use (0.3.319) supports one, including on native Windows.
- After the session, Scriptorium reruns the same commands itself with `bash -c`, unsandboxed, as the user, with `HOME`/`USERPROFILE`/`APPDATA` passed through: `server/src/builder.ts:146-152`, `server/src/builder.ts:342`. So even a builder that is stopped by the turn limit gets its code run once more.

**Who / how.** The DeepSeek model is the lower-trust principal here. It reads project files, so text in a cloned repo, a dependency, a fixture or the task can steer it (prompt injection). Example: the builder edits `test/setup.js` (or the `"test"` script in `package.json`) to run `node -e "…read ~/.claude/.credentials.json, ~/.ssh, scriptorium/.env…"`; the allowed `npm test` then runs it, twice. Writes to `.git/hooks/pre-commit` or `.claude/settings.json` (hooks) run later, the next time you commit or open Claude Code in that folder.

**Result.** Arbitrary code execution as your Windows user, with network access: Claude login token, SSH keys, the DeepSeek key, everything in your profile.

**Fix (smallest effective).**
1. Pass the SDK sandbox to the builder session: `sandbox: { enabled: true, failIfUnavailable: true, allowUnsandboxedCommands: false, network: { strictAllowlist: true, allowedDomains: [] }, credentials: { envVars: [{ name: "ANTHROPIC_API_KEY", mode: "deny" }] } }`, with filesystem writes limited to the project folder.
2. Stop rerunning the commands unsandboxed in `runCommand` (`builder.ts:146-171`). Either run the check inside the same sandbox, or report the session's own test output and say it wasn't re-checked.
3. Refuse writes under `.git/`, `.claude/`, `.vscode/`, `.husky/`, `.github/` in `refuse()` (`builder.ts:103-109`); they are execution points outside the test run.
4. Until 1–2 land, change the tool description so Claude doesn't rely on a guarantee that doesn't hold.
5. Regression test: a fixture project whose test command writes a file outside the project root; the build must fail to create it.

---

## H2 — Auto-approved, "read-only" worker tools run commands and write files (High)

**Claim being defeated.** Claude Code's permission prompt: in default mode, a Bash command or a write outside the working folder needs your OK.

**Evidence.**
- Scriptorium's sessions auto-allow every `scriptorium` MCP tool without asking: `server/src/claude.ts:82`, `server/src/claude.ts:135-139`.
- All tools carry `readOnlyHint: true` ("the tools don't change the user's files"): `server/src/workerTools.ts:76-80`. That is no longer true:
  - `build.test_commands` is any string list (`workerTools.ts:159-163`) and Scriptorium runs each one with `bash -c` after the session (`builder.ts:342`). A command doesn't need to be a test: `["curl … | sh"]` runs.
  - `ask_worker` / `start_job` with `output_file` create and overwrite files (`server/src/workerTasks.ts:138-140`). The "inside the project folder" check (`workerTasks.ts:63-69`) is relative to `project_dir`, which the caller picks freely (`workerTools.ts:47-50`, `71-74`). `project_dir: "C:\\Users\\<you>"` + `output_file: "AppData\\Roaming\\Microsoft\\Windows\\Start Menu\\Programs\\Startup\\x.cmd"` passes.
  - `files` reads any text file under the chosen `project_dir`, and images from any path (`workerTasks.ts:29-44`), and sends them to DeepSeek unless `sensitive: true`.

**Who / how.** Anything that gets instructions into Claude's context in a Scriptorium chat: a README in the repo, a fetched web page, a worker's answer, a QA report built from page text. The injected instruction calls `build` or `ask_worker`; no prompt appears.

**Result.** Shell commands and file writes anywhere in your profile without your approval (persistence via the Startup folder is one step), and silent upload of files such as `~/.ssh/id_ed25519` to DeepSeek.

**Fix.**
1. Give each tool honest annotations: `readOnlyHint: true` only for `list_workers` and `job_status`; `build`, `ask_worker`/`start_job` (they can write) and `qa_*` get `readOnlyHint: false`.
2. In `claude.ts:135-139`, auto-allow only the read-only tools. Send `build` and calls with `output_file` through `opts.canUseTool`, so the permission card shows the test commands and the target path.
3. Require `project_dir` to be inside the session's folder or its added folders (the in-SDK path knows `ctx.cwd`; the HTTP path learns it from MCP roots in `mcpHttp.ts:55-73`), and apply the same rule to image paths.
4. Regression test: with the session in default mode, a `build` call must produce a permission request.

---

## M1 — WebSocket accepts any page on localhost:5173 and has no token (Medium)

**Evidence.**
- `http://localhost:5173` and `http://127.0.0.1:5173` are always in the origin allowlist, also in production mode: `server/src/index.ts:40-46`, `index.ts:48`.
- The WebSocket checks only Origin + Host (`index.ts:591-596`); after that, every message is trusted (`index.ts:266-526`). That includes `claude.open` with any `cwd` (`index.ts:268-269`, `170`), `claude.setMode` (`index.ts:342-343`; sessions allow `bypassPermissions`, `claude.ts:123`), `claude.send`, `claude.permission`, `setup.*` and `workers.save`.

**Who / how.** 5173 is Vite's default port, so whenever the Scriptorium dev UI isn't using it, another project's dev server likely is. Any script on that page can do: `new WebSocket("ws://127.0.0.1:7777/ws")` → `claude.open` in your home folder → `claude.setMode("bypassPermissions")` → `claude.send("run …")`. That includes a third-party script the page loads, an XSS in that app, or frontend code the DeepSeek builder wrote and `qa_sweep` then opens on `http://localhost:5173`.

**Result.** Commands run as you through a Claude session.

**Fix.**
1. Add the 5173 origins only when the server runs in dev mode (e.g. set `SCRIPTORIUM_DEV=1` in the `dev` script).
2. Better: a random token per launch, created at startup and handed to the UI same-origin (in the served `index.html`, or through a Vite proxy in dev), and required on the WebSocket handshake. The same token can protect `/mcp` (`claude mcp add --header "Authorization: Bearer …"`) and `/hooks` (header on the hook entry). That also closes NV1.

---

## M2 — The builder's `.env` block is bypassable (Medium)

**Evidence.**
- The secret-file check is applied only to Read/Edit/Write: `server/src/builder.ts:107`. Grep has no such check (`builder.ts:110-116`), and ripgrep searches a file named explicitly in `path` even when it is gitignored, so `Grep { path: ".env", pattern: "." }` returns the file.
- The regex `^\.env(\..+)?$` (`builder.ts:76`) misses Windows aliases that open the same file: `.env::$DATA`, `.env.` (trailing dot), `.env ` (trailing space).

**Who / how.** Same principal as H1. Works even with harmless test commands and would survive the H1 sandbox fix.

**Result.** Project secrets go to DeepSeek and into the builder report saved in `server/data/chats`, against the stated rule. To reach an attacker they still need a second channel (e.g. written into a file that later gets committed), so impact is limited.

**Fix.** Do the secret check on the resolved real path for every tool that takes a path (Read, Edit, Write, Grep `path`, Glob results). Normalize first: strip trailing dots/spaces and any `:stream` suffix, compare case-insensitively. Simpler and stronger: add `.env*` to the sandbox's `filesystem.denyRead` once H1 is fixed.

---

## L1 — QA "local URLs only" check accepts public hosts (Low)

**Evidence.** `server/src/qa/run.ts:28-36`. The private-range regex is matched against the hostname without requiring an IP, so `http://10.attacker.com` and `http://192.168.example.org` pass. `*.ts.net` also matches public Tailscale Funnel hosts on anyone's tailnet. Redirects after `page.goto` are not re-checked (`server/src/qa/browser.ts:92`).

**Who / result.** A prompt-injected Claude (or a local page that redirects) can send the clicking browser to an attacker's site. The browser has a fresh profile, so no cookies leak. The page's screenshots go to DeepSeek, and its text comes back to Claude inside the QA report, which is another prompt-injection channel.

**Fix.** Parse the hostname: accept `localhost`, `*.localhost`, `*.test`, real IPv4/IPv6 literals in the private ranges (`net.isIP` + range check), and only *your* tailnet's suffix (from config). Re-check the URL on every navigation (`page.on("framenavigated")` or `route` handler) and stop the run when it leaves the allowed set.

## L2 — QA explorer's deny list is bypassed by coordinate clicks (Low)

**Evidence.** The deny list (`server/src/qa/types.ts:86-87`) is checked only for ref-based `click`/`type` (`server/src/qa/explore.ts:438`). `click_xy` goes through unchecked (`explore.ts:478-489`).

**Who / result.** Text on the page under test can steer the vision model into clicking "Delete", "Send" or "Pay" by position. With Scriptorium itself as the target (the tool docs suggest it), its history panel lists your real Claude sessions, and `claude.delete` removes them.

**Fix.** Before a `click_xy`, run `document.elementFromPoint(x, y)`, walk up to the nearest interactive element, and apply the same name check.

---

## API keys and `.env` (I1–I3)

What holds:
- `.env`, `.env.*`, `server/agents.json`, `server/data/` are gitignored. `git log -p` over all branches has no `sk-…` key-shaped strings, and `server/data/*.log` and saved chats have none either.
- `saveDeepseekKey` validates the key format before writing it (no newline injection into `.env`) and never sends it back to the UI (`server/src/setup.ts:150-172`).
- The builder gets a scrubbed environment and a temporary, empty `CLAUDE_CONFIG_DIR`, so it never sees your Claude login (`server/src/builder.ts:44-69`).

Informational:
- **I1 — Main Claude sessions inherit the whole `.env`.** `node --env-file` loads `.env` into `process.env` (`server/package.json:7-9`), and `ClaudeSession` passes no `env` (`server/src/claude.ts:111-141`); the SDK then gives the child the full `process.env`. Every command Claude runs in a Scriptorium chat, including project scripts like `npm install` hooks, sees `DEEPSEEK_API_KEY`. Today that code can already read `.env` from disk as the same user, so this crosses no new boundary. It will matter once sessions run sandboxed. Fix: pass `env` without `DEEPSEEK_API_KEY` to `ClaudeSession`.
- **I2 — Your prompts go to DeepSeek through `build`.** The global `UserPromptSubmit` hook (`server/src/setup.ts:108-114`) hands each session's latest message to every `build` call (`server/src/builder.ts:215-229`, `254-256`). It is stored in `server/data/chats` (`builder.ts:357-366`). There is no `sensitive` option for `build`. This is documented and intended, but a secret pasted into a prompt reaches DeepSeek without Claude choosing to send it.
- **I3 — Static file guard uses a prefix check without a separator** (`server/src/index.ts:549-553`). `/..%2Fdist-x/…` would resolve to `web/dist-x/…` and pass. No sibling of `web/dist` starts with `dist` today, so nothing is exposed. Fix: `path.relative`-based check, like `builder.ts:78-81`.

---

## Needs validation (no severity)

- **NV1 — Other local principals on loopback.** `/ws`, `/mcp` and `/hooks` have no secret. A non-browser client can send any `Origin` and `Host`, so any process that can reach `127.0.0.1:7777` gets M1's control. Missing fact: whether anything other than you runs on this machine: another Windows account, or containers/WSL that reach the host loopback (Docker Desktop's `host.docker.internal`, WSL mirrored networking). Safe check: from inside a throwaway container, `curl -s http://host.docker.internal:7777/api/health` with a dummy Host header. The M1 token fix closes this either way.
- **NV2 — Port squatting.** Setup points the global hooks and the user-scope MCP server at a fixed `http://127.0.0.1:7777` (`server/src/setup.ts:83-88`, `103-147`). If another principal holds port 7777 while Scriptorium is closed, it receives every prompt from every Claude Code session and can return `updatedInput` for every `Agent`/`Task` call, i.e. rewrite subagent prompts. Same missing fact as NV1. A token only proves the client to Scriptorium, not Scriptorium to the client, so it doesn't stop a squatter. Mitigations: keep Scriptorium running (autostart) so the port stays taken, and offer a "remove hooks and MCP registration" button in Setup for when it's not in use.
- **NV3 — `readOnlyHint` in other Claude Code sessions.** Claude Code may treat tools marked read-only differently (allowed in plan mode, auto-approved in some modes). If so, `build` and `output_file` writes run in modes meant to be read-only, in every terminal/desktop session. Check: in plan mode in a scratch folder, ask Claude to call `build` with `test_commands: ["echo ok > marker.txt"]` and see whether it runs. The H2 annotation fix removes the question.
- **NV4 — DeepSeek key visible to builder test commands.** `sessionEnv` sets `ANTHROPIC_API_KEY` to the DeepSeek key (`server/src/builder.ts:63`). Unless Claude Code scrubs it from Bash subprocesses by default, `npm test` inside the builder sees it. Check: a scratch project whose test command prints `${ANTHROPIC_API_KEY:+set}`. The H1 sandbox `credentials.envVars` deny fixes it either way.

---

## Checked, no finding

- `/hooks`: needs a local Host and no `Origin` header, so browser pages can't call it (`server/src/index.ts:572-576`).
- `/mcp`: local Host regex plus Origin allowlist blocks DNS rebinding and cross-site browser requests; 10 MB body cap (`server/src/mcpHttp.ts:17`, `110-112`).
- Remote access: the Tailscale identity header is trusted only for configured `REMOTE_ORIGINS` hosts; `/mcp` and `/hooks` stay local-only (`server/src/index.ts:57-64`).
- `git.ts`: `execFile` without a shell, `--` before the file name.
- `app.ts`: PowerShell values are single-quote escaped, paths are fixed.
- Worker chat ids are regex-checked before becoming file names (`server/src/workerChats.ts:16-19`); worker records go through a zod schema (`server/src/agents.ts:7-20`).
- Builder path checks: realpath on the nearest existing part (symlink-safe for the file tools), Glob blocks `..` and absolute patterns, and the session loads no settings, MCP servers, agents or saved login.
