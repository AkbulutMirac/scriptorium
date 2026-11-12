import { chromium } from "playwright-core";
import type { Browser } from "playwright-core";
import { isLocalQaHost } from "./hosts.js";
import { VIEWPORTS } from "./types.js";
import type {
  Observation,
  QaAction,
  QaSession,
  Theme,
  UiElement,
  ViewportName,
} from "./types.js";

function clamp(value: string, max: number): string {
  return value.length > max ? value.slice(0, max) : value;
}

function firstLine(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  const first = message.split("\n")[0] ?? "";
  return first.trim() || "unknown error";
}

async function launchSystemBrowser(): Promise<Browser> {
  try {
    return await chromium.launch({ channel: "msedge", headless: true });
  } catch {
    // Try the next installed browser.
  }

  try {
    return await chromium.launch({ channel: "chrome", headless: true });
  } catch {
    // Try the final fallback.
  }

  try {
    return await chromium.launch({ headless: true });
  } catch {
    throw new Error("No Edge or Chrome was found.");
  }
}

export async function openSession(
  url: string,
  viewport: ViewportName,
  theme: Theme,
  /** localStorage entries set before the page loads (e.g. to skip a first-run dialog) */
  storage?: Record<string, string>,
): Promise<QaSession> {
  const browser = await launchSystemBrowser();

  try {
    const vp = VIEWPORTS[viewport];
    const context = await browser.newContext({
      viewport: { width: vp.width, height: vp.height },
      isMobile: vp.isMobile,
      hasTouch: vp.hasTouch,
      deviceScaleFactor: 1,
      colorScheme: theme,
    });
    // Pages may only be opened on local addresses, also after a redirect or a click on a link
    await context.route("**/*", (route) => {
      const req = route.request();
      if (req.isNavigationRequest() && !isLocalQaHost(new URL(req.url()).hostname)) return route.abort("blockedbyclient");
      return route.continue();
    });

    // tsx/esbuild adds __name() calls to functions sent to page.evaluate; the page has no such helper
    await context.addInitScript({ content: "globalThis.__name = globalThis.__name || ((f) => f);" });
    if (storage && Object.keys(storage).length) {
      await context.addInitScript({
        content: `try { const s = ${JSON.stringify(storage)}; for (const k in s) localStorage.setItem(k, s[k]); } catch {}`,
      });
    }
    const page = await context.newPage();
    const consoleErrors: string[] = [];

    page.on("console", (msg) => {
      if (msg.type() === "error") {
        consoleErrors.push(clamp(msg.text(), 300));
      }
    });

    page.on("pageerror", (err) => {
      consoleErrors.push(clamp(err.message, 300));
    });

    const session: QaSession = {
      page,
      viewport,
      theme,
      consoleErrors,
      close: async () => {
        await browser.close();
      },
    };

    await page.goto(url, { waitUntil: "networkidle", timeout: 30000 });
    await page.waitForTimeout(1500);

    return session;
  } catch (error) {
    await browser.close();
    throw error;
  }
}

