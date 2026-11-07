import { Tooltip } from "@heroui/react";
import { Wallet } from "lucide-react";
import { relativeTime } from "../lib/format";
import { actions, useApp } from "../store";

const SYMBOL: Record<string, string> = { USD: "$", CNY: "¥" };

export function money(n: number | undefined, currency?: string) {
  if (n === undefined || Number.isNaN(n)) return "–";
  const sym = SYMBOL[currency ?? ""] ?? "";
  return `${sym}${n.toLocaleString("tr-TR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}${sym ? "" : ` ${currency ?? ""}`}`;
}

/** DeepSeek kalan bakiyesi. Üzerine gelince ayrıntı, tıklayınca yenilenir. */
export function DeepSeekBalanceChip({ compact = false }: { compact?: boolean }) {
  const b = useApp((s) => s.deepseekBalance);
  const hasDeepseek = useApp((s) => s.workers.some((w) => w.provider === "deepseek"));
  if (!b || !hasDeepseek) return null;
  if (!b.ok && b.error === "DEEPSEEK_API_KEY yok") return null;

  const low = b.ok && (b.available === false || (b.total ?? 0) < 0.5);
  const tone = !b.ok ? "text-danger" : low ? "text-warning" : "text-muted";

  return (
    <Tooltip delay={150}>
      <button
        type="button"
        onClick={() => actions.refreshDeepseekBalance()}
        className={`flex items-center gap-1.5 rounded-md px-2 py-1 text-xs hover:bg-default-soft ${tone}`}
        aria-label="DeepSeek bakiyesi"
      >
        <Wallet size={14} />
        {!compact && <span>DeepSeek</span>}
        <span className="tabular-nums">{b.ok ? money(b.total, b.currency) : "hata"}</span>
      </button>
      <Tooltip.Content placement="bottom end" className="p-2">
        <div className="flex w-60 flex-col gap-1.5 text-xs">
          <span className="font-medium">DeepSeek bakiyesi</span>
          {b.ok ? (
            <>
              <Row label="Toplam" value={money(b.total, b.currency)} strong />
              <Row label="Yüklenen" value={money(b.toppedUp, b.currency)} />
              <Row label="Hediye" value={money(b.granted, b.currency)} />
              {b.available === false && <span className="text-danger">Bakiye yetersiz: DeepSeek işçileri çalışmaz.</span>}
              {low && b.available !== false && <span className="text-warning">Bakiye azaldı.</span>}
            </>
          ) : (
            <span className="text-danger">{b.error}</span>
          )}
          <span className="text-[10px] text-muted">Son kontrol {relativeTime(b.checkedAt)} · yenilemek için tıkla</span>
        </div>
      </Tooltip.Content>
    </Tooltip>
  );
}

function Row({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <div className="flex items-baseline justify-between gap-2">
      <span className="text-muted">{label}</span>
      <span className={`tabular-nums ${strong ? "font-medium" : ""}`}>{value}</span>
    </div>
  );
}
