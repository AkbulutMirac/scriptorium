import { createHash } from "node:crypto";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { act, observe, openSession } from "./browser.js";
import { runChecks } from "./checks.js";
import type {
  CheckIssue,
  Observation,
  QaIssue,
  QaReport,
  QaSession,
  Theme,
  UiElement,
  ViewportName,
} from "./types.js";

export type Shot = { file: string; caption: string };

export async function runSweep(opts: {
  url: string;
  viewports: ViewportName[];
  themes: Theme[];
  maxClicksPerView: number;
  deny: RegExp;
  outDir: string;
  judge: (shots: Shot[]) => Promise<QaIssue[]>;
  onProgress: (text: string) => void;
  signal?: AbortSignal;
  storage?: Record<string, string>;
}): Promise<Omit<QaReport, "summary" | "dir" | "startedAt" | "finishedAt">> {
  const allIssues: QaIssue[] = [];
  const shots: Shot[] = [];
  const seenCheckKeys = new Set<string>();
  const seenRoleNames = new Set<string>();

  let stepsTaken = 0;
  let elementsClicked = 0;

  function sha1(buf: Buffer): string {
    return createHash("sha1").update(buf).digest("hex");
  }

  function makeWhere(vp: ViewportName, theme: Theme, state: string, element?: string): string {
    return [`${vp} ${theme} ${state}`, element].filter(Boolean).join(" ");
  }

  function addUniqueCheckIssue(key: string, issue: QaIssue): void {
    if (seenCheckKeys.has(key)) return;
    seenCheckKeys.add(key);
    allIssues.push(issue);
  }

  function checkSeverity(kind: CheckIssue["kind"]): QaIssue["severity"] {
    switch (kind) {
      case "overflow":
      case "console-error":
        return "high";
      case "overlap":
      case "clipped-text":
        return "medium";
      case "small-target":
        return "low";
    }
  }

  function recordConsoleErrors(
    vp: ViewportName,
    theme: Theme,
    state: string,
    errors: string[],
    screenshot?: string,
  ): void {
    for (const err of errors) {
      const key = `console-error\u0000\u0000${err}`;
      addUniqueCheckIssue(key, {
        severity: "high",
        where: makeWhere(vp, theme, state),
        problem: err,
        screenshot,
        source: "check",
      });
    }
  }

  function recordCheckIssues(
    vp: ViewportName,
    theme: Theme,
    state: string,
    checks: CheckIssue[],
    screenshot?: string,
  ): void {
    for (const ci of checks) {
      const key = `${ci.kind}\u0000${ci.element ?? ""}\u0000${ci.message}`;
      addUniqueCheckIssue(key, {
        severity: checkSeverity(ci.kind),
        where: makeWhere(vp, theme, state, ci.element),
        problem: ci.message,
        screenshot,
        source: "check",
      });
    }
  }

  function selectCandidates(
    elements: UiElement[],
    deny: RegExp,
    maxClicks: number,
  ): { role: string; name: string }[] {
    const seen = new Set<string>();
    const candidates: { role: string; name: string }[] = [];

    for (const el of elements) {
      if (candidates.length >= maxClicks) break;
      if (el.name.trim() === "") continue;

      deny.lastIndex = 0;
      if (deny.test(el.name)) continue;

      const key = `${el.role}\u0000${el.name}`;
      if (seen.has(key)) continue;
      seen.add(key);
      candidates.push({ role: el.role, name: el.name });
    }

    return candidates;
  }

  outer: for (const vp of opts.viewports) {
    for (const theme of opts.themes) {
      if (opts.signal?.aborted) break outer;

      let session: QaSession | undefined;

      try {
        session = await openSession(opts.url, vp, theme, opts.storage);
        if (opts.signal?.aborted) break outer;

        const startObs: Observation = await observe(session);
        const startFile = `${vp}-${theme}-000-start.jpg`;
        await writeFile(join(opts.outDir, startFile), startObs.screenshot);
        shots.push({ file: startFile, caption: `${vp} ${theme}: start` });
        const startHash = sha1(startObs.screenshot);

        recordConsoleErrors(vp, theme, "start", startObs.consoleErrors, startFile);
        recordCheckIssues(vp, theme, "start", await runChecks(session.page, vp), startFile);

        const candidates = selectCandidates(startObs.elements, opts.deny, opts.maxClicksPerView);
        for (const candidate of candidates) {
          seenRoleNames.add(`${candidate.role}\u0000${candidate.name}`);
        }

        for (let i = 0; i < candidates.length; i++) {
          if (opts.signal?.aborted) break;

          const candidate = candidates[i];
          opts.onProgress(
            `${vp}/${theme}: ${i + 1}/${candidates.length} · ${candidate.role} "${candidate.name}"`,
          );

          const preObs: Observation = await observe(session);
          recordConsoleErrors(
            vp,
            theme,
            `before clicking ${candidate.role} "${candidate.name}"`,
            preObs.consoleErrors,
          );

          if (opts.signal?.aborted) break;

          const target = preObs.elements.find(
            (el) => el.role === candidate.role && el.name === candidate.name,
          );

          if (target) {
            stepsTaken++;
            let clickSucceeded = false;

            try {
              await act(session, { kind: "click", ref: target.ref });
              clickSucceeded = true;
              elementsClicked++;
            } catch (error) {
              const message = error instanceof Error ? error.message : String(error);
              allIssues.push({
                severity: "low",
                where: makeWhere(
                  vp,
                  theme,
                  `after clicking ${candidate.role} "${candidate.name}"`,
                ),
                problem: `Click failed: ${message}`,
                source: "check",
              });
            }

            if (clickSucceeded) {
              const postObs: Observation = await observe(session);
              const postHash = sha1(postObs.screenshot);
              const file = `${vp}-${theme}-${String(i + 1).padStart(3, "0")}.jpg`;
              let shotFile: string | undefined;

              if (postHash !== startHash) {
                await writeFile(join(opts.outDir, file), postObs.screenshot);
                shots.push({
                  file,
                  caption: `${vp} ${theme}: after clicking ${candidate.role} "${candidate.name}"`,
                });
                shotFile = file;
              }

              recordConsoleErrors(
                vp,
                theme,
                `after clicking ${candidate.role} "${candidate.name}"`,
                postObs.consoleErrors,
                shotFile,
              );
              recordCheckIssues(
                vp,
                theme,
                `after clicking ${candidate.role} "${candidate.name}"`,
                await runChecks(session.page, vp),
                shotFile,
              );
            }
          }

          await session.page.keyboard.press("Escape");
          await session.page.goto(opts.url, { waitUntil: "networkidle", timeout: 30000 });
          await new Promise<void>((resolve) => setTimeout(resolve, 1000));
        }
      } catch (error) {
        const viewKey = `${vp}/${theme}`;
        const message = error instanceof Error ? error.message : String(error);
        allIssues.push({
          severity: "high",
          where: viewKey,
          problem: `Could not test ${viewKey}: ${message}`,
          source: "check",
        });
      } finally {
        if (session) {
          try {
            await session.close();
          } catch {
            // ignore close errors
          }
        }
        if (opts.signal?.aborted) break outer;
      }
    }
  }

  if (!opts.signal?.aborted) {
    for (let i = 0; i < shots.length; i += 6) {
      if (opts.signal?.aborted) break;
      const batch = shots.slice(i, i + 6);
      allIssues.push(...(await opts.judge(batch)));
    }
  }

  const severityOrder: Record<QaIssue["severity"], number> = {
    high: 0,
    medium: 1,
    low: 2,
  };
  allIssues.sort((a, b) => severityOrder[a.severity] - severityOrder[b.severity]);

  return {
    mode: "sweep",
    url: opts.url,
    viewports: opts.viewports.flatMap((vp) => opts.themes.map((theme) => `${vp}/${theme}`)),
    stepsTaken,
    elementsClicked,
    elementsSeen: seenRoleNames.size,
    issues: allIssues,
  };
}
