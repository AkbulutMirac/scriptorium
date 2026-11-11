## Scriptorium helpers (DeepSeek, local LLMs, Haiku and Sonnet subagents, specialist team)

While Scriptorium is running you have a team you can hand work to. Use it when it saves time or Claude usage, or when a second pair of eyes makes the result better, the way a lead hands work to the right person. Nothing here is mandatory: when doing it yourself is quicker or clearer, just do it. You don't need to ask the user before using a helper.

**Workers and general subagents**

| Helper | How to reach it | Good at | Keep in mind |
|---|---|---|---|
| `deepseek-pro` | `ask_worker` / `start_job` | Self-contained code: a function, a script, tests, a conversion | Costs nothing from the Claude subscription. Can't read files or run commands: pass the files with `files` and `project_dir` |
| `deepseek` (Flash) | `ask_worker` / `start_job` | Easy jobs, summaries of long input, classification, anything with images | The only DeepSeek model that reads images |
| Local workers | `ask_worker` / `start_job` | Short, single-step jobs; anything confidential (`sensitive: true`) | Small models: check their model with `list_workers` first and check their answers closely |
| Haiku subagent | `Agent` tool, `model: "haiku"` | Searching and reading the codebase, answering "where is this, how does it work", small edits | Uses the Claude subscription, lightly. Can read files and run commands |
| Sonnet subagent | `Agent` tool, `model: "sonnet"` | Changes across several files, running and fixing tests | Uses the Claude subscription. Can read files and run commands |

Always pass `model` explicitly when you start a general Haiku or Sonnet subagent: that is how it shows up in the office.

**The specialist team** (`Agent` tool with `subagent_type` set to the name)

| Specialist | Model | When to call it | What you get back |
|---|---|---|---|
| `test-writer` | Sonnet | A feature or fix with logic worth testing is written | Tests added, the command, pass/fail, likely cause of each failure. It only touches test files |
| `reviewer` | Opus | The change is written and before you tell the user it's done, or the user asks for a review | Verdict (Approve / Changes needed) with must fix, should fix and nits, each at `file:line`. Read-only |
| `qa-tester` | Sonnet | Something visible changed and the app runs locally | Only problems it verified on the screenshots, plus what it dismissed. Read-only |
| `security-reviewer` | Sonnet | The change touches auth, permissions, user input, file paths, shell commands, network endpoints, secrets or dependencies | Findings with severity, evidence and fix. Read-only |
| `docs-writer` | Sonnet | Last step of a change users or developers need to know about | Which docs it updated. It only touches documentation |

They start with a fresh context, so give each one what it needs: what the user asked for, what changed (files or commits), how it should behave, and for `qa-tester` the local URL. They return their own report format.

**A good flow after you write a change** (skip the steps that don't apply; a one-line fix needs none of this):

1. Start `test-writer` and `reviewer` in parallel.
2. Read both reports. Fix every must fix and every real test failure yourself (or with a worker). If there was a must fix, ask `reviewer` for one more look; don't loop beyond that.
3. If the interface changed, `qa-tester`. If the change crosses a trust boundary, `security-reviewer`.
4. When everything passes, `docs-writer` with a short summary of what changed and how to use it.
5. Tell the user what each helper found and what you did about it.

**Other ways to combine helpers**
- Cheap code first: a self-contained piece goes to DeepSeek; you write it to the file and test it.
- Exploration: a Haiku subagent reads around the codebase and reports back, so your own context stays small.
- Bigger changes that need files and tests: a Sonnet subagent does the change and runs the tests.
- Planning, splitting the work, reviewing the result and decisions that need the whole picture stay with you.
- Independent parts can run in parallel; two helpers should never edit the same file.

**Reports.** Every subagent ends with a short report, and that report is its answer to you. General subagents get a report request (Done, Files, Checks, Open) added to their task automatically; the specialists have their own. Read it before you continue. For DeepSeek, say which output format you want.

**Check before you trust.** Don't use an answer unchecked: run the code or the tests. If something is wrong, fix it or send it back with the error.

**UI checks yourself.** For a quick look you can run `qa_sweep` (clicks every visible control in a real browser and measures layout problems) or `qa_explore` (explores menus, dialogs and flows on its own) directly; poll `job_status`. For Scriptorium itself pass `local_storage: {"scriptorium.setupDone":"true"}`. `qa-tester` does the same and also checks each finding.

**At the end**, if you used helpers, tell the user in a line which one did what.

If the user names a helper, use that one. If they say not to use helpers, don't.
