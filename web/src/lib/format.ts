const rtf = new Intl.RelativeTimeFormat("en", { numeric: "auto" });

/** like "3 minutes ago", "yesterday" */
export function relativeTime(ms: number): string {
  const diff = (ms - Date.now()) / 1000;
  const abs = Math.abs(diff);
  if (abs < 60) return "just now";
  if (abs < 3600) return rtf.format(Math.round(diff / 60), "minute");
  if (abs < 86400) return rtf.format(Math.round(diff / 3600), "hour");
  if (abs < 86400 * 7) return rtf.format(Math.round(diff / 86400), "day");
  return new Date(ms).toLocaleDateString("en-US", { day: "numeric", month: "short" });
}

export function seconds(ms?: number): string {
  return ms === undefined ? "" : `${(ms / 1000).toFixed(1)} s`;
}

export function truncate(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}
