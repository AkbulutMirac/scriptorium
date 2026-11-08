## Scriptorium workers (DeepSeek and local LLMs)

If the `mcp__scriptorium__*` tools are available (they are in every Claude Code session while Scriptorium is running), **writing code is the workers' job by default. This is a rule, not a suggestion.** Your job: plan, split the work, hand the parts to workers, check and apply what comes back, and test it. You don't need to ask the user before using workers.

**Every time before you write code:** ask "could a worker write this?" If yes, give it to a worker. New code longer than 15 lines, or several changes in one file, is a worker's job.

**The only exceptions where you write code yourself:**
- Fixes of a few lines, and glue code that wires worker output together
- Reading code to find a problem (diagnosis), planning and architecture decisions, security reviews
- Sensitive-data tasks too hard for a local worker
- Workers are unreachable (`list_workers` shows `available.ok` false)

**Big tasks (features that touch several files):**
- Make the plan yourself and split the work per file or component. Don't write everything yourself because "it needs the whole project in view": the overview is yours, the code is the workers'.
- For each part, pass the relevant files with `files`, say what should change and how to tell it's done. Send parts that don't depend on each other in parallel, in the same message.
- Apply what comes back yourself, wire it together, run the type check and the tests.

**What to delegate:**
- Code: functions, components, scripts, tests, types/schemas, code conversion, regex, SQL, changes within a file
- Big input, small output: summarizing long logs or documents, classification, data extraction, translation
- UI review: screenshot checks (QA below)

**Which worker:**
- Default `deepseek-pro`: writing code, conversions, tests, anything with several steps.
- Easy tasks go to `deepseek` (Flash): a short single function, regex, simple format conversion, short summary, classification. Flash is the only DeepSeek model that reads images.
- Local workers are small models. Before using one, check its model name and description with `list_workers` (parameter count, quantization) and pick the task accordingly. Usually give them only short, single-step tasks with a clear output: classification, short summaries, simple text or data conversion. Don't give them long code or multi-step reasoning. Check their answers more strictly than DeepSeek's.
- If the data is sensitive (passwords, keys, `.env`, personal or customer data), pass `sensitive: true` and pick a local worker.

**How:**
1. If unsure, check with `list_workers` who is available and idle.
2. Write the task so it stands on its own: language, expected output format, constraints. Pass the needed files with `files` and set `project_dir` to the full path of the working directory.
3. For tasks longer than a few minutes (especially with local models) use `start_job`, then `job_status`.
4. Don't use an answer unchecked: write the code to the file yourself and run or test it. If it's wrong, fix it or send it back to the worker with the error.
5. At the end of every task, tell the user which part each worker wrote. If you wrote a part yourself, say why in one line (which exception).

**Tests:**
- For coding tasks, have the worker write the test file too (in the same task or as a separate, parallel one). Workers can't run tests: you run them. If they fail, send the error output back to the worker with the code and have it fixed; test the fix yourself again.
- Use the project's own test command and library. If there is no test setup, ask the user before adding one.

**UI and design review (QA):**
- When you change the UI, take screenshots (desktop and phone width; light and dark theme if there is one) and send them to the `qa` worker. Pass the images in `files` with their full paths. Say what you changed and what to look at. If there is no `qa` worker, use a worker that can read images (`deepseek`, i.e. Flash). `deepseek-pro` can't read images.
- Check QA's findings against the screenshot yourself and fix the real ones (have a worker write the fix too). After fixing, take new screenshots and have them checked again.
- You can also have QA write Playwright test scenarios (clicks, forms, overflow checks). Running them is your job.

If the user names a worker, use that one. If they say "don't use workers", don't delegate in that session.
