import { Button } from "@heroui/react";
import { X } from "lucide-react";
import { useEffect } from "react";
import { diffLineClass } from "../lib/diff";
import { actions, useApp } from "../store";
import { CopyButton, Markdown } from "./chat/Markdown";

/** Uzun içerik (kod, diff, araç çıktısı) 3D sahnenin üstünde büyük açılır */
export function ExpandOverlay() {
  const overlay = useApp((s) => s.overlay);

  useEffect(() => {
    if (!overlay) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && actions.showOverlay(null);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [overlay]);

  if (!overlay) return null;

  return (
    <div className="absolute inset-0 z-40 flex bg-background/60 p-4 backdrop-blur-sm">
      <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-xl border border-separator bg-surface shadow-lg">
        <div className="flex items-center gap-2 border-b border-separator px-3 py-2">
          <span className="font-code min-w-0 flex-1 truncate text-sm font-medium">{overlay.title}</span>
          <CopyButton text={overlay.body} />
          <Button isIconOnly size="sm" variant="ghost" aria-label="Kapat" onPress={() => actions.showOverlay(null)}>
            <X size={16} />
          </Button>
        </div>
        <div className="min-h-0 flex-1 overflow-auto p-4">
          {overlay.mono ? (
            <pre className="font-code text-[13px] leading-relaxed">
              {overlay.body.split("\n").map((line, i) => (
                <div
                  key={i}
                  className={overlay.diff ? diffLineClass(line) : ""}
                >
                  {line || " "}
                </div>
              ))}
            </pre>
          ) : (
            <Markdown text={overlay.body} />
          )}
        </div>
      </div>
    </div>
  );
}