export async function observe(s: QaSession): Promise<Observation> {
  const elements: UiElement[] = await s.page.evaluate(() => {
    const selector =
      'a[href], button, input:not([type=hidden]), textarea, select, summary, [role=button], [role=tab], [role=menuitem], [role=menuitemradio], [role=option], [role=switch], [role=checkbox], [role=radio], [role=link], [contenteditable=true], [tabindex]:not([tabindex="-1"])';

    const truncate = (value: string, max: number): string =>
      value.length > max ? value.slice(0, max) : value;
    const clean = (value: string): string =>
      value.replace(/\s+/g, " ").trim();

    const isVisible = (el: Element): boolean => {
      const check = (
        el as Element & {
          checkVisibility?: (options: {
            checkOpacity: boolean;
            checkVisibilityCSS: boolean;
          }) => boolean;
        }
      ).checkVisibility;

      if (typeof check === "function") {
        return check.call(el, {
          checkOpacity: true,
          checkVisibilityCSS: true,
        });
      }

      let current: Element | null = el;
      while (current) {
        const style = window.getComputedStyle(current);
        if (
          style.display === "none" ||
          style.visibility === "hidden" ||
          style.opacity === "0"
        ) {
          return false;
        }
        current = current.parentElement;
      }
      return true;
    };

    const accessibleName = (el: Element): string => {
      const ariaLabel = el.getAttribute("aria-label");
      if (ariaLabel !== null) return truncate(clean(ariaLabel), 80);

      const labelledBy = el.getAttribute("aria-labelledby");
      if (labelledBy) {
        const text = labelledBy
          .split(/\s+/)
          .map((id) => document.getElementById(id)?.textContent ?? "")
          .join(" ");
        const name = truncate(clean(text), 80);
        if (name) return name;
      }

      const innerText = (el as HTMLElement).innerText;
      if (innerText) {
        const name = truncate(clean(innerText), 80);
        if (name) return name;
      }

      const title = el.getAttribute("title");
      if (title) return truncate(clean(title), 80);

      const placeholder = el.getAttribute("placeholder");
      if (placeholder) return truncate(clean(placeholder), 80);

      const value = (el as HTMLInputElement).value;
      if (value) return truncate(clean(value), 80);

      return "";
    };

    const roleFor = (el: Element): string => {
      const role = el.getAttribute("role")?.trim();
      if (role) return role;

      const tag = el.tagName.toLowerCase();
      if (tag === "input") {
        return `input[${(el as HTMLInputElement).type || "text"}]`;
      }
      return tag;
    };

    document
      .querySelectorAll("[data-qa-ref]")
      .forEach((el) => el.removeAttribute("data-qa-ref"));

    const seen = new Set<Element>();
    const nodes = Array.from(document.querySelectorAll<Element>(selector));
    const results: {
      ref: number;
      role: string;
      name: string;
      box: { x: number; y: number; width: number; height: number };
    }[] = [];

    const viewportWidth = window.innerWidth;
    const viewportHeight = window.innerHeight;
    let ref = 1;

    for (const el of nodes) {
      if (seen.has(el)) continue;
      seen.add(el);

      if (!isVisible(el)) continue;

      const rect = el.getBoundingClientRect();
      if (rect.width < 2 || rect.height < 2) continue;
      if (
        rect.right <= 0 ||
        rect.bottom <= 0 ||
        rect.left >= viewportWidth ||
        rect.top >= viewportHeight
      ) {
        continue;
      }

      el.setAttribute("data-qa-ref", String(ref));
      results.push({
        ref,
        role: roleFor(el),
        name: accessibleName(el),
        box: {
          x: Math.round(rect.x),
          y: Math.round(rect.y),
          width: Math.round(rect.width),
          height: Math.round(rect.height),
        },
      });
      ref += 1;
    }

    return results;
  });

  const screenshot = await s.page.screenshot({ type: "jpeg", quality: 70 });
  const consoleErrors = [...s.consoleErrors];
  s.consoleErrors.splice(0);

  return {
    url: s.page.url(),
    title: await s.page.title(),
    screenshot,
    elements,
    consoleErrors,
  };
}

export async function act(s: QaSession, a: QaAction): Promise<void> {
  try {
    switch (a.kind) {
      case "click": {
        const locator = s.page.locator(`[data-qa-ref="${a.ref}"]`).first();
        if (VIEWPORTS[s.viewport].hasTouch) {
          await locator.tap({ timeout: 5000 });
        } else {
          await locator.click({ timeout: 5000 });
        }
        break;
      }
      case "hover": {
        await s.page
          .locator(`[data-qa-ref="${a.ref}"]`)
          .first()
          .hover({ timeout: 5000 });
        break;
      }
      case "type": {
        await s.page
          .locator(`[data-qa-ref="${a.ref}"]`)
          .first()
          .fill(a.text, { timeout: 5000 });
        break;
      }
      case "press": {
        await s.page.keyboard.press(a.key);
        break;
      }
      case "scroll": {
        await s.page.mouse.wheel(0, a.direction === "down" ? 600 : -600);
        break;
      }
      case "click_xy": {
        if (VIEWPORTS[s.viewport].hasTouch) {
          await s.page.touchscreen.tap(a.x, a.y);
        } else {
          await s.page.mouse.click(a.x, a.y);
        }
        break;
      }
      case "back": {
        await s.page.goBack({ timeout: 10000 });
        break;
      }
    }
  } catch (error) {
    const reason = firstLine(error);
    if ("ref" in a) {
      throw new Error(`Could not ${a.kind} [${a.ref}]: ${reason}`);
    }
    throw new Error(`Could not ${a.kind}: ${reason}`);
  }

  await s.page.waitForTimeout(700);
  await s.page
    .waitForLoadState("networkidle", { timeout: 3000 })
    .catch(() => {});
}
