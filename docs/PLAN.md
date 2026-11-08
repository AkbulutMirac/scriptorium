# Scriptorium — Plan

**Status:** All phases complete: Claude, DeepSeek, and local (Ollama) workers are running. See the README for setup and usage.
**Name:** Scriptorium. The room in medieval monasteries where scribes copied manuscripts at their desks. Claude is the head scribe, the workers are scribes. (Former working name: isci-mcp)
**Interface decision:** Our own interface, built with HeroUI (see "Interface design" section below).

## Goal

A single web interface:
- **Chat panel:** Direct messaging with Claude (the boss) or any worker
- **3D library:** Live view of which worker is doing what and who is sitting idle
- **Adding workers:** New workers are added from the interface, and Claude can use them immediately

Claude decides for itself who to assign work to.

```
              Browser (React)
   ┌────────────────────┬──────────────────────┐
   │ Chat panel         │ 3D library           │
   │ (select agent,     │ (who's doing what)   │
   │  type)             │                      │
   │ + Terminal tab     │                      │
   └─────────┬──────────┴──────────▲───────────┘
             │ WebSocket           │ worker events
   ┌─────────▼─────────────────────┴────────────┐
   │ Backend (Node / TypeScript + Agent SDK)    │
   │  - Claude Code → Claude (boss)             │
   │  - DeepSeek API chat (worker)              │
   │  - Ollama chat (local models)              │
   │  - worker tools (SDK MCP) + agents.json    │
   └─────────┬──────────────────────────────────┘
             ▼
   Installed claude CLI · DeepSeek API · Ollama
```

## Decisions made

- **Claude connection:** Connects to the real Claude Code running in the background.
  - The Claude Agent SDK (TypeScript) already runs Claude Code as a subprocess.
  - The `pathToClaudeCodeExecutable` option points to the installed `claude` CLI on the machine. Since the CLI updates itself, new models, tools, and features arrive automatically.
  - `settingSources` stays at its default setting. This way CLAUDE.md, MCP servers, skills, and plugins are the same as in the terminal.
  - Sessions are kept in the same folder and can also be resumed from the terminal (to be verified).
  - Updating the SDK itself is a single command: `npm update`. If the SDK and CLI versions drift too far apart, incompatibilities may arise.
- **Subscription:** For personal use, login with a Claude subscription works. Anthropic halted the change they had planned; usage counts against the subscription limit. This policy may change, so when starting out, re-check the "Use the Claude Agent SDK with your Claude plan" article at support.claude.com. Fallback plan: Console API key.
- **Update-proof interface:** Message types the interface doesn't recognize are shown as a generic card; nothing breaks, and they can be prettified later. Optionally, a "Terminal" tab (xterm.js) is added: any feature the chat panel doesn't yet support can be used there with the real Claude Code screen.
- **Single language:** The backend and worker tools are written in TypeScript. Worker tools become the MCP server inside the SDK itself, so events flow directly to the interface.
- **Each agent is separate:** Only Claude runs through Claude Code. DeepSeek and local models are independent of Claude Code.
  - You can chat directly with any of them from the agent selector in the interface. Each agent has its own chat history.
  - Claude also assigns work to them through the worker tools.
- **DeepSeek connection:** Direct DeepSeek API (OpenAI-compatible). Since Ollama uses the same format, both are spoken to with a single client. Models: `deepseek-flash` (V4.1-Flash, cheap) and `deepseek-v4-pro` (powerful).
- **Code flow (planned, not yet done):**
  1. Claude writes the task and tests.
  2. The worker tool reads the relevant files and sends them to DeepSeek, writing the returned code to a separate git worktree.
  3. Tests run automatically.
  4. Claude only looks at the diff and the result.
- **Local workers (Ollama, free):**
  - `qwen3.8-27b-metin`: a copy of `hf.co/ISTA-DASLab/Qwen3.8-27B-GSQ-RCO-GGUF:IQ2_S` (9.3 GB) with the vision module removed. Context 16K. Measured (RTX 4060 Laptop, 41% CPU / 59% GPU): output ~3.7 tokens/s, input ~250 tokens/s, initial load ~15 s. Runs with thinking disabled (with it on, it takes minutes).
  - A small embedding model: for search and RAG
