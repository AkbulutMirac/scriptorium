import { ArrowRight } from "lucide-react";
import type { ContextInfo, LimitWindow, UsageInfo } from "../../protocol";

/** Converts limit usage to a percentage (API may return 0-1 or 0-100) */
export function pct(w?: LimitWindow): number | null {
  if (!w || w.utilization == null) return null;
  return Math.round(w.utilization <= 1 ? w.utilization * 100 : w.utilization);
}

/** "Reset Sun 02:20" */
export function resetText(w?: LimitWindow): string {
  if (!w?.resetsAt) return "";
  const d = new Date(w.resetsAt);
  if (Number.isNaN(d.getTime())) return "";
  return `Reset ${d.toLocaleString("en-US", { weekday: "short", hour: "2-digit", minute: "2-digit" })}`;
}

const barColor = (p: number) => (p > 85 ? "bg-danger" : p > 65 ? "bg-warning" : "bg-accent");

function LimitRow({ label, w, short }: { label: string; w?: LimitWindow; short?: boolean }) {
  const p = pct(w);
  if (p == null) return null;
  return (
    <div className="flex flex-col gap-1">
      <div className="flex min-w-0 items-baseline gap-2 text-xs">
        <span className="shrink-0 font-medium text-foreground">{label}</span>
        <span className="min-w-0 flex-1 truncate text-right text-muted" title={resetText(w)}>
          {short ? resetText(w).replace(/^Reset /, "") : resetText(w)}
        </span>
        <span className="w-9 shrink-0 text-right tabular-nums text-foreground">{p}%</span>
      </div>
      <div className="h-1.5 overflow-hidden rounded-full bg-default-soft">
        <div className={`h-full rounded-full ${barColor(p)}`} style={{ width: `${Math.min(100, p)}%` }} />
      </div>
    </div>
  );
}

const PLAN_NAMES: Record<string, string> = { pro: "Pro", max: "Max", team: "Team", enterprise: "Enterprise", free: "Free" };

/** The "Plan usage limits" card from the Claude app */
export function UsageCard({ usage, context, onSeeAll, fluid = false }: { usage?: UsageInfo; context?: ContextInfo; onSeeAll?: () => void; /** Fill the containing area (info panel) */ fluid?: boolean }) {
  const plan = usage?.subscription ? PLAN_NAMES[usage.subscription.toLowerCase()] ?? usage.subscription : null;
  return (
    <div className={`flex min-w-0 flex-col gap-3 ${fluid ? "w-full" : "w-80 p-1"}`}>
      <div className="flex items-center gap-2 text-xs">
        <span className="text-muted">
          Plan usage limits{plan && <> · <span className="text-foreground">{plan}</span></>}
        </span>
        <span className="flex-1" />
        {onSeeAll && (
          <button type="button" onClick={onSeeAll} className="flex items-center gap-1 font-medium text-foreground hover:text-accent">
            See all <ArrowRight size={12} />
          </button>
        )}
      </div>
      {!usage ? (
        <p className="text-xs text-muted">Loading…</p>
      ) : !usage.available ? (
        <p className="text-xs text-muted">Plan limits aren't shown for this login type (API key logins have no limits).</p>
      ) : (
        <>
          <LimitRow label="5-hour limit" w={usage.fiveHour} short={fluid} />
          <LimitRow label="Weekly · all models" w={usage.sevenDay} short={fluid} />
          <LimitRow label="Weekly · Opus" w={usage.sevenDayOpus} short={fluid} />
          <LimitRow label="Weekly · Sonnet" w={usage.sevenDaySonnet} short={fluid} />
        </>
      )}
      {context && (
        <div className="flex flex-col gap-1 border-t border-separator pt-2.5">
          <div className="flex min-w-0 items-baseline gap-2 text-xs">
            <span className="shrink-0 font-medium text-foreground">Context</span>
            <span className="min-w-0 flex-1 truncate text-right text-muted">{context.totalTokens.toLocaleString("en-US")} / {context.maxTokens.toLocaleString("en-US")} token</span>
            <span className="w-9 text-right tabular-nums text-foreground">{Math.round(context.percentage)}%</span>
          </div>
          <div className="h-1.5 overflow-hidden rounded-full bg-default-soft">
            <div className={`h-full rounded-full ${barColor(context.percentage)}`} style={{ width: `${Math.min(100, context.percentage)}%` }} />
          </div>
        </div>
      )}
    </div>
  );
}
