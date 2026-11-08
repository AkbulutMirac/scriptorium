import { useEffect } from "react";

/** Panel sliding over the content on phones and tablets. Tapping the backdrop or Escape closes it. */
export function Drawer(props: { side: "left" | "right"; width: string; onClose: () => void; children: React.ReactNode }) {
  const { onClose } = props;
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const left = props.side === "left";
  return (
    <div className="absolute inset-0 z-40 flex" style={{ justifyContent: left ? "flex-start" : "flex-end" }}>
      <div className="absolute inset-0 bg-black/40" onClick={onClose} aria-hidden />
      <div
        style={{ width: props.width }}
        className={`drawer-panel relative flex h-full flex-col overflow-hidden bg-surface shadow-xl ${left ? "border-r drawer-left" : "border-l drawer-right"} border-separator`}
      >
        {props.children}
      </div>
    </div>
  );
}