- **Role of local workers:**
  - Batch jobs that run overnight (e.g., image pre-screening)
  - Confidential data
  - Search index (embedding)
  - Non-urgent batch jobs (log summarization, etc.)
  - Code writing goes to DeepSeek, not local.
- **Rule: Long jobs run in the background.** Claude starts the job, gets a job number, and checks the result later. This way it doesn't lock up waiting.
- **Rule: Privacy.** Files and jobs marked "sensitive" go only to the local worker. Data sent to DeepSeek goes to servers in China.
- **Worker list:** `agents.json`. Claude's tools: `list_workers`, `ask_worker(name, task, files)`, `start_job`, and `job_status` (for background jobs).
- **Files:** The tool itself reads the files, not Claude, so Claude doesn't spend tokens.
- **Money safety:** DeepSeek is prepaid; when the balance runs out it returns a `402` error and stops. Paying with a limited card is recommended. The tool has a per-call `max_tokens` limit.

## Interface design (decision: 2026-11-07)

**Technology:** React + HeroUI + react-three-fiber (3D).
- Chat components are written ourselves with HeroUI. If needed, headless parts of assistant-ui are used.
- The code of CloudCLI (siteboon/claudecodeui) is consulted as a reference for how Claude sessions are managed.

**Layout (3 columns, target screen 1920x1080, 100% scale):**

```
┌──────────┬──────────────────────────────┬──────────────┐
│ History  │        3D library            │ Chat         │
│ (of the  │  Claude in the center,       │ (with the    │
│  selected│  workers around,             │  selected    │
│  agent)  │  "+ worker" button           │  agent)      │
└──────────┴──────────────────────────────┴──────────────┘
   ~280px            remaining space           ~520px
```

- **The chat panel is resizable.** It is dragged from its edge, and its width is remembered.
- **The history panel is collapsible (focus mode).** Only icons remain, and the chat expands.
- **Long content opens in the center.** Wide content like diffs and files opens over the 3D scene, because 80–100 character code lines don't fit in the ~520px chat.
- **Clicking a character in the 3D scene selects that agent.** The chat and history switch to that agent.

**The Claude panel works like the Code tab of the Claude desktop app:**
- **Side chat:** A separate conversation about a message opens without disturbing the main chat. It knows the chat's context but doesn't mix into the main chat. Technically done with `resume` + `forkSession` in the SDK.
  - The side chat opens as an additional column to the right of the main chat. The 3D scene narrows at that time.
- **Replying to a message:** A question is asked by quoting the whole message or a selected portion of it.
- **Color themes:** Light and dark mode plus a few accent colors. The selection is remembered.
- Inspired by CloudCLI's interface.

**GitHub layout:**

```
scriptorium/
├── README.md, LICENSE (MIT), .gitignore, .env.example
├── package.json          (npm workspaces: server, web)
├── docs/PLAN.md
├── server/               (Node/TS backend)
│   ├── agents.example.json
│   └── src/
└── web/                  (React + HeroUI + react-three-fiber)
```

- Secrets (API keys) live only in the `.env` file, which is in `.gitignore`. `.env.example` goes into the repo.
- The personal worker list `server/agents.json` is also in gitignore. `agents.example.json` goes into the repo.

**Environment (checked on 2026-11-07):**
- Node v22.19, Claude Code CLI 2.1.263 (installed via npm).
- For `pathToClaudeCodeExecutable`, the real file path will be found, not the `claude.ps1` shortcut.

## "Full integration" checklist (chat panel)

