import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import type OpenAI from "openai";
import { openSession, observe, act } from "./browser.js";
import { runChecks } from "./checks.js";
import type {
  CheckIssue,
  Observation,
  QaAction,
  QaIssue,
  QaReport,
  QaSession,
  Theme,
  UiElement,
  ViewportName,
} from "./types.js";

const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export async function runExplore(opts: {
  url: string;
  goal: string;
  viewport: ViewportName;
  theme: Theme;
  maxSteps: number;
  deny: RegExp;
  outDir: string;
  client: OpenAI;
  model: string;
  system?: string;
  onProgress: (text: string) => void;
  signal?: AbortSignal;
  storage?: Record<string, string>;
}): Promise<Omit<QaReport, "summary" | "dir" | "startedAt" | "finishedAt"> & { summary: string }> {
  const { url, goal, viewport, theme, maxSteps, deny, outDir, client, model, system, onProgress, signal } = opts;

  const actionLog: string[] = [];
  const issues: QaIssue[] = [];
  const measuredKeys = new Set<string>();
  const seenElements = new Set<string>();
  const coveredElements = new Set<string>();

  let elementsClicked = 0;
  let stepsTaken = 0;
  let summary = "";
  let finishSummary: string | null = null;
  let noActionStreak = 0;
  let currentElements: UiElement[] = [];
  let session: QaSession | undefined;

  try {
    session = await openSession(url, viewport, theme, opts.storage);

    for (let step = 1; step <= maxSteps; step++) {
      if (signal?.aborted) {
        const log = `step ${step}: aborted`;
        actionLog.push(log);
        summary = "Aborted by signal";
        stepsTaken = step;
        onProgress(`Step ${step}/${maxSteps} · ${log}`);
        break;
      }

      const obs: Observation = await observe(session);
      currentElements = obs.elements;
      const screenshotFile = `step-${String(step).padStart(3, "0")}.jpg`;
      const screenshotPath = join(outDir, screenshotFile);
      await writeFile(screenshotPath, obs.screenshot);

      for (const el of obs.elements) {
        seenElements.add(`${el.role} "${el.name}"`);
      }

      const checkIssues: CheckIssue[] = await runChecks(session.page, viewport);

      // Measured issues from automated checks
      for (const ci of checkIssues) {
        const severity =
          ci.kind === "overflow" || ci.kind === "console-error"
            ? "high"
            : ci.kind === "overlap" || ci.kind === "clipped-text"
              ? "medium"
              : "low";
        const key = `${ci.kind}|${ci.element ?? ""}|${ci.message}`;
        if (!measuredKeys.has(key)) {
          measuredKeys.add(key);
          issues.push({
            severity,
            where: `${viewport}/${theme} · ${obs.url}${ci.element ? ` · ${ci.element}` : ""}`,
            problem: ci.message,
            screenshot: screenshotFile,
            steps: [...actionLog],
            source: "check",
          });
        }
      }

      for (const err of obs.consoleErrors) {
        const key = `console-error||${err}`;
        if (!measuredKeys.has(key)) {
          measuredKeys.add(key);
          issues.push({
            severity: "high",
            where: `${viewport}/${theme} · ${obs.url}`,
            problem: err,
            screenshot: screenshotFile,
            steps: [...actionLog],
            source: "check",
          });
        }
      }

      const lastLog = actionLog.slice(-12).join("\n") || "(no actions yet)";
      const elementsLine =
        currentElements
          .map(
            (el) =>
              `[${el.ref}] ${el.role} "${el.name}" at ${el.box.x},${el.box.y} ${el.box.width}x${el.box.height}`,
          )
          .join("\n") || "(none)";
      const notClicked = [...seenElements]
        .filter((name) => !coveredElements.has(name))
        .slice(0, 40);
      const notClickedLines =
        notClicked.length > 0 ? notClicked.map((name) => `- ${name}`).join("\n") : "(none)";
      const problemsText =
        [
          ...checkIssues.map(
            (ci) => `${ci.kind}: ${ci.message}${ci.element ? ` (${ci.element})` : ""}`,
          ),
          ...obs.consoleErrors.map((err) => `console-error: ${err}`),
        ].join("\n") || "(none)";

      const promptText = `Goal: ${goal}
Step ${step} of ${maxSteps}
Viewport: ${viewport}, theme: ${theme}
Current URL: ${obs.url}

Last 12 action log lines:
${lastLog}

Elements on screen:
${elementsLine}

Elements not clicked yet in this run (cover these):
${notClickedLines}

Measured problems on this screen:
${problemsText}

Call exactly one action tool, plus report_issue for every real problem you see.`;

      const systemMessage = `You are a meticulous QA tester who explores every part of the UI, tries every control, checks layout, text, states and errors; never clicks elements that spend money or can't be undone.${system ? `\n\n${system}` : ""}`;

      const userContent = [
        { type: "text" as const, text: promptText },
        {
          type: "image_url" as const,
          image_url: {
            url: `data:image/jpeg;base64,${obs.screenshot.toString("base64")}`,
          },
        },
      ];

      const tools = [
        {
          type: "function" as const,
          function: {
            name: "click",
            description: "Click an element by its ref number",
            parameters: {
              type: "object",
              properties: {
                ref: { type: "integer" },
                why: { type: "string", description: "Why you are clicking this element" },
              },
              required: ["ref", "why"],
            },
          },
        },
        {
          type: "function" as const,
          function: {
            name: "hover",
            description: "Hover over an element by its ref number",
            parameters: {
              type: "object",
              properties: {
                ref: { type: "integer" },
                why: { type: "string", description: "Why you are hovering this element" },
              },
              required: ["ref", "why"],
            },
          },
        },
        {
          type: "function" as const,
          function: {
            name: "type",
            description: "Type text into an element by its ref number",
            parameters: {
              type: "object",
              properties: {
                ref: { type: "integer" },
                text: { type: "string" },
                why: { type: "string", description: "Why you are typing into this element" },
              },
              required: ["ref", "text", "why"],
            },
          },
        },
        {
          type: "function" as const,
          function: {
            name: "press",
            description: "Press a keyboard key",
            parameters: {
              type: "object",
              properties: {
                key: { type: "string" },
                why: { type: "string", description: "Why you are pressing this key" },
              },
              required: ["key", "why"],
            },
          },
        },
        {
          type: "function" as const,
          function: {
            name: "scroll",
            description: "Scroll the page up or down",
            parameters: {
              type: "object",
              properties: {
                direction: { type: "string", enum: ["up", "down"] },
                why: { type: "string", description: "Why you are scrolling" },
              },
              required: ["direction", "why"],
            },
          },
        },
        {
          type: "function" as const,
          function: {
            name: "click_xy",
            description: "Click at x,y coordinates (for canvas areas like a 3D scene)",
            parameters: {
              type: "object",
              properties: {
                x: { type: "number" },
                y: { type: "number" },
                why: { type: "string", description: "Why you are clicking these coordinates" },
              },
              required: ["x", "y", "why"],
            },
          },
        },
        {
          type: "function" as const,
          function: {
            name: "back",
            description: "Go back to the previous page",
            parameters: {
              type: "object",
              properties: {
                why: { type: "string", description: "Why you are going back" },
              },
              required: ["why"],
            },
          },
        },
        {
          type: "function" as const,
          function: {
            name: "report_issue",
            description: "Report a real problem you can see (one call per issue)",
            parameters: {
              type: "object",
              properties: {
                severity: { type: "string", enum: ["high", "medium", "low"] },
                where: { type: "string", description: "Where the issue is" },
                problem: { type: "string", description: "What the problem is" },
                fix: { type: "string", description: "Suggested fix" },
              },
              required: ["severity", "where", "problem"],
            },
          },
        },
        {
          type: "function" as const,
          function: {
            name: "finish",
            description: "Finish the QA run with a summary",
            parameters: {
              type: "object",
              properties: {
                summary: { type: "string", description: "Summary of what was found and done" },
              },
              required: ["summary"],
            },
          },
        },
      ];

      let response: OpenAI.Chat.Completions.ChatCompletion;
      const request = () =>
        client.chat.completions.create({
          model,
          messages: [
            { role: "system", content: systemMessage },
            { role: "user", content: userContent },
          ],
          tools,
          tool_choice: "auto",
          temperature: 0.2,
        });

      try {
        response = await request();
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        actionLog.push(`step ${step}: API error: ${msg}`);
        await delay(2000);
        try {
          response = await request();
        } catch (e2) {
          const msg2 = e2 instanceof Error ? e2.message : String(e2);
          actionLog.push(`step ${step}: API error (retry): ${msg2}`);
          issues.push({
            severity: "high",
            where: `${viewport}/${theme} · ${obs.url}`,
            problem: `Vision model API failed twice: ${msg2}`,
            screenshot: screenshotFile,
            steps: [...actionLog],
            source: "check",
          });
          stepsTaken = step;
          break;
        }
      }

      const toolCalls = response.choices?.[0]?.message?.tool_calls ?? [];
      let firstAction: { function: { name: string; arguments: string } } | null = null;

      for (const tc of toolCalls) {
        if (tc.type !== "function") continue;
        const name = tc.function?.name;
        let args: Record<string, unknown> = {};
        try {
          args = JSON.parse(tc.function?.arguments || "{}");
        } catch {
          args = {};
        }

        if (name === "report_issue") {
          const severity =
            args.severity === "high" || args.severity === "medium" || args.severity === "low"
              ? args.severity
              : "medium";
          const where = String(args.where ?? "");
          const problem = String(args.problem ?? "");
          const fix = args.fix ? String(args.fix) : undefined;

          if (problem) {
            issues.push({
              severity,
              where: `${viewport}/${theme} · ${where}`,
              problem,
              fix,
              screenshot: screenshotFile,
              steps: [...actionLog],
              source: "model",
            });
          }
        } else if (name === "finish") {
          finishSummary = String(args.summary ?? `Stopped after ${step} steps`);
        } else if (!firstAction && name !== "report_issue" && name !== "finish") {
          firstAction = { function: { name: name ?? "", arguments: tc.function?.arguments ?? "{}" } };
        }
      }

      if (finishSummary !== null) {
        summary = finishSummary;
        stepsTaken = step;
        const log = `step ${step}: finish — ${summary}`;
        actionLog.push(log);
        onProgress(`Step ${step}/${maxSteps} · ${log}`);
        break;
      }

      if (!firstAction) {
        noActionStreak++;
        const log = `step ${step}: no action`;
        actionLog.push(log);
        stepsTaken = step;
        onProgress(`Step ${step}/${maxSteps} · ${log}`);
        if (noActionStreak >= 2) {
          summary = `Stopped after ${step} steps`;
          break;
        }
        continue;
      }

      noActionStreak = 0;

      const actionName = firstAction.function.name;
      let rawArgs: Record<string, unknown> = {};
      try {
        rawArgs = JSON.parse(firstAction.function.arguments || "{}");
      } catch {
        rawArgs = {};
      }
      const why = typeof rawArgs.why === "string" ? rawArgs.why : "";

      let action: QaAction | null = null;
      let label = "";

      if (actionName === "click" || actionName === "hover" || actionName === "type") {
        const ref = Number(rawArgs.ref);
        if (!Number.isInteger(ref) || ref < 1) {
          const log = `step ${step}: failed: invalid ref for ${actionName}`;
          actionLog.push(log);
          stepsTaken = step;
          onProgress(`Step ${step}/${maxSteps} · ${log}`);
          continue;
        }

        const el = currentElements.find((e) => e.ref === ref);
        if (!el) {
          const log = `step ${step}: failed: ref ${ref} not found`;
          actionLog.push(log);
          stepsTaken = step;
          onProgress(`Step ${step}/${maxSteps} · ${log}`);
          continue;
        }

        const elName = `${el.role} "${el.name}"`;
        if ((actionName === "click" || actionName === "type") && deny.test(el.name)) {
          const log = `blocked: ${el.role} "${el.name}" (denied)`;
          actionLog.push(log);
          stepsTaken = step;
          onProgress(`Step ${step}/${maxSteps} · ${log}`);
          continue;
        }

        if (actionName === "click") {
          action = { kind: "click", ref };
          label = `click ${elName}`;
        } else if (actionName === "hover") {
          action = { kind: "hover", ref };
          label = `hover ${elName}`;
        } else {
          const text = typeof rawArgs.text === "string" ? rawArgs.text : "";
          action = { kind: "type", ref, text };
          label = `type "${text}" into ${elName}`;
        }
      } else if (actionName === "press") {
        const key = String(rawArgs.key ?? "");
        const inTextBox = await session.page
          .evaluate(() => {
            const el = document.activeElement as HTMLElement | null;
            return !!el && (el.tagName === "TEXTAREA" || el.isContentEditable);
          })
          .catch(() => false);
        if (/enter/i.test(key) && inTextBox) {
          const log = `blocked: pressing ${key} in a text box (it could send a message)`;
          actionLog.push(log);
          stepsTaken = step;
          onProgress(`Step ${step}/${maxSteps} · ${log}`);
          continue;
        }
        action = { kind: "press", key };
        label = `press "${key}"`;
      } else if (actionName === "scroll") {
        const direction = rawArgs.direction === "up" ? "up" : "down";
        action = { kind: "scroll", direction };
        label = `scroll ${direction}`;
      } else if (actionName === "click_xy") {
        const x = Number(rawArgs.x);
        const y = Number(rawArgs.y);
        if (!Number.isFinite(x) || !Number.isFinite(y)) {
          const log = `step ${step}: failed: invalid coordinates for click_xy`;
          actionLog.push(log);
          stepsTaken = step;
          onProgress(`Step ${step}/${maxSteps} · ${log}`);
          continue;
        }
        // The same do-not-click rule as for refs, applied to whatever is at that point
        const target = await session.page
          .evaluate(
            ([px, py]) => {
              let el = document.elementFromPoint(px, py) as HTMLElement | null;
              while (el && !el.matches("a,button,input,select,textarea,summary,[role],[onclick],[tabindex]")) el = el.parentElement;
              return el ? (el.getAttribute("aria-label") || el.textContent || (el as HTMLInputElement).value || el.title || "").trim().slice(0, 120) : "";
            },
            [x, y] as [number, number],
          )
          .catch(() => "");
        if (target && deny.test(target)) {
          const log = `blocked: click at (${x},${y}) on "${target}" (denied)`;
          actionLog.push(log);
          stepsTaken = step;
          onProgress(`Step ${step}/${maxSteps} · ${log}`);
          continue;
        }
        action = { kind: "click_xy", x, y };
        label = `click at (${x},${y})${target ? ` on "${target}"` : ""}`;
      } else if (actionName === "back") {
        action = { kind: "back" };
        label = "go back";
      } else {
        const log = `step ${step}: failed: unknown tool ${actionName}`;
        actionLog.push(log);
        stepsTaken = step;
        onProgress(`Step ${step}/${maxSteps} · ${log}`);
        continue;
      }

      try {
        await act(session, action);
        const suffix = why ? ` — ${why}` : "";
        const log = `step ${step}: ${label}${suffix}`;
        actionLog.push(log);

        if (action.kind === "click") {
          elementsClicked++;
          const el = currentElements.find((e) => e.ref === action.ref);
          if (el) coveredElements.add(`${el.role} "${el.name}"`);
        } else if (action.kind === "type" || action.kind === "hover") {
          const el = currentElements.find((e) => e.ref === action.ref);
          if (el) coveredElements.add(`${el.role} "${el.name}"`);
        }
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        const log = `step ${step}: failed: ${msg}`;
        actionLog.push(log);
      }

      stepsTaken = step;
      const lastLogLine = actionLog[actionLog.length - 1] ?? "";
      onProgress(`Step ${step}/${maxSteps} · ${lastLogLine}`);
    }

    if (stepsTaken === 0) {
      stepsTaken = maxSteps;
    }

    if (!summary) {
      summary = `Stopped after ${stepsTaken} steps`;
    }

    const severityOrder = { high: 0, medium: 1, low: 2 };
    issues.sort(
      (a, b) =>
        severityOrder[a.severity] - severityOrder[b.severity],
    );

    return {
      mode: "explore",
      url,
      viewports: [`${viewport}/${theme}`],
      stepsTaken,
      elementsClicked,
      elementsSeen: seenElements.size,
      issues,
      summary,
    };
  } finally {
    await session?.close();
  }
}
