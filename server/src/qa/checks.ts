import type { Page } from "playwright-core";
import type { CheckIssue, ViewportName } from "./types.js";
import { VIEWPORTS } from "./types.js";

export async function runChecks(page: Page, viewport: ViewportName): Promise<CheckIssue[]> {
  return page.evaluate<CheckIssue[], { touch: boolean }>(({ touch }) => {
    const viewportWidth = window.innerWidth;
    const viewportHeight = window.innerHeight;

    const roundBox = (r: DOMRect): { x: number; y: number; width: number; height: number } => ({
      x: Math.round(r.x),
      y: Math.round(r.y),
      width: Math.round(r.width),
      height: Math.round(r.height),
    });

    const isVisible = (el: Element): boolean => {
      try {
        const maybeCheck = (el as Element & { checkVisibility?: (options: { checkOpacity?: boolean; checkVisibilityCSS?: boolean }) => boolean }).checkVisibility;
        if (typeof maybeCheck === "function") {
          return maybeCheck.call(el, { checkOpacity: true, checkVisibilityCSS: true });
        }
        const style = getComputedStyle(el);
        return style.display !== "none" && style.visibility !== "hidden" && style.opacity !== "0";
      } catch {
        return false;
      }
    };

    const intersectsViewport = (r: DOMRect): boolean =>
      r.width > 0 &&
      r.height > 0 &&
      r.right > 0 &&
      r.bottom > 0 &&
      r.left < viewportWidth &&
      r.top < viewportHeight;

    const collapsed = (s: string | null | undefined): string => (s || "").replace(/\s+/g, " ").trim();

    const describe = (el: Element): string => {
      try {
        const role = collapsed(el.getAttribute("role") || el.tagName.toLowerCase()) || el.tagName.toLowerCase();
        let name = collapsed(el.getAttribute("aria-label") || "");
        if (!name) {
          const htmlEl = el as HTMLElement;
          name = collapsed(htmlEl.innerText || el.textContent || "");
        }
        if (!name) name = collapsed(el.getAttribute("title") || el.getAttribute("placeholder") || "");
        return `${role} "${name.slice(0, 40)}"`;
      } catch {
        return el.tagName.toLowerCase();
      }
    };

    const hasClippingAncestorX = (el: Element): boolean => {
      try {
        let p = el.parentElement;
        while (p) {
          const ov = getComputedStyle(p).overflowX;
          if (ov === "auto" || ov === "scroll" || ov === "hidden") return true;
          p = p.parentElement;
        }
      } catch {
        // ignore
      }
      return false;
    };

    const interactiveSelector =
      'a[href], button, input:not([type=hidden]), textarea, select, [role=button], [role=tab], [role=menuitem], [role=option], [role=switch], [role=checkbox], [role=link]';

    const interactive: Array<{ el: Element; rect: DOMRect; box: { x: number; y: number; width: number; height: number } }> = [];
    try {
      const allInteractive = Array.from(document.querySelectorAll(interactiveSelector));
      for (const el of allInteractive) {
        try {
          if (!isVisible(el)) continue;
          const rect = el.getBoundingClientRect();
          if (!intersectsViewport(rect)) continue;
          interactive.push({ el, rect, box: roundBox(rect) });
        } catch {
          // ignore
        }
      }
    } catch {
      // ignore
    }

    // 1. overflow
    const overflowIssues: CheckIssue[] = [];
    try {
      const doc = document.documentElement;
      if (doc.scrollWidth > viewportWidth + 1) {
        overflowIssues.push({
          kind: "overflow",
          message: `Page scrolls sideways: content is ${Math.round(doc.scrollWidth - viewportWidth)} px wider than the screen`,
        });
      }
    } catch {
      // ignore
    }

    const reportedOverflowAncestors: Element[] = [];
    const overflowCandidates: Array<{ el: Element; rect: DOMRect; box: { x: number; y: number; width: number; height: number }; right: number; left: number }> = [];
    try {
      const all = Array.from(document.querySelectorAll("*"));
      for (const el of all) {
        try {
          if (!isVisible(el)) continue;
          const rect = el.getBoundingClientRect();
          if (!intersectsViewport(rect)) continue;
          const rightPast = rect.right - viewportWidth;
          const leftPast = -rect.left;
          if (rightPast <= 2 && leftPast <= 2) continue;
          if (hasClippingAncestorX(el)) continue;
          overflowCandidates.push({
            el,
            rect,
            box: roundBox(rect),
            right: Math.round(rightPast),
            left: Math.round(leftPast),
          });
        } catch {
          // ignore
        }
      }
    } catch {
      // ignore
    }

    for (const cand of overflowCandidates) {
      if (overflowIssues.length >= 8) break;
      try {
        const alreadyReported = reportedOverflowAncestors.some((anc) => anc !== cand.el && anc.contains(cand.el));
        if (alreadyReported) continue;
        reportedOverflowAncestors.push(cand.el);
        if (cand.right > 2) {
          overflowIssues.push({
            kind: "overflow",
            message: `Goes past the right edge by ${cand.right} px`,
            element: describe(cand.el),
            box: cand.box,
          });
        } else if (cand.left > 2) {
          overflowIssues.push({
            kind: "overflow",
            message: `Goes past the left edge by ${cand.left} px`,
            element: describe(cand.el),
            box: cand.box,
          });
        }
      } catch {
        // ignore
      }
    }

    // 2. small-target
    const smallTargetIssues: CheckIssue[] = [];
    if (touch) {
      for (const item of interactive) {
        if (smallTargetIssues.length >= 8) break;
        try {
          const w = Math.round(item.rect.width);
          const h = Math.round(item.rect.height);
          if (w < 32 || h < 32) {
            smallTargetIssues.push({
              kind: "small-target",
              message: `Tap target is ${w}x${h} px (at least 32x32 recommended)`,
              element: describe(item.el),
              box: item.box,
            });
          }
        } catch {
          // ignore
        }
      }
    }

    // 3. overlap
    const overlapIssues: CheckIssue[] = [];
    for (let i = 0; i < interactive.length && overlapIssues.length < 8; i++) {
      const a = interactive[i];
      for (let j = i + 1; j < interactive.length && overlapIssues.length < 8; j++) {
        const b = interactive[j];
        try {
          if (a.el.contains(b.el) || b.el.contains(a.el)) continue;
          const ix = Math.max(0, Math.min(a.rect.right, b.rect.right) - Math.max(a.rect.left, b.rect.left));
          if (ix <= 0) continue;
          const iy = Math.max(0, Math.min(a.rect.bottom, b.rect.bottom) - Math.max(a.rect.top, b.rect.top));
          if (iy <= 0) continue;
          const intersectionArea = ix * iy;
          const areaA = a.rect.width * a.rect.height;
          const areaB = b.rect.width * b.rect.height;
          const smallerArea = Math.min(areaA, areaB);
          if (smallerArea <= 0) continue;
          if (intersectionArea > smallerArea * 0.3) {
            overlapIssues.push({
              kind: "overlap",
              message: `Overlaps ${describe(b.el)}`,
              element: describe(a.el),
              box: a.box,
            });
          }
        } catch {
          // ignore
        }
      }
    }

    // 4. clipped-text
    const clippedTextIssues: CheckIssue[] = [];
    try {
      const all = Array.from(document.querySelectorAll("*"));
      for (const el of all) {
        if (clippedTextIssues.length >= 8) break;
        try {
          if (!isVisible(el)) continue;
          const rect = el.getBoundingClientRect();
          if (!intersectsViewport(rect)) continue;

          let hasDirectText = false;
          for (let k = 0; k < el.childNodes.length; k++) {
            const node = el.childNodes[k];
            if (node.nodeType === 3 && (node.textContent || "").trim().length > 0) {
              hasDirectText = true;
              break;
            }
          }
          if (!hasDirectText) continue;

          const needsX = el.scrollWidth - el.clientWidth;
          const needsY = el.scrollHeight - el.clientHeight;
          if (needsX <= 1 && needsY <= 1) continue;

          const style = getComputedStyle(el);
          const clippedX = needsX > 1 && (style.overflowX === "hidden" || style.overflowX === "clip");
          const clippedY = needsY > 1 && (style.overflowY === "hidden" || style.overflowY === "clip");
          if (!clippedX && !clippedY) continue;
          if (style.textOverflow === "ellipsis") continue;

          const lineClamp = style.getPropertyValue("-webkit-line-clamp");
          if (lineClamp && lineClamp !== "none" && lineClamp !== "") continue;

          const needed = Math.round(Math.max(needsX, needsY));
          clippedTextIssues.push({
            kind: "clipped-text",
            message: `Text is cut off (needs ${needed} px more)`,
            element: describe(el),
            box: roundBox(rect),
          });
        } catch {
          // ignore
        }
      }
    } catch {
      // ignore
    }

    return [
      ...overflowIssues.slice(0, 8),
      ...smallTargetIssues.slice(0, 8),
      ...overlapIssues.slice(0, 8),
      ...clippedTextIssues.slice(0, 8),
    ];
  }, { touch: VIEWPORTS[viewport].hasTouch });
}