- [x] Agent selector: Claude, DeepSeek, and local models. Each agent has a separate chat history.
- [x] Streaming responses, thinking blocks open and close.
- [x] Claude's tool calls are shown with cards: read, command, red-green diff for Edit/Write, todo list, sub-agent steps indented.
- [x] Permission approval: Allow / Always allow / Deny. Claude's multiple-choice questions (AskUserQuestion) can also be answered.
- [x] Stop button
- [x] Session history: shared with Claude Code sessions in the terminal. Can be opened, renamed, deleted. Resumes where it left off after a page refresh.
- [x] "→ Delegated to DeepSeek" card and the character walking to the desk in 3D
- [x] Unrecognized message types are shown with a generic card (resilient to Claude Code updates).
- [x] Side chat (forkSession): knows the main chat's context, doesn't mix into the main chat.
- [x] Replying to a message with a quote (selected text or the whole message)
- [x] Theme selector (light/dark/system + 6 accent colors) and pixel look toggle
- [x] **Session info panel** (top right): environment and git branch, additional folders, context fullness, connectors (open/close, reconnect), outputs (written files), git changes (+/− and diff), background tasks (stoppable), and worker jobs
- [x] **"+" menu** (bottom left): attach file or photo (image, PDF, text; paste and drag-and-drop also work), add folder, slash commands, connectors, plugins
- [x] Slash command suggestions: opens when typing `/`, selected with arrow keys and Tab/Enter.
- [x] Bar under the input box: folder picker (projects + folder explorer), model / effort / fast mode menu, permission mode, usage ring
- [x] Subscription usage limits in the top bar (5-hour, 7-day)
- [x] History panel grouped by project (PROJECTS_DIR automatic). Right-click menu: new chat, copy path, hide/show, delete all chats (with confirmation, doesn't touch files), open/rename/delete chat.
- [x] 3D labels in a scene-overlay layer instead of drei `<Html>`: disappearance issue in React 19 resolved
- [x] Torches and brazier in dark mode (flickering warm light)
- [x] Initial setup window: Claude login, DeepSeek key, local models, connecting to all Claude Code sessions
- [x] Worker tools also exposed as an HTTP MCP server: terminal and desktop Claude Code sessions use them too
- [x] A separate copy in 3D for each job arriving at the same worker simultaneously; job card on hover
- [x] Worker panel with extra files, model and thinking menu, settings, token usage, and context ring
- [ ] Terminal tab (optional, postponed): real Claude Code screen. node-pty requires a native build.

## Initial setup

On first launch, the app shows the Setup window (later opened from the Settings menu):

1. Log in with a Claude account (the Anthropic login page opens in the browser)
2. DeepSeek API key (optional, written only to the local `.env` file)
3. Adding local workers from models installed in Ollama (optional)
4. Adding worker tools to all Claude Code sessions and delegation rules (optional)

## Phases

### Phase 1: Backend skeleton + worker tools ✅
- [x] Agent SDK connects to the installed `claude` via `pathToClaudeCodeExecutable`. With subscription login, the new version is used automatically when the CLI updates itself.
- [x] In-SDK MCP worker tools: `list_workers`, `ask_worker`, `start_job`, `job_status` (`alwaysLoad`). Privacy rule: `sensitive: true` goes only to local workers.
- [x] A single OpenAI-compatible client for DeepSeek and Ollama, with a `max_tokens` limit
- [x] DeepSeek connected (2026-11-07): balance is read, direct chat works end-to-end (response 1.1 s), 3D states are correct. Claude's delegation test will be done with the user.

### Phase 2: Chat interface ✅
- [x] WebSocket bridge: open only on 127.0.0.1, accepts connections only from allowed interface addresses.
- [x] The checklist above (except the terminal tab)

### Phase 3: 3D scene ✅
- [x] Isometric office-library (orthographic camera, pixel look). Claude at the head desk in the back, workers in rows at desks with monitors.
- [x] States:
  - working: typing at the desk, screen lit, task label visible
  - idle: reading a book in the rest corner
  - if no space left: dozing at the desk
  - error: red label, automatically returns to idle after 12 s
- [x] Clicking a character selects that agent. Lighting differs in light and dark mode.

### Phase 4: Adding workers + background jobs ✅
- [x] "Add worker" window: add, edit, delete. Writes to `agents.json`; Claude sees the new worker immediately.
- [x] `start_job` / `job_status` job queue. Jobs for the same worker run in order.

## Limits (remember)

- Delegation pays off most for:
  - clearly defined, self-contained code tasks
  - jobs that take large input and produce small output
  - confidential data
- Complex debugging and architectural decisions should stay with Claude.
- Test machine: RTX 4060 Laptop (8 GB VRAM), 16 GB RAM. The local model runs with 16K context (4K: 15% faster, 32K: 25% slower and 11 GB memory).
