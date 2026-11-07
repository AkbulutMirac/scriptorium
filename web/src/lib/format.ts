const rtf = new Intl.RelativeTimeFormat("tr", { numeric: "auto" });

/** "3 dakika önce", "dün" gibi */
export function relativeTime(ms: number): string {
  const diff = (ms - Date.now()) / 1000;
  const abs = Math.abs(diff);
  if (abs < 60) return "az önce";
  if (abs < 3600) return rtf.format(Math.round(diff / 60), "minute");
  if (abs < 86400) return rtf.format(Math.round(diff / 3600), "hour");
  if (abs < 86400 * 7) return rtf.format(Math.round(diff / 86400), "day");
  return new Date(ms).toLocaleDateString("tr-TR", { day: "numeric", month: "short" });
}

export function seconds(ms?: number): string {
  return ms === undefined ? "" : `${(ms / 1000).toFixed(1)} sn`;
}

export function truncate(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}
