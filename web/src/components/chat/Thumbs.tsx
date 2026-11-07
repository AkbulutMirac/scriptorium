import type { ChatImage } from "../../lib/claudeItems";
import { actions } from "../../store";

/** Mesaj ve araç sonuçlarındaki görseller: küçük resim, tıklayınca ortada büyük açılır */
export function Thumbs({ images, align = "start" }: { images?: ChatImage[]; align?: "start" | "end" }) {
  if (!images?.length) return null;
  return (
    <div className={`flex max-w-full flex-wrap gap-1.5 ${align === "end" ? "justify-end" : ""}`}>
      {images.map((img, i) => (
        <button
          key={i}
          type="button"
          onClick={() => actions.showOverlay({ title: img.name ?? `Görsel ${i + 1}`, body: "", image: img.src })}
          className="overflow-hidden rounded-lg border border-separator bg-default-soft transition hover:opacity-90"
          aria-label={`${img.name ?? "Görsel"} büyüt`}
        >
          <img src={img.src} alt={img.name ?? ""} className="max-h-40 max-w-56 object-cover" loading="lazy" />
        </button>
      ))}
    </div>
  );
}
