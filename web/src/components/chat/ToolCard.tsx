import { Spinner } from "@heroui/react";
import {
  Bot,
  ChevronRight,
  FilePen,
  FilePlus,
  FileText,
  FolderSearch,
  Globe,
  ListTodo,
  Maximize2,
  Search,
  Send,
  Terminal,
  Users,
  Wrench,
  type LucideIcon,
} from "lucide-react";
import { useState } from "react";
import type { ToolResult } from "../../lib/claudeItems";
import { diffLineClass } from "../../lib/diff";
import { truncate } from "../../lib/format";
import { actions, agentMeta, useApp } from "../../store";
import { Thumbs } from "./Thumbs";

type Props = { name: string; input: Record<string, unknown>; result?: ToolResult };

const str = (v: unknown) => (typeof v === "string" ? v : v === undefined ? "" : JSON.stringify(v));
const shortPath = (p: unknown) => str(p).replaceAll("\\", "/").split("/").slice(-3).join("/");

/** Title and icon for known tools */
function describe(name: string, input: Record<string, unknown>): { icon: LucideIcon; title: string; detail?: string } {
  switch (name) {
    case "Read":
      return { icon: FileText, title: "Read", detail: shortPath(input.file_path) };
    case "Write":
      return { icon: FilePlus, title: "Wrote", detail: shortPath(input.file_path) };
    case "Edit":
    case "MultiEdit":
      return { icon: FilePen, title: "Edited", detail: shortPath(input.file_path) };
    case "NotebookEdit":
      return { icon: FilePen, title: "Edited notebook", detail: shortPath(input.notebook_path) };
    case "Bash":
    case "PowerShell":
      return { icon: Terminal, title: str(input.description) || "Ran command", detail: truncate(str(input.command), 120) };
    case "Grep":
      return { icon: Search, title: "Searched", detail: str(input.pattern) };
    case "Glob":
      return { icon: FolderSearch, title: "Searched files", detail: str(input.pattern) };
    case "WebFetch":
      return { icon: Globe, title: "Read page", detail: str(input.url) };
    case "WebSearch":
      return { icon: Search, title: "Searched the web", detail: str(input.query) };
    case "TodoWrite":
      return { icon: ListTodo, title: "To-do list" };
    case "Task":
    case "Agent":
      return { icon: Bot, title: "Subagent", detail: str(input.description) };
    case "mcp__workers__list_workers":
      return { icon: Users, title: "Checked workers" };
    case "mcp__workers__job_status":
      return { icon: Users, title: "Checked background job", detail: str(input.job_id) };
    default:
      return { icon: Wrench, title: name.replace(/^mcp__/, "").replaceAll("__", " · ") };
  }
}

export function ToolCard({ name, input, result }: Props) {
  if (name === "mcp__workers__ask_worker" || name === "mcp__workers__start_job") {
    return <DelegationCard background={name.endsWith("start_job")} input={input} result={result} />;
  }
  if (name === "TodoWrite") return <TodoCard input={input} />;

  return <GenericToolCard name={name} input={input} result={result} />;
}

function GenericToolCard({ name, input, result }: Props) {
  const [open, setOpen] = useState(false);
  const d = describe(name, input);
  const Icon = d.icon;
  const pending = !result;
  const isEdit = name === "Edit" || name === "MultiEdit" || name === "Write";

  return (
    <div className={`min-w-0 rounded-lg border text-sm ${result?.isError ? "border-danger/40" : "border-separator"}`}>
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className="flex w-full items-center gap-2 px-2.5 py-1.5 text-left hover:bg-default-soft"
      >
        <ChevronRight size={14} className={`shrink-0 text-muted transition-transform ${open ? "rotate-90" : ""}`} />
        <Icon size={14} className="shrink-0 text-muted" />
        <span className="min-w-0 max-w-[60%] shrink-0 truncate font-medium">{d.title}</span>
        {d.detail && <span className="font-code min-w-0 flex-1 truncate text-xs text-muted">{d.detail}</span>}
        <span className="flex-1" />
        {pending && <Spinner size="sm" />}
        {result?.isError && <span className="text-xs text-danger">error</span>}
      </button>
      {open && (
        <div className="flex flex-col gap-2 border-t border-separator p-2.5">
          {isEdit ? <EditPreview name={name} input={input} /> : <Block label="Input" text={JSON.stringify(input, null, 2)} />}
          {result && (result.text || !result.images?.length) && (
            <Block label={result.isError ? "Error" : "Result"} text={result.text || "(empty)"} danger={result.isError} />
          )}
          <Thumbs images={result?.images} />
        </div>
      )}
    </div>
  );
}

