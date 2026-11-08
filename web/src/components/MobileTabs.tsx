import { Library, MessageSquare } from "lucide-react";
import { actions, agentMeta, useApp } from "../store";

/** Bottom tab bar on phones: switches between the 3D office and the chat. */
export function MobileTabs() {
  const view = useApp((s) => s.ui.mobileView);
  const selected = useApp((s) => s.selected);
  const workers = useApp((s) => s.workers);
  const meta = agentMeta(selected, workers);
  const tab = (id: "scene" | "chat", icon: React.ReactNode, label: React.ReactNode) => (
    <button
      type="button"
      onClick={() => actions.setUi({ mobileView: id })}
      aria-current={view === id ? "page" : undefined}
      className={`flex min-w-0 flex-1 flex-col items-center justify-center gap-0.5 text-[11px] font-medium ${view === id ? "text-accent" : "text-muted"}`}
    >
      {icon}
      <span className="max-w-full truncate px-2">{label}</span>
    </button>
  );
  return (
    <nav className="flex h-14 shrink-0 border-t border-separator bg-surface pb-[env(safe-area-inset-bottom)]" aria-label="View">
      {tab("scene", <Library size={20} />, "Office")}
      {tab("chat", <MessageSquare size={20} />, <>Chat · {meta.name}</>)}
    </nav>
  );
}
