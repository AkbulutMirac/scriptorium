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
import { SetupModal } from "./components/SetupModal";
import { WorkerModal } from "./components/WorkerModal";
import { Drawer } from "./components/Drawer";
import { MobileTabs } from "./components/MobileTabs";
import { actions, CLAUDE_ID, useApp } from "./store";
import { COMPACT_QUERY, MOBILE_QUERY, useMedia } from "./lib/useMedia";
import { useEffect } from "react";

export default function App() {
  const ui = useApp((s) => s.ui);
  const selected = useApp((s) => s.selected);
  const mainChatId = useApp((s) => s.mainChatId);
  const sideChatId = useApp((s) => s.sideChatId);
  const showSide = selected === CLAUDE_ID && !!sideChatId;
  const compact = useMedia(COMPACT_QUERY);
  const mobile = useMedia(MOBILE_QUERY);
  const showInfo = selected === CLAUDE_ID && ui.infoOpen && !!mainChatId;

  // Phones and tablets start with the history drawer closed so it does not cover the content.
  useEffect(() => {
    if (compact) actions.setUi({ historyOpen: false });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const chatPanel =
    selected === CLAUDE_ID ? mainChatId && <ClaudeChatPanel key={mainChatId} chatId={mainChatId} /> : <WorkerChatPanel key={selected} workerId={selected} />;

  return (
    <div className="flex h-full flex-col">
      <TopBar />
      <div className="relative flex min-h-0 min-w-0 flex-1 overflow-hidden">
        <HistoryPanel />

        <main className={`relative flex-1 overflow-hidden ${mobile ? (ui.mobileView === "scene" ? "" : "hidden") : "min-w-[220px]"}`}>
          <LibraryScene />
          <SceneOverlay />
          <ExpandOverlay />
        </main>

        {mobile ? (
          <aside className={`flex min-w-0 flex-1 flex-col overflow-hidden bg-surface ${ui.mobileView === "chat" ? "" : "hidden"}`}>{chatPanel}</aside>
        ) : (
          <>
            <ResizeHandle width={ui.chatWidth} min={360} max={960} onChange={(chatWidth) => actions.setUi({ chatWidth })} />
            <aside
              style={{ flexBasis: ui.chatWidth, maxWidth: compact ? "62%" : undefined }}
              className="flex min-w-[340px] shrink flex-col overflow-hidden border-l border-separator bg-surface"
            >
              {chatPanel}
            </aside>
          </>
        )}

        {showSide &&
          (compact ? (
            <Drawer side="right" width="min(440px, 100%)" onClose={() => actions.closeSideChat()}>
              <ClaudeChatPanel key={sideChatId} chatId={sideChatId!} />
            </Drawer>
          ) : (
            <>
              <ResizeHandle width={ui.sideWidth} min={320} max={800} onChange={(sideWidth) => actions.setUi({ sideWidth })} />
              <aside style={{ flexBasis: ui.sideWidth }} className="flex min-w-[300px] shrink flex-col overflow-hidden border-l border-separator bg-surface">
                <ClaudeChatPanel key={sideChatId} chatId={sideChatId!} />
              </aside>
            </>
          ))}

        {showInfo &&
          (compact ? (
            <Drawer side="right" width="min(18rem, 100%)" onClose={() => actions.setUi({ infoOpen: false })}>
              <InfoPanel key={mainChatId} chatId={mainChatId!} />
            </Drawer>
          ) : (
            <aside className="flex w-72 shrink-0 flex-col overflow-hidden border-l border-separator bg-surface">
              <InfoPanel key={mainChatId} chatId={mainChatId!} />
            </aside>
          ))}
      </div>
      {mobile && <MobileTabs />}
      <WorkerModal />
      <SetupModal />
      <FolderPicker />
    </div>
  );
}
