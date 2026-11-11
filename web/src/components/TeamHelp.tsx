import { Button, Popover, Tooltip } from "@heroui/react";
import { ArrowDown, CircleHelp } from "lucide-react";
import { useApp } from "../store";

/** Order of the steps Claude usually takes with the specialists after it has written a change */
const FLOW: { ids: string[]; note: string }[] = [
  { ids: ["test-writer", "reviewer"], note: "in parallel, right after the change" },
  { ids: ["qa-tester"], note: "if the interface changed" },
  { ids: ["security-reviewer"], note: "if input, auth, files, shell or network changed" },
  { ids: ["docs-writer"], note: "last, once everything passes" },
];

/** The "?" in the top bar: who is on the team and how Claude uses the subagents */
export function TeamHelp() {
  const workers = useApp((s) => s.workers);
  const byId = new Map(workers.map((w) => [w.id, w]));
  const tools = workers.filter((w) => w.provider !== "claude");

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
      <Popover.Content placement="bottom end" className="w-[22rem] max-w-[calc(100vw-1rem)]">
        <Popover.Dialog className="flex max-h-[80vh] flex-col gap-3 overflow-y-auto p-3 text-sm">
          <div>
            <p className="font-semibold">How the team works</p>
            <p className="mt-1 text-xs text-muted">Claude is the head scribe. It decides on its own who helps with what; nothing is mandatory.</p>
          </div>

          <section className="flex flex-col gap-1.5">
            <p className="text-xs font-semibold uppercase tracking-wide text-muted">Workers</p>
            <p className="text-xs text-muted">Cheap or local models through Scriptorium's tools. They get the files they need and send back an answer; they can't run anything.</p>
            <div className="flex flex-wrap gap-1">{tools.map((w) => <Dot key={w.id} id={w.id} />)}</div>
          </section>

          <section className="flex flex-col gap-1.5">
            <p className="text-xs font-semibold uppercase tracking-wide text-muted">Subagents</p>
            <p className="text-xs text-muted">
              Claude Code agents on your subscription. They read files and run commands themselves, walk into the office while they work and end with a <b>report</b> that is their answer.
            </p>
            <div className="flex flex-wrap gap-1">
              <Dot id="haiku" />
              <Dot id="sonnet" />
            </div>
          </section>

          <section className="flex flex-col gap-1.5">
            <p className="text-xs font-semibold uppercase tracking-wide text-muted">Specialists, after a change</p>
            <div className="flex flex-col items-start gap-1">
              {FLOW.map((step, i) => (
                <div key={step.ids.join()} className="flex flex-col items-start gap-1">
                  {i > 0 && <ArrowDown size={12} className="ml-2 text-muted" />}
                  <div className="flex flex-wrap items-center gap-1">
                    {step.ids.map((id) => (
                      <Dot key={id} id={id} />
                    ))}
                    <span className="text-[11px] text-muted">{step.note}</span>
                  </div>
                </div>
              ))}
            </div>
            <p className="text-xs text-muted">Claude reads each report, fixes what needs fixing and tells you who did what. Reports are kept in each helper's history under "From Claude".</p>
          </section>
        </Popover.Dialog>
      </Popover.Content>
    </Popover>
  );
}
