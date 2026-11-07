import type { LucideIcon } from "lucide-react";
import { useEffect, useLayoutEffect, useRef, useState } from "react";

export type MenuItem = { label: string; icon?: LucideIcon; danger?: boolean; onSelect: () => void } | "separator";

/** Sağ tık menüsü: imlecin olduğu yerde açılır, dışarı tıklayınca, Esc'ye basınca ya da kaydırınca kapanır. */
export function ContextMenu({ x, y, items, onClose }: { x: number; y: number; items: MenuItem[]; onClose: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ left: x, top: y });

  // Ekranın dışına taşmasın
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    setPos({ left: Math.min(x, window.innerWidth - r.width - 8), top: Math.min(y, window.innerHeight - r.height - 8) });
  }, [x, y]);

  useEffect(() => {
    const onDown = (e: MouseEvent) => !ref.current?.contains(e.target as Node) && onClose();
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("mousedown", onDown);
    window.addEventListener("keydown", onKey);
    window.addEventListener("blur", onClose);
    window.addEventListener("wheel", onClose, { passive: true });
    return () => {
      window.removeEventListener("mousedown", onDown);
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("blur", onClose);
      window.removeEventListener("wheel", onClose);
    };
  }, [onClose]);

  return (
    <div
      ref={ref}
      role="menu"
      style={{ left: pos.left, top: pos.top }}
      className="fixed z-50 min-w-52 rounded-xl border border-separator bg-overlay p-1 text-sm shadow-lg"
      onContextMenu={(e) => e.preventDefault()}
    >
      {items.map((it, i) =>
        it === "separator" ? (
          <div key={`sep-${i}`} className="my-1 h-px bg-separator" />
        ) : (
          <button
            key={it.label}
            type="button"
            role="menuitem"
            onClick={() => {
              onClose();
              it.onSelect();
            }}
            className={`flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-left ${it.danger ? "text-danger hover:bg-danger-soft" : "hover:bg-default-soft"}`}
          >
            {it.icon && <it.icon size={14} className={it.danger ? "" : "text-muted"} />}
            {it.label}
          </button>
        ),
      )}
    </div>
  );
}
