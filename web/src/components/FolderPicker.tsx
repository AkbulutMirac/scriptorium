import { Button, Modal, Spinner } from "@heroui/react";
import { ArrowUp, Folder, Home } from "lucide-react";
import { useEffect, useState } from "react";
import { actions, useApp } from "../store";

/**
 * Server-side folder browser. Since browsers do not provide the full folder path for security reasons,
 * the backend lists the folders. "cwd": the chat's working folder, "dir": extra folder.
 */
export function FolderPicker() {
  const picker = useApp((s) => s.folderPicker);
  const chat = useApp((s) => (picker.chatId ? s.chats[picker.chatId] : undefined));
  const [manual, setManual] = useState("");
  const listing = picker.listing;

  useEffect(() => {
    setManual(listing?.path ?? "");
  }, [listing?.path]);

  const choose = (path: string) => {
    if (!path) return;
    if (picker.purpose === "dir" && chat) actions.setDirs(chat.chatId, [...chat.dirs, path]);
    else if (picker.chatId) actions.setChatCwd(picker.chatId, path);
    else actions.newClaudeChat(path);
    actions.closeFolderPicker();
  };

  return (
    <Modal.Backdrop isOpen={picker.open} onOpenChange={(o) => !o && actions.closeFolderPicker()}>
      <Modal.Container size="md">
        <Modal.Dialog>
          <Modal.Header>
            <Modal.Heading>{picker.purpose === "dir" ? "Select extra folder" : "Select working folder"}</Modal.Heading>
          </Modal.Header>
          <Modal.Body className="flex flex-col gap-2">
            <div className="flex items-center gap-1">
              <Button isIconOnly size="sm" variant="ghost" aria-label="Shortcuts" onPress={() => actions.browse()}>
                <Home size={15} />
              </Button>
              <Button isIconOnly size="sm" variant="ghost" aria-label="Parent folder" isDisabled={!listing?.parent} onPress={() => actions.browse(listing?.parent)}>
                <ArrowUp size={15} />
              </Button>
              <input
                value={manual}
                onChange={(e) => setManual(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && manual.trim() && actions.browse(manual.trim())}
                placeholder="Type a path and press Enter"
                className="font-code min-w-0 flex-1 rounded-md border border-field-border bg-field px-2 py-1.5 text-xs outline-none focus:border-accent"
                aria-label="Folder path"
              />
            </div>
            <div className="h-72 overflow-y-auto rounded-lg border border-separator">
              {!listing ? (
                <div className="flex h-full items-center justify-center">
                  <Spinner size="sm" />
                </div>
              ) : listing.dirs.length === 0 ? (
                <p className="p-4 text-center text-xs text-muted">No subfolders in this folder.</p>
              ) : (
                <ul>
                  {listing.dirs.map((d) => (
                    <li key={d.path}>
                      <button
                        type="button"
                        onClick={() => actions.browse(d.path)}
                        onDoubleClick={() => choose(d.path)}
                        className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-sm hover:bg-default-soft"
                        title={d.path}
                      >
                        <Folder size={15} className="shrink-0 text-accent" />
                        <span className="truncate">{d.name}</span>
                        {!listing.path && <span className="font-code ml-auto truncate text-[10px] text-muted">{d.path}</span>}
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
            <p className="text-[11px] text-muted">Click to open. Double-click or use the button below to select.</p>
          </Modal.Body>
          <Modal.Footer className="flex items-center gap-2">
            <span className="font-code min-w-0 flex-1 truncate text-xs text-muted">{listing?.path || "Open a folder"}</span>
            <Button size="sm" variant="secondary" onPress={() => actions.closeFolderPicker()}>
              Cancel
            </Button>
            <Button size="sm" variant="primary" isDisabled={!listing?.path} onPress={() => choose(listing!.path)}>
              Select this folder
            </Button>
          </Modal.Footer>
        </Modal.Dialog>
      </Modal.Container>
    </Modal.Backdrop>
  );
}
