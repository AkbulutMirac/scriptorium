import { Label, ListBox, Select } from "@heroui/react";
import { useEffect, useRef } from "react";

/** Liste en alttayken yeni içerik gelince aşağı kaydırır; kullanıcı yukarı çıktıysa dokunmaz. */
export function useAutoScroll<T extends HTMLElement>(deps: unknown[]) {
  const ref = useRef<T>(null);
  const atBottom = useRef(true);
  useEffect(() => {
    const el = ref.current;
    if (el && atBottom.current) el.scrollTop = el.scrollHeight;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
  const onScroll = (e: React.UIEvent<T>) => {
    const el = e.currentTarget;
    atBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < 60;
  };
  return { ref, onScroll };
}

export type Option = { value: string; label: string };

/** Başlıktaki küçük seçiciler (model, izin modu) */
export function MiniSelect(props: { label: string; value: string; options: Option[]; onChange: (v: string) => void; className?: string }) {
  return (
    // Boş değer ("varsayılan") liste anahtarı olarak "_" ile temsil edilir
    <Select
      value={props.value || "_"}
      onChange={(k) => k != null && props.onChange(String(k) === "_" ? "" : String(k))}
      className={props.className}
    >
      <Label className="sr-only">{props.label}</Label>
      <Select.Trigger className="h-7 min-h-7 whitespace-nowrap text-xs">
        <Select.Value />
        <Select.Indicator />
      </Select.Trigger>
      <Select.Popover>
        <ListBox>
          {props.options.map((o) => (
            <ListBox.Item key={o.value || "_"} id={o.value || "_"} textValue={o.label}>
              {o.label}
              <ListBox.ItemIndicator />
            </ListBox.Item>
          ))}
        </ListBox>
      </Select.Popover>
    </Select>
  );
}

export function StreamingDots() {
  return (
    <span className="inline-flex gap-1">
      {[0, 1, 2].map((i) => (
        <span key={i} className="size-1.5 animate-bounce rounded-full bg-muted" style={{ animationDelay: `${i * 120}ms` }} />
      ))}
    </span>
  );
}
