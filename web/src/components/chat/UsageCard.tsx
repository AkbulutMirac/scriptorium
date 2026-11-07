import { ArrowRight } from "lucide-react";
import type { ContextInfo, LimitWindow, UsageInfo } from "../../protocol";

/** Limit kullanımını yüzdeye çevirir (API 0-1 ya da 0-100 döndürebilir) */
export function pct(w?: LimitWindow): number | null {
  if (!w || w.utilization == null) return null;
  return Math.round(w.utilization <= 1 ? w.utilization * 100 : w.utilization);
}

/** "Sıfırlanma Paz 02:20" */
export function resetText(w?: LimitWindow): string {
  if (!w?.resetsAt) return "";
  const d = new Date(w.resetsAt);
  if (Number.isNaN(d.getTime())) return "";
  return `Sıfırlanma ${d.toLocaleString("tr-TR", { weekday: "short", hour: "2-digit", minute: "2-digit" })}`;
}

const barColor = (p: number) => (p > 85 ? "bg-danger" : p > 65 ? "bg-warning" : "bg-accent");

function LimitRow({ label, w }: { label: string; w?: LimitWindow }) {
  const p = pct(w);
  if (p == null) return null;
  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-baseline gap-2 text-xs">
        <span className="font-medium text-foreground">{label}</span>
        <span className="flex-1" />
        <span className="text-muted">{resetText(w)}</span>
        <span className="w-9 text-right tabular-nums text-foreground">%{p}</span>
      </div>
      <div className="h-1.5 overflow-hidden rounded-full bg-default-soft">
        <div className={`h-full rounded-full ${barColor(p)}`} style={{ width: `${Math.min(100, p)}%` }} />
      </div>
    </div>
  );
}

const PLAN_NAMES: Record<string, string> = { pro: "Pro", max: "Max", team: "Team", enterprise: "Enterprise", free: "Free" };

/** Claude uygulamasındaki "Plan usage limits" kartı */
export function UsageCard({ usage, context, onSeeAll }: { usage?: UsageInfo; context?: ContextInfo; onSeeAll?: () => void }) {
  const plan = usage?.subscription ? PLAN_NAMES[usage.subscription.toLowerCase()] ?? usage.subscription : null;
  return (
    <div className="flex w-80 flex-col gap-3 p-1">
      <div className="flex items-center gap-2 text-xs">
        <span className="text-muted">
          Plan kullanım limitleri{plan && <> · <span className="text-foreground">{plan}</span></>}
        </span>
        <span className="flex-1" />
        {onSeeAll && (
          <button type="button" onClick={onSeeAll} className="flex items-center gap-1 font-medium text-foreground hover:text-accent">
            Tümünü gör <ArrowRight size={12} />
          </button>
        )}
      </div>
      {!usage ? (
        <p className="text-xs text-muted">Yükleniyor…</p>
      ) : !usage.available ? (
        <p className="text-xs text-muted">Plan limitleri bu giriş türünde görünmüyor (API anahtarıyla girişte limit yoktur).</p>
      ) : (
        <>
          <LimitRow label="5 saatlik limit" w={usage.fiveHour} />
          <LimitRow label="Haftalık · tüm modeller" w={usage.sevenDay} />
          <LimitRow label="Haftalık · Opus" w={usage.sevenDayOpus} />
          <LimitRow label="Haftalık · Sonnet" w={usage.sevenDaySonnet} />
        </>
      )}
      {context && (
        <div className="flex flex-col gap-1 border-t border-separator pt-2.5">
          <div className="flex items-baseline gap-2 text-xs">
            <span className="font-medium text-foreground">Bağlam</span>
            <span className="flex-1" />
            <span className="text-muted">{context.totalTokens.toLocaleString("tr-TR")} / {context.maxTokens.toLocaleString("tr-TR")} token</span>
            <span className="w-9 text-right tabular-nums text-foreground">%{Math.round(context.percentage)}</span>
          </div>
          <div className="h-1.5 overflow-hidden rounded-full bg-default-soft">
            <div className={`h-full rounded-full ${barColor(context.percentage)}`} style={{ width: `${Math.min(100, context.percentage)}%` }} />
          </div>
        </div>
      )}
    </div>
  );
}
