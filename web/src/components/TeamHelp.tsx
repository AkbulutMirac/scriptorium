import { Button, Popover, Tooltip } from "@heroui/react";
import { CircleHelp } from "lucide-react";
import { useApp } from "../store";

/** The three ways Claude handles a coding job (docs/CLAUDE-workers.md) */
const WAYS: { title: string; ids: string[]; when: string; how: string }[] = [
  { title: "Yourself", ids: [], when: "A few lines, a quick fix, a question, or confidential code.", how: "Claude does it directly." },
  {
    title: "Builder",
    ids: ["deepseek-pro"],
    when: "The default for a feature or a fix, once Claude knows what to build.",
    how: "DeepSeek writes, tests and fixes in the project folder; Claude reads its report, not the code.",
  },
  {
    title: "Builder + checks",
    ids: ["deepseek-pro", "reviewer", "security-reviewer", "qa-tester"],
    when: "When a mistake would be costly: core logic, data, many files, file paths, input, logins or secrets.",
    how: "After the builder, the reviewer and (when it applies) security and QA check the result. More Claude usage, more eyes.",
  },
];

/** Helpers for everything else */
const OTHERS = ["deepseek", "test-writer", "docs-writer", "haiku", "sonnet"];

/** The "?" in the top bar: how Claude picks a way for each job and who is on the team */
export function TeamHelp() {
  const workers = useApp((s) => s.workers);
  const byId = new Map(workers.map((w) => [w.id, w]));
  const local = workers.filter((w) => w.local);

  const Dot = ({ id }: { id: string }) => {
    const w = byId.get(id);
    if (!w) return null;
    return (
      <span className="inline-flex items-center gap-1.5 rounded-md bg-default-soft px-1.5 py-0.5 text-xs font-medium">
        <span className="size-2 rounded-full" style={{ background: w.color }} />
        {w.name}
      </span>
    );
  };

  return (
    <Popover>
      <Tooltip delay={400}>
        <Button isIconOnly size="sm" variant="ghost" aria-label="How the team works">
          <CircleHelp size={17} />
        </Button>
        <Tooltip.Content>How the team works</Tooltip.Content>
      </Tooltip>
      <Popover.Content placement="bottom end" className="w-[23rem] max-w-[calc(100vw-1rem)]">
        <Popover.Dialog className="flex max-h-[80vh] flex-col gap-3 overflow-y-auto p-3 text-sm">
          <div>
            <p className="font-semibold">How the team works</p>
            <p className="mt-1 text-xs text-muted">Claude is the head scribe: it plans, decides and reads reports. For each coding job it picks one of three ways. Tell it which one if you prefer.</p>
          </div>

          <ol className="flex flex-col gap-2">
            {WAYS.map((way, i) => (
              <li key={way.title} className="flex flex-col gap-1 rounded-lg border border-separator p-2">
                <p className="text-xs font-semibold">
                  {i + 1}. {way.title}
                </p>
                <p className="text-xs text-muted">{way.when}</p>
                {way.ids.length > 0 && (
                  <div className="flex flex-wrap gap-1">
                    {way.ids.map((id) => (
                      <Dot key={id} id={id} />
                    ))}
                  </div>
                )}
                <p className="text-xs text-muted">{way.how}</p>
              </li>
            ))}
          </ol>

          <section className="flex flex-col gap-1.5">
            <p className="text-xs font-semibold uppercase tracking-wide text-muted">Other helpers</p>
            <div className="flex flex-wrap gap-1">
              {[...OTHERS, ...local.map((w) => w.id)].map((id) => (
                <Dot key={id} id={id} />
              ))}
            </div>
            <p className="text-xs text-muted">
              Small self-contained files, tests for old code, docs, searching the codebase. Local models are for short jobs with confidential data. Every helper's work is kept in its own history under "From
              Claude".
            </p>
          </section>
        </Popover.Dialog>
      </Popover.Content>
    </Popover>
  );
}
