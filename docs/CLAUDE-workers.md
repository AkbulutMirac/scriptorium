## Scriptorium workers (DeepSeek and local LLMs)

If the `mcp__scriptorium__*` tools are available (they are in every Claude Code session while Scriptorium is running), hand suitable work to the workers to save Claude usage. You decide when to delegate; you don't need to ask.

**Delegate:**
- Well-defined, self-contained coding tasks: a single function, script, test, type/schema, code conversion, regex, SQL.
- Big input, small output: summarizing long logs or documents, classification, data extraction, translation.
- Several independent tasks: give them in parallel with multiple `ask_worker` calls in the same message.

**Don't delegate:**
- Debugging that needs the whole project in view, architecture decisions, security reviews.
- Things you can do faster yourself in a few lines.

**Which worker:**
- Default `deepseek-pro`: writing code, conversions, tests, anything with several steps.
- Easy tasks go to `deepseek` (Flash): a short single function, regex, simple format conversion, short summary, classification.
- Local workers are small models. Before using one, check its model name and description with `list_workers` (parameter count, quantization) and pick the task accordingly. Usually give them only short, single-step tasks with a clear output: classification, short summaries, simple text or data conversion. Don't give them long code or multi-step reasoning. Check their answers more strictly than DeepSeek's.
- If the data is sensitive (passwords, keys, `.env`, personal or customer data), pass `sensitive: true` and pick a local worker. If the task is too hard for the local model, don't delegate; do it yourself.

**How:**
1. If unsure, check with `list_workers` who is available and idle.
2. Write the task so it stands on its own: language, expected output format, constraints. Pass the needed files with `files` and set `project_dir` to the full path of the working directory.
3. For tasks longer than a few minutes (especially with local models) use `start_job`, then `job_status`.
4. Don't use an answer unchecked: write the code to the file yourself and run or test it. If it's wrong, fix it or send it back to the worker with the error.
5. Tell the user in one line which task went to which worker.

**Tests:**
- For coding tasks, have the worker write the test file too (in the same task or as a separate, parallel one). Workers can't run tests: you run them. If they fail, send the error output back to the worker with the code and have it fixed; test the fix yourself again.
- Use the project's own test command and library. If there is no test setup, ask the user before adding one.

**UI and design review (QA):**
- When you change the UI, take screenshots (desktop and phone width; light and dark theme if there is one) and send them to the `qa` worker. Pass the images in `files` with their full paths. Say what you changed and what to look at. If there is no `qa` worker, use a worker that can read images (`deepseek`, i.e. Flash). `deepseek-pro` can't read images.
- Check QA's findings against the screenshot yourself and fix the real ones. After fixing, take new screenshots and have them checked again.
- You can also have QA write Playwright test scenarios (clicks, forms, overflow checks). Running them is your job.

If the user names a worker, use that one. If they say "don't use workers", don't delegate in that session.
