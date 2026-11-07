import { Button, Modal, Spinner } from "@heroui/react";
import { ArrowUp, Folder, Home } from "lucide-react";
import { useEffect, useState } from "react";
import { actions, useApp } from "../store";

/**
 * Sunucu tarafında çalışan klasör gezgini. Tarayıcılar güvenlik nedeniyle tam klasör yolu vermediği için
 * klasörleri arka uç listeler. "cwd": sohbetin çalışma klasörü, "dir": ek klasör.
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
            <Modal.Heading>{picker.purpose === "dir" ? "Ek klasör seç" : "Çalışma klasörü seç"}</Modal.Heading>
          </Modal.Header>
          <Modal.Body className="flex flex-col gap-2">
            <div className="flex items-center gap-1">
              <Button isIconOnly size="sm" variant="ghost" aria-label="Kısayollar" onPress={() => actions.browse()}>
                <Home size={15} />
              </Button>
              <Button isIconOnly size="sm" variant="ghost" aria-label="Üst klasör" isDisabled={!listing?.parent} onPress={() => actions.browse(listing?.parent)}>
                <ArrowUp size={15} />
              </Button>
              <input
                value={manual}
                onChange={(e) => setManual(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && manual.trim() && actions.browse(manual.trim())}
                placeholder="Yol yaz ve Enter'a bas"
                className="font-code min-w-0 flex-1 rounded-md border border-field-border bg-field px-2 py-1.5 text-xs outline-none focus:border-accent"
                aria-label="Klasör yolu"
              />
            </div>
            <div className="h-72 overflow-y-auto rounded-lg border border-separator">
              {!listing ? (
                <div className="flex h-full items-center justify-center">
                  <Spinner size="sm" />
                </div>
              ) : listing.dirs.length === 0 ? (
                <p className="p-4 text-center text-xs text-muted">Bu klasörde alt klasör yok.</p>
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
            <p className="text-[11px] text-muted">Tıklayınca içine girer. Çift tıklayınca ya da aşağıdaki butonla seçilir.</p>
          </Modal.Body>
          <Modal.Footer className="flex items-center gap-2">
            <span className="font-code min-w-0 flex-1 truncate text-xs text-muted">{listing?.path || "Bir klasöre gir"}</span>
            <Button size="sm" variant="secondary" onPress={() => actions.closeFolderPicker()}>
              Vazgeç
            </Button>
            <Button size="sm" variant="primary" isDisabled={!listing?.path} onPress={() => choose(listing!.path)}>
              Bu klasörü seç
            </Button>
          </Modal.Footer>
        </Modal.Dialog>
      </Modal.Container>
    </Modal.Backdrop>
  );
}
