import { useSyncExternalStore } from "react";

/** Phone and portrait tablet: one panel at a time with a bottom tab bar. */
export const MOBILE_QUERY = "(max-width: 1023px)";
/** Phone and tablet: side panels open as drawers over the content. */
export const COMPACT_QUERY = "(max-width: 1279px)";

export function useMedia(query: string): boolean {
  return useSyncExternalStore(
    (cb) => {
      const m = window.matchMedia(query);
      m.addEventListener("change", cb);
      return () => m.removeEventListener("change", cb);
    },
    () => window.matchMedia(query).matches,
  );
}

export const isMobileNow = () => window.matchMedia(MOBILE_QUERY).matches;
export const isCompactNow = () => window.matchMedia(COMPACT_QUERY).matches;
