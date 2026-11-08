import { Button } from "@heroui/react";
import { ChevronDown } from "lucide-react";
import { useEffect, useState } from "react";
import { actions, useApp, type PermissionReq } from "../../store";
import { planText } from "./PlanPanel";

function planTitle(text: string | null): string {
  if (text) {
    for (const line of text.split("\n")) {
      const m = /^\s*#{1,6}\s+(.+?)\s*$/.exec(line);
      if (m) return m[1];
    }
  }
  return "Plan";
}

/** Approval card for ExitPlanMode, like the Claude desktop "Claude proposed a plan" card. */
export function PlanCard({ req }: { req: PermissionReq }) {
  const planPath = useApp((s) => s.planPath);
  const items = useApp((s) => s.chats[req.chatId]?.items);
  const [revising, setRevising] = useState(false);
  const [feedback, setFeedback] = useState("");
  const [menu, setMenu] = useState(false);

  const path = typeof req.input.planFilePath === "string" ? req.input.planFilePath : planPath;
  const text = typeof req.input.plan === "string" ? req.input.plan : path && items ? planText(items, path) : null;
  const title = planTitle(text);

  useEffect(() => {
    if (revising) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
        e.preventDefault();
        actions.respondPlan(req, "auto");
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [req, revising]);

  return (
    <div className="overflow-hidden rounded-xl border border-separator bg-surface text-sm">
      <div className="flex items-start gap-2 px-4 py-3">
        <div className="min-w-0 flex-1">
          <div className="font-medium">Claude proposed a plan</div>
          <div className="truncate text-xs text-muted">{title}</div>
        </div>
        {path && (
          <button type="button" className="shrink-0 text-sm text-accent underline" onClick={() => actions.openPlan(path)}>
            Open plan
          </button>
        )}
      </div>

      <div className="flex flex-col gap-2 border-t border-separator bg-default-soft/40 p-3">
        {revising ? (
          <>
            <textarea
              autoFocus
              rows={3}
              value={feedback}
              onChange={(e) => setFeedback(e.target.value)}
              placeholder="What should Claude change?"
              className="rounded-lg border border-separator bg-surface p-2 outline-none focus:border-accent"
            />
            <div className="flex gap-2">
              <Button size="sm" variant="primary" isDisabled={!feedback.trim()} onPress={() => actions.respondPlan(req, null, feedback.trim())}>
                Send feedback
              </Button>
              <Button
                size="sm"
                variant="ghost"
                onPress={() => {
                  setRevising(false);
                  setFeedback("");
                }}
              >
                Cancel
              </Button>
            </div>
          </>
        ) : (
          <>
            <Button className="w-full" variant="secondary" onPress={() => actions.respondPlan(req, null)}>
              Reject
            </Button>
            <Button className="w-full" variant="secondary" onPress={() => setRevising(true)}>
              Revise...
            </Button>
            <Button className="w-full" variant="secondary" onPress={() => actions.respondPlan(req, "default")}>
              Accept
            </Button>
            <div className="relative flex items-center gap-1">
              <Button className="flex-1" variant="primary" onPress={() => actions.respondPlan(req, "auto")}>
                Accept and use auto mode
                <span className="ml-2 rounded border px-1 text-[10px] opacity-70">Ctrl ⏎</span>
              </Button>
              <Button isIconOnly variant="primary" aria-label="More accept options" onPress={() => setMenu(!menu)}>
                <ChevronDown size={16} />
              </Button>
              {menu && (
                <div className="absolute bottom-full right-0 z-10 mb-1 w-64 rounded-lg border border-separator bg-surface p-1 shadow-lg">
                  <button
                    type="button"
                    className="w-full rounded-md px-2 py-1.5 text-left hover:bg-default-soft"
                    onClick={() => {
                      setMenu(false);
                      actions.respondPlan(req, "acceptEdits");
                    }}
                  >
                    Accept and accept edits
                  </button>
                  <button
                    type="button"
                    className="w-full rounded-md px-2 py-1.5 text-left hover:bg-default-soft"
                    onClick={() => {
                      setMenu(false);
                      actions.respondPlan(req, "bypassPermissions");
                    }}
                  >
                    Accept and bypass permissions
                  </button>
                </div>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
