/**
 * Summarizes a benchmark label: per task and config, hidden tests, Claude cost and tokens per model, subagents used.
 *   npx tsx bench/report.ts run1
 */
import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const BENCH = path.dirname(fileURLToPath(import.meta.url));
const label = process.argv[2] ?? "run1";
const dir = path.join(BENCH, "results", label);
/** Hidden test count per task, from the test files (a missing module fails the whole file as one test) */
const EXPECTED: Record<string, number> = {};
for (const suite of readdirSync(BENCH).filter((d) => d.startsWith("tasks"))) {
  for (const t of readdirSync(path.join(BENCH, suite))) {
    const f = path.join(BENCH, suite, t, "hidden.test.js");
    if (existsSync(f)) EXPECTED[t] = (readFileSync(f, "utf8").match(/^test\(/gm) ?? []).length;
  }
}

type Usage = { inputTokens: number; outputTokens: number; cacheReadInputTokens: number; cacheCreationInputTokens: number; costUSD: number };
const files = readdirSync(dir).filter((f) => /^[ABCD]-.*\.json$/.test(f) && !f.endsWith("summary.json"));
const rows = files.map((f) => JSON.parse(readFileSync(path.join(dir, f), "utf8")));

const k = (n: number) => (n >= 1000 ? `${(n / 1000).toFixed(1)}K` : String(n));
/** The verdict and must-fix / findings lines of a reviewer's or security reviewer's report */
function findings(text: string): string[] {
  const lines = text.split("\n");
  const verdict = lines.find((l) => /Verdict:/.test(l))?.trim();
  const start = lines.findIndex((l) => /Must fix:|Findings/.test(l));
  const items: string[] = [];
  for (const l of start >= 0 ? lines.slice(start + 1) : []) {
    if (/^- \w/.test(l.trim()) && !/^\s{2,}-/.test(l)) break;
    if (/^\s*-\s/.test(l) && !/^\s*-\s*none/i.test(l)) items.push(l.trim().slice(0, 160));
  }
  return [verdict ?? "(no verdict line)", ...items];
}

for (const config of ["A", "B", "C", "D"]) {
  const runs = rows.filter((r) => r.config === config);
  if (!runs.length) continue;
  console.log(`\n=== Config ${config} ===`);
  let pass = 0;
  let total = 0;
  let cost = 0;
  let solved = 0;
  let deepseek = 0;
  const byModel: Record<string, Usage> = {};
  for (const r of runs) {
    const exp = EXPECTED[r.task] ?? r.hidden.pass + r.hidden.fail;
    const p = r.hidden.fail === 0 ? r.hidden.pass : Math.min(r.hidden.pass, exp);
    pass += p;
    total += exp;
    if (r.hidden.fail === 0 && r.hidden.pass === exp) solved++;
    cost += r.costUsd ?? 0;
    deepseek += r.deepseekUsd ?? 0;
    for (const [m, u] of Object.entries((r.modelUsage ?? {}) as Record<string, Usage>)) {
      const t = (byModel[m] ??= { inputTokens: 0, outputTokens: 0, cacheReadInputTokens: 0, cacheCreationInputTokens: 0, costUSD: 0 });
      for (const key of Object.keys(t) as (keyof Usage)[]) t[key] += u[key] ?? 0;
    }
    const models = Object.entries((r.modelUsage ?? {}) as Record<string, Usage>)
      .map(([m, u]) => `${m.replace(/^claude-/, "")} out ${k(u.outputTokens)} $${u.costUSD.toFixed(3)}`)
      .join(", ");
    console.log(
      `${r.task.padEnd(12)} hidden ${p}/${exp}  own tests ${r.ownTests.pass}/${r.ownTests.pass + r.ownTests.fail}  $${(r.costUsd ?? 0).toFixed(3)}  ${Math.round(r.durationMs / 1000)}s  turns ${r.turns}  subagents ${JSON.stringify(r.subagents)}  workers ${Object.entries(r.tools).filter(([t]) => t.startsWith("mcp__scriptorium__")).map(([t, n]) => `${t.replace("mcp__scriptorium__", "")}×${n}`).join(" ") || "-"}${r.error ? `  ERROR ${r.error}` : ""}`,
    );
    console.log(`${"".padEnd(12)} ${models}`);
    for (const b of (r.builds ?? []) as { model: string; turns: number; seconds: number; output: number; usd: number; checksPassed: boolean }[]) {
      console.log(`${"".padEnd(12)} build: ${b.model}, ${b.turns} turns, ${b.seconds}s, out ${k(b.output)}, $${b.usd.toFixed(3)}, checks ${b.checksPassed ? "passed" : "FAILED"}`);
    }
    for (const rep of (r.reports ?? []) as { who: string; text: string }[]) {
      const [verdict, ...items] = findings(rep.text);
      console.log(`${"".padEnd(12)} ${rep.who}: ${verdict}`);
      for (const item of items) console.log(`${"".padEnd(14)} ${item}`);
    }
  }
  console.log(`TOTAL: hidden ${pass}/${total}, solved ${solved}/${runs.length}, Claude cost $${cost.toFixed(3)}${deepseek ? `, DeepSeek $${deepseek.toFixed(3)}` : ""}`);
  for (const [m, u] of Object.entries(byModel)) {
    console.log(`  ${m}: input ${k(u.inputTokens)}, cache read ${k(u.cacheReadInputTokens)}, cache write ${k(u.cacheCreationInputTokens)}, output ${k(u.outputTokens)}, $${u.costUSD.toFixed(3)}`);
  }
  const summary = path.join(dir, `${config}-summary.json`);
  if (existsSync(summary)) {
    const s = JSON.parse(readFileSync(summary, "utf8"));
    console.log(`  wall ${Math.round(s.wallMs / 1000)}s, 5h ${s.before.fiveHour}% -> ${s.after.fiveHour}%, weekly ${s.before.sevenDay}% -> ${s.after.sevenDay}%, DeepSeek $${s.before.deepseekUsd} -> $${s.after.deepseekUsd}`);
  }
}
