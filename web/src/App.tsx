import { ClaudeChatPanel } from "./components/chat/ClaudeChatPanel";
import { InfoPanel } from "./components/chat/InfoPanel";
import { WorkerChatPanel } from "./components/chat/WorkerChatPanel";
import { ExpandOverlay } from "./components/ExpandOverlay";
import { FolderPicker } from "./components/FolderPicker";
import { HistoryPanel } from "./components/HistoryPanel";
import { ResizeHandle } from "./components/ResizeHandle";
import { LibraryScene } from "./components/scene/LibraryScene";
import { SceneOverlay } from "./components/SceneOverlay";
import { TopBar } from "./components/TopBar";
import { WorkerModal } from "./components/WorkerModal";
import { actions, CLAUDE_ID, useApp } from "./store";

export default function App() {
  const ui = useApp((s) => s.ui);
  const selected = useApp((s) => s.selected);
  const mainChatId = useApp((s) => s.mainChatId);
  const sideChatId = useApp((s) => s.sideChatId);
  const showSide = selected === CLAUDE_ID && !!sideChatId;

  return (
    <div className="flex h-full flex-col">
      <TopBar />
      <div className="flex min-h-0 min-w-0 flex-1 overflow-hidden">
        <HistoryPanel />

        <main className="relative min-w-[220px] flex-1 overflow-hidden">
          <LibraryScene />
          <SceneOverlay />
          <ExpandOverlay />
        </main>

        <ResizeHandle width={ui.chatWidth} min={360} max={960} onChange={(chatWidth) => actions.setUi({ chatWidth })} />
        <aside style={{ flexBasis: ui.chatWidth }} className="flex min-w-[340px] shrink flex-col overflow-hidden border-l border-separator bg-surface">
          {selected === CLAUDE_ID ? (
            mainChatId && <ClaudeChatPanel key={mainChatId} chatId={mainChatId} />
          ) : (
            <WorkerChatPanel key={selected} workerId={selected} />
          )}
        </aside>

        {showSide && (
          <>
            <ResizeHandle width={ui.sideWidth} min={320} max={800} onChange={(sideWidth) => actions.setUi({ sideWidth })} />
            <aside style={{ flexBasis: ui.sideWidth }} className="flex min-w-[300px] shrink flex-col overflow-hidden border-l border-separator bg-surface">
              <ClaudeChatPanel key={sideChatId} chatId={sideChatId!} />
            </aside>
          </>
        )}

        {selected === CLAUDE_ID && ui.infoOpen && mainChatId && (
          <aside className="flex w-72 shrink-0 flex-col overflow-hidden border-l border-separator bg-surface">
            <InfoPanel key={mainChatId} chatId={mainChatId} />
          </aside>
        )}
      </div>
      <WorkerModal />
      <FolderPicker />
    </div>
  );
}
