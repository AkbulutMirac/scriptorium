import { Label, ListBox, Select } from "@heroui/react";
import { actions, CLAUDE_ID, useApp } from "../../store";

/** Sohbet panelinin başındaki ajan seçici: Claude ve tüm işçiler */
export function AgentSelect() {
  const selected = useApp((s) => s.selected);
  const workers = useApp((s) => s.workers);

  const options = [
    { id: CLAUDE_ID, name: "Claude", color: "#D97757", ok: true, hint: "Baş yazıcı" },
    ...workers.map((w) => ({ id: w.id, name: w.name, color: w.color, ok: w.available?.ok ?? false, hint: w.local ? "local" : w.model })),
  ];

  return (
    <Select value={selected} onChange={(k) => k != null && actions.selectAgent(String(k))} className="min-w-0 flex-1">
      <Label className="sr-only">Ajan</Label>
      <Select.Trigger>
        <Select.Value />
        <Select.Indicator />
      </Select.Trigger>
      <Select.Popover>
        <ListBox>
          {options.map((o) => (
            <ListBox.Item key={o.id} id={o.id} textValue={o.name}>
              <span className="size-2.5 shrink-0 rounded-full" style={{ background: o.color }} />
              <span className="font-medium">{o.name}</span>
              <span className="truncate text-xs text-muted">{o.hint}</span>
              {o.id !== CLAUDE_ID && <span className={`ml-auto size-1.5 shrink-0 rounded-full ${o.ok ? "bg-success" : "bg-danger"}`} />}
              <ListBox.ItemIndicator />
            </ListBox.Item>
          ))}
        </ListBox>
      </Select.Popover>
    </Select>
  );
}
