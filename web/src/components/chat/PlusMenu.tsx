import { Button, Popover, Spinner } from "@heroui/react";
import { ArrowLeft, ChevronRight, FolderPlus, Paperclip, Plug, Plus, Puzzle, SquareSlash, X } from "lucide-react";
import { useState, type ReactNode } from "react";
import type { SlashCommandInfo } from "../../protocol";
import { actions, useApp } from "../../store";
import { ConnectorList } from "./InfoPanel";

type View = "main" | "folder" | "commands" | "connectors" | "plugins";

/** The "+" menu to the left of the input box (like in the Claude app) */
export function PlusMenu(props: { chatId: string; onPickFiles: () => void; onPickCommand: (c: SlashCommandInfo) => void }) {
  const chat = useApp((s) => s.chats[props.chatId]);
  const globalCommands = useApp((s) => s.globalInfo?.commands);
  const [open, setOpen] = useState(false);
  const [view, setView] = useState<View>("main");
  const [path, setPath] = useState("");
  const [filter, setFilter] = useState("");

  const close = () => {
    setOpen(false);
    setView("main");
  };
  const commands: SlashCommandInfo[] =
    chat?.info?.commands ?? globalCommands ?? chat?.init?.slashCommands.map((name) => ({ name, description: "" })) ?? [];
  const shownCommands = commands.filter((c) => c.name.toLowerCase().includes(filter.toLowerCase()));

  return (
    <Popover
      isOpen={open}
      onOpenChange={(o) => {
        setOpen(o);
        if (o) {
          setView("main");
          setFilter("");
          actions.requestInfo(props.chatId);
        }
      }}
    >
      <Button isIconOnly size="sm" variant="ghost" aria-label="Add and tools">
        <Plus size={18} />
      </Button>
      <Popover.Content placement="top start" className="w-80">
        <Popover.Dialog className="p-1">
          {view === "main" && (
            <ul className="flex flex-col">
              <MenuItem
                icon={<Paperclip size={15} />}
                label="Add file or photo"
                hint="Image, PDF, text"
                onPress={() => {
                  close();
                  props.onPickFiles();
                }}
              />
              <MenuItem icon={<FolderPlus size={15} />} label="Add folder" onPress={() => setView("folder")} chevron />
              <MenuItem icon={<SquareSlash size={15} />} label="Slash commands" onPress={() => setView("commands")} chevron />
              <MenuItem icon={<Plug size={15} />} label="Connectors" onPress={() => setView("connectors")} chevron />
              <MenuItem icon={<Puzzle size={15} />} label="Plugins" onPress={() => setView("plugins")} chevron />
            </ul>
          )}

          {view === "folder" && chat && (
            <SubView title="Add folder" onBack={() => setView("main")}>
              <p className="text-xs text-muted">Claude can also access files in these folders.</p>
              <Button
                size="sm"
                variant="secondary"
                onPress={() => {
                  close();
                  actions.openFolderPicker("dir", props.chatId);
                }}
              >
                <FolderPlus size={14} /> Browse folder…
              </Button>
              <p className="text-[11px] text-muted">or type the full path:</p>
              {chat.dirs.map((d) => (
                <div key={d} className="flex items-center gap-1 rounded-md bg-default-soft px-2 py-1">
                  <span className="font-code min-w-0 flex-1 truncate text-xs" title={d}>
                    {d}
                  </span>
                  <button type="button" aria-label="Remove" className="text-muted hover:text-danger" onClick={() => actions.setDirs(props.chatId, chat.dirs.filter((x) => x !== d))}>
                    <X size={12} />
                  </button>
                </div>
              ))}
              <div className="flex gap-1">
                <input
                  autoFocus
                  value={path}
                  onChange={(e) => setPath(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && path.trim()) {
                      actions.setDirs(props.chatId, [...chat.dirs, path.trim()]);
                      setPath("");
                    }
                  }}
                  placeholder="C:\Users\...\proje"
                  className="font-code min-w-0 flex-1 rounded-md border border-field-border bg-field px-2 py-1.5 text-xs outline-none focus:border-accent"
                />
                <Button
                  size="sm"
                  variant="primary"
                  isDisabled={!path.trim()}
                  onPress={() => {
                    actions.setDirs(props.chatId, [...chat.dirs, path.trim()]);
                    setPath("");
                  }}
                >
                  Add
                </Button>
              </div>
            </SubView>
          )}

          {view === "commands" && (
            <SubView title="Slash commands" onBack={() => setView("main")}>
              <input
                autoFocus
                value={filter}
                onChange={(e) => setFilter(e.target.value)}
                placeholder="Search commands"
                className="rounded-md border border-field-border bg-field px-2 py-1.5 text-xs outline-none focus:border-accent"
              />
              {!commands.length ? (
                <Loading />
              ) : (
                <ul className="flex max-h-72 flex-col overflow-y-auto">
                  {shownCommands.map((c) => (
                    <li key={c.name}>
                      <button
                        type="button"
                        onClick={() => {
                          close();
                          props.onPickCommand(c);
                        }}
                        className="flex w-full flex-col rounded-md px-2 py-1.5 text-left hover:bg-default-soft"
                      >
                        <span className="font-code text-sm">
                          /{c.name} {c.argumentHint && <span className="text-xs text-muted">{c.argumentHint}</span>}
                        </span>
                        {c.description && <span className="line-clamp-2 text-xs text-muted">{c.description}</span>}
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </SubView>
          )}

          {view === "connectors" && chat && (
            <SubView title="Connectors" onBack={() => setView("main")}>
              <div className="max-h-72 overflow-y-auto">
                <ConnectorList chat={chat} />
              </div>
            </SubView>
          )}

          {view === "plugins" && chat && (
            <SubView title="Plugins" onBack={() => setView("main")}>
              {!chat.init ? (
                <p className="text-xs text-muted">Plugins appear once the session starts with the first message.</p>
              ) : chat.init.plugins.length === 0 ? (
                <p className="text-xs text-muted">No plugins installed.</p>
              ) : (
                <ul className="flex max-h-60 flex-col gap-1 overflow-y-auto">
                  {chat.init.plugins.map((p) => (
                    <li key={p.path} className="flex items-center gap-2 rounded-md px-2 py-1" title={p.path}>
                      <Puzzle size={14} className="shrink-0 text-muted" />
                      <span className="min-w-0 flex-1 truncate text-sm">{p.name}</span>
                      {p.version && <span className="text-[11px] text-muted">v{p.version}</span>}
                    </li>
                  ))}
                </ul>
              )}
              {chat.init && chat.init.skills.length > 0 && <p className="text-xs text-muted">{chat.init.skills.length} skills loaded.</p>}
            </SubView>
          )}
        </Popover.Dialog>
      </Popover.Content>
    </Popover>
  );
}

function MenuItem({ icon, label, hint, onPress, chevron }: { icon: ReactNode; label: string; hint?: string; onPress: () => void; chevron?: boolean }) {
  return (
    <li>
      <button type="button" onClick={onPress} className="flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left text-sm hover:bg-default-soft">
        <span className="text-muted">{icon}</span>
        <span className="flex-1">{label}</span>
        {hint && <span className="text-[11px] text-muted">{hint}</span>}
        {chevron && <ChevronRight size={14} className="text-muted" />}
      </button>
    </li>
  );
}

function SubView({ title, onBack, children }: { title: string; onBack: () => void; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-2 p-1">
      <div className="flex items-center gap-1">
        <Button isIconOnly size="sm" variant="ghost" aria-label="Back" onPress={onBack}>
          <ArrowLeft size={15} />
        </Button>
        <span className="text-sm font-semibold">{title}</span>
      </div>
      {children}
    </div>
  );
}

function Loading() {
  return (
    <div className="flex items-center gap-2 px-2 py-2 text-xs text-muted">
      <Spinner size="sm" /> Loading…
    </div>
  );
}
