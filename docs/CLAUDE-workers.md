## Scriptorium helpers (DeepSeek, local LLMs, Haiku and Sonnet subagents)

While Scriptorium is running you have a team you can hand work to. Use it when it saves time or Claude usage, the way a lead hands work to the right person. Nothing here is mandatory: when doing it yourself is quicker or clearer, just do it. You don't need to ask the user before using a helper.

**Who is on the team**

| Helper | How to reach it | Good at | Keep in mind |
|---|---|---|---|
| `deepseek-pro` | `ask_worker` / `start_job` | Self-contained code: a function, a script, tests, a conversion | Costs nothing from the Claude subscription. Can't read files or run commands: pass the files with `files` and `project_dir` |
| `deepseek` (Flash) | `ask_worker` / `start_job` | Easy jobs, summaries of long input, classification, anything with images | The only DeepSeek model that reads images |
| Local workers | `ask_worker` / `start_job` | Short, single-step jobs; anything confidential (`sensitive: true`) | Small models: check their model with `list_workers` first and check their answers closely |
| Haiku subagent | `Agent` tool, `model: "haiku"` | Searching and reading the codebase, answering "where is this, how does it work", small edits | Uses the Claude subscription, lightly. Can read files and run commands |
| Sonnet subagent | `Agent` tool, `model: "sonnet"` | Changes across several files, running and fixing tests | Uses the Claude subscription. Can read files and run commands |

Always pass `model` explicitly when you start a Haiku or Sonnet subagent: that is how it shows up in the office.

**Some ways to combine them**
- Cheap code first: a self-contained piece goes to DeepSeek; you write it to the file and test it.
- Exploration: a Haiku subagent reads around the codebase and reports back, so your own context stays small.
- Bigger changes that need files and tests: a Sonnet subagent does the change and runs the tests.
- Planning, splitting the work, reviewing the result and decisions that need the whole picture stay with you.
- Independent parts can run in parallel.

**Reports.** Every subagent's task automatically ends with a request for a short report (Done, Files, Checks, Open), and that report is its answer to you. Read it before you continue. For DeepSeek, say which output format you want.

**Check before you trust.** Don't use an answer unchecked: run the code or the tests. If something is wrong, fix it or send it back with the error.

**UI checks.** After a UI change, `qa_sweep` clicks every visible control in a real browser and measures layout problems; `qa_explore` explores menus, dialogs and flows on its own (say what to look at in `goal`). Both run in the background: poll `job_status`. For Scriptorium itself pass `local_storage: {"scriptorium.setupDone":"true"}`.

**At the end**, if you used helpers, tell the user in a line which one did what.

If the user names a helper, use that one. If they say not to use helpers, don't.