function Block({ label, text, danger }: { label: string; text: string; danger?: boolean }) {
  const long = text.length > 1500;
  return (
    <div>
      <div className="mb-1 flex items-center justify-between text-[11px] text-muted">
        <span>{label}</span>
        {long && (
          <button type="button" className="flex items-center gap-1 hover:text-foreground" onClick={() => actions.showOverlay({ title: label, body: text, mono: true })}>
            <Maximize2 size={11} /> Open in center
          </button>
        )}
      </div>
      <pre className={`font-code max-h-64 overflow-auto rounded-md bg-background-secondary p-2 text-xs ${danger ? "text-danger" : ""}`}>
        {long ? `${text.slice(0, 1500)}\n…` : text}
      </pre>
    </div>
  );
}

/** Simple red-green diff view for Edit/Write */
function EditPreview({ name, input }: { name: string; input: Record<string, unknown> }) {
  const edits: { old: string; new: string }[] =
    name === "Write"
      ? [{ old: "", new: str(input.content) }]
      : name === "MultiEdit" && Array.isArray(input.edits)
        ? (input.edits as { old_string?: string; new_string?: string }[]).map((e) => ({ old: e.old_string ?? "", new: e.new_string ?? "" }))
        : [{ old: str(input.old_string), new: str(input.new_string) }];

  const diffText = edits
    .map((e) => [...(e.old ? e.old.split("\n").map((l) => `- ${l}`) : []), ...e.new.split("\n").map((l) => `+ ${l}`)].join("\n"))
    .join("\n⋯\n");

  return (
    <div>
      <div className="mb-1 flex items-center justify-between text-[11px] text-muted">
        <span className="font-code">{str(input.file_path)}</span>
        <button
          type="button"
          className="flex items-center gap-1 hover:text-foreground"
          onClick={() => actions.showOverlay({ title: shortPath(input.file_path), body: diffText, mono: true, diff: true })}
        >
          <Maximize2 size={11} /> Open in center
        </button>
      </div>
      <pre className="font-code max-h-72 overflow-auto rounded-md bg-background-secondary p-2 text-xs">
        {diffText.split("\n").map((line, i) => (
          <div
            key={i}
            className={diffLineClass(line) || "text-muted"}
          >
            {line || " "}
          </div>
        ))}
      </pre>
    </div>
  );
}

function TodoCard({ input }: { input: Record<string, unknown> }) {
  const todos = Array.isArray(input.todos) ? (input.todos as { content?: string; status?: string; activeForm?: string }[]) : [];
  return (
    <div className="rounded-lg border border-separator p-2.5 text-sm">
      <div className="mb-1.5 flex items-center gap-2 font-medium">
        <ListTodo size={14} className="text-muted" /> To-dos
      </div>
      <ul className="flex flex-col gap-1">
        {todos.map((t, i) => (
          <li key={i} className="flex items-start gap-2">
            <span className="mt-0.5 shrink-0">{t.status === "completed" ? "✅" : t.status === "in_progress" ? "⏳" : "⬜"}</span>
            <span className={t.status === "completed" ? "text-muted line-through" : t.status === "in_progress" ? "font-medium" : ""}>
              {t.status === "in_progress" ? t.activeForm || t.content : t.content}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

/** Card shown when Claude delegates a task to a worker */
function DelegationCard({ input, result, background }: { input: Record<string, unknown>; result?: ToolResult; background: boolean }) {
  const workers = useApp((s) => s.workers);
  const [open, setOpen] = useState(false);
  const meta = agentMeta(str(input.worker_id), workers);
  const files = Array.isArray(input.files) ? (input.files as string[]) : [];

  return (
    <div className="overflow-hidden rounded-lg border text-sm" style={{ borderColor: `${meta.color}66` }}>
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className="flex w-full items-center gap-2 px-2.5 py-2 text-left"
        style={{ background: `${meta.color}14` }}
      >
        <Send size={14} style={{ color: meta.color }} className="shrink-0" />
        <span className="min-w-0 max-w-[55%] shrink-0 truncate font-medium">
          {meta.name}'e {background ? "background job assigned" : "delegated"}
        </span>
        {input.sensitive === true && <span className="shrink-0 rounded bg-warning-soft px-1.5 text-[10px] text-warning-soft-foreground">sensitive</span>}
        <span className="min-w-0 flex-1 truncate text-xs text-muted">{truncate(str(input.task), 90)}</span>
        {!result ? <Spinner size="sm" /> : result.isError ? <span className="text-xs text-danger">error</span> : <span className="text-xs text-success">done</span>}
        <ChevronRight size={14} className={`shrink-0 text-muted transition-transform ${open ? "rotate-90" : ""}`} />
      </button>
      {open && (
        <div className="flex flex-col gap-2 border-t border-separator p-2.5">
          <Block label="Task" text={str(input.task)} />
          {files.length > 0 && <Block label="Sent files" text={files.join("\n")} />}
          {result && <Block label={result.isError ? "Error" : `${meta.name} response`} text={result.text} danger={result.isError} />}
        </div>
      )}
    </div>
  );
}
