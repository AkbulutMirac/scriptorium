import type { Page } from "playwright-core";

/** Shared types for the QA tools: qa_sweep (systematic: clicks everything) and qa_explore (an agent decides what to click). */

export type ViewportName = "desktop" | "tablet" | "phone";
export type Theme = "dark" | "light";

export const VIEWPORTS: Record<ViewportName, { width: number; height: number; isMobile: boolean; hasTouch: boolean }> = {
  desktop: { width: 1440, height: 900, isMobile: false, hasTouch: false },
  tablet: { width: 820, height: 1180, isMobile: true, hasTouch: true },
  phone: { width: 412, height: 915, isMobile: true, hasTouch: true },
};

export type Box = { x: number; y: number; width: number; height: number };

/** A visible interactive element on the page. `ref` is written to the element as data-qa-ref so it can be clicked later. */
export type UiElement = { ref: number; role: string; name: string; box: Box };

export type Observation = {
  url: string;
  title: string;
  /** JPEG of the current viewport */
  screenshot: Buffer;
  elements: UiElement[];
  /** Console errors and uncaught page errors since the previous observation */
  consoleErrors: string[];
};

export type QaAction =
  | { kind: "click"; ref: number }
  | { kind: "hover"; ref: number }
  | { kind: "type"; ref: number; text: string }
  | { kind: "press"; key: string }
  | { kind: "scroll"; direction: "up" | "down" }
  | { kind: "click_xy"; x: number; y: number }
  | { kind: "back" };

/** A problem found by measuring the page (no AI involved) */
export type CheckIssue = {
  kind: "overflow" | "small-target" | "overlap" | "clipped-text" | "console-error";
  message: string;
  /** Short description of the element, e.g. `button "Settings"` */
  element?: string;
  box?: Box;
};

export type QaIssue = {
  severity: "high" | "medium" | "low";
  /** Where it is: viewport, screen/state and element */
  where: string;
  problem: string;
  fix?: string;
  /** Screenshot file name inside the report folder */
  screenshot?: string;
  /** How to get there (actions in order) */
  steps?: string[];
  /** "check": measured; "model": seen by the QA model */
  source: "check" | "model";
};

export type QaReport = {
  mode: "sweep" | "explore";
  url: string;
  startedAt: number;
  finishedAt: number;
  viewports: string[];
  stepsTaken: number;
  elementsClicked: number;
  elementsSeen: number;
  issues: QaIssue[];
  summary: string;
  /** Folder with screenshots and report files */
  dir: string;
};

/** An open page plus the console errors collected since the last observation */
export type QaSession = {
  page: Page;
  viewport: ViewportName;
  theme: Theme;
  consoleErrors: string[];
  close(): Promise<void>;
};

/** Names of elements that must never be clicked: they spend money or usage, or can't be undone */
export const DEFAULT_DENY =
  /\b(send|delete|remove|quit|sign ?out|log ?out|sign ?in|save key|stop|shut ?down|uninstall|purchase|buy|pay|rename|as worker|register|on\/off)\b/i;
