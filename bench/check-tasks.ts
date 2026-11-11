/**
 * Checks a suite's hidden tests: they must fail on the untouched fixture and all pass with the task's reference
 * solution (tasks-<suite>/<task>/solution/, copied over the fixture).
 *   npx tsx bench/check-tasks.ts --suite v3
 */
import { spawnSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const BENCH = path.dirname(fileURLToPath(import.meta.url));
const suite = process.argv.includes("--suite") ? process.argv[process.argv.indexOf("--suite") + 1] : "v3";
const TASKS = path.join(BENCH, `tasks-${suite}`);
const WORK = path.join(os.tmpdir(), "scriptorium-bench", "check");

function copyDir(from: string, to: string) {
  mkdirSync(to, { recursive: true });
  for (const e of readdirSync(from, { withFileTypes: true })) {
    const src = path.join(from, e.name);
    const dst = path.join(to, e.name);
    if (e.isDirectory()) copyDir(src, dst);
    else copyFileSync(src, dst);
  }
}

function hidden(ws: string, task: string): { pass: number; fail: number; out: string } {
  mkdirSync(path.join(ws, ".bench-hidden", task), { recursive: true });
  copyFileSync(path.join(TASKS, task, "hidden.test.js"), path.join(ws, ".bench-hidden", task, "hidden.test.js"));
  const r = spawnSync("node", ["--test", `.bench-hidden/${task}/hidden.test.js`], { cwd: ws, encoding: "utf8", timeout: 120_000 });
  const out = `${r.stdout}\n${r.stderr}`;
  const num = (k: string) => Number(new RegExp(`^# ${k} (\\d+)`, "m").exec(out)?.[1] ?? 0);
  return { pass: num("pass"), fail: num("fail"), out };
}

let ok = true;
for (const task of readdirSync(TASKS).filter((t) => existsSync(path.join(TASKS, t, "hidden.test.js")))) {
  const expected = (readFileSync(path.join(TASKS, task, "hidden.test.js"), "utf8").match(/^test\(/gm) ?? []).length;
  const plain = path.join(WORK, `${task}-plain`);
  const solved = path.join(WORK, `${task}-solved`);
  rmSync(plain, { recursive: true, force: true });
  rmSync(solved, { recursive: true, force: true });
  copyDir(path.join(BENCH, "fixture"), plain);
  copyDir(path.join(BENCH, "fixture"), solved);
  if (existsSync(path.join(TASKS, task, "solution"))) copyDir(path.join(TASKS, task, "solution"), solved);
  else console.log(`${task}: no solution/ folder`);
  const before = hidden(plain, task);
  const after = hidden(solved, task);
  const good = before.pass === 0 && after.pass === expected && after.fail === 0;
  ok &&= good;
  console.log(`${task}: untouched ${before.pass} pass / ${before.fail} fail, solution ${after.pass}/${expected} pass, ${after.fail} fail ${good ? "OK" : "PROBLEM"}`);
  if (after.fail) console.log(after.out.split("\n").filter((l) => /not ok|Error|expected|actual/.test(l)).slice(0, 30).join("\n"));
}
process.exit(ok ? 0 : 1);
