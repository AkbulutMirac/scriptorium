import { useRef, useState } from "react";

/** Sağdaki panelin sol kenarı. Sürükleyince panel genişliği değişir. */
export function ResizeHandle(props: { width: number; min: number; max: number; onChange: (w: number) => void }) {
  const [dragging, setDragging] = useState(false);
  const start = useRef({ x: 0, width: 0 });

  return (
    <div
      role="separator"
      aria-orientation="vertical"
      aria-label="Panel genişliğini değiştir"
      className={`resize-handle ${dragging ? "dragging" : ""}`}
      onPointerDown={(e) => {
        start.current = { x: e.clientX, width: props.width };
        setDragging(true);
        e.currentTarget.setPointerCapture(e.pointerId);
      }}
      onPointerMove={(e) => {
        if (!dragging) return;
        const w = start.current.width + (start.current.x - e.clientX);
        props.onChange(Math.round(Math.min(props.max, Math.max(props.min, w))));
      }}
      onPointerUp={() => setDragging(false)}
      onDoubleClick={() => props.onChange(520)}
    />
  );
}
