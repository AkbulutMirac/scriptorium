import { Button } from "@heroui/react";
import { MessageCircleQuestion, ShieldAlert } from "lucide-react";
import { useState } from "react";
import { actions, type PermissionReq } from "../../store";

/** Claude bir aracı kullanmak için izin istediğinde sohbetin altında çıkar. */
export function PermissionCard({ req }: { req: PermissionReq }) {
  if (req.toolName === "AskUserQuestion") return <QuestionCard req={req} />;

  const preview = previewOf(req.toolName, req.input);
  return (
    <div className="rounded-xl border border-warning/50 bg-warning-soft p-3 text-sm">
      <div className="mb-1.5 flex items-center gap-2 font-medium text-warning-soft-foreground">
        <ShieldAlert size={16} />
        {req.title || `${req.toolName} kullanmak istiyor`}
      </div>
      {req.description && <p className="mb-2 text-xs text-muted">{req.description}</p>}
      {preview && <pre className="font-code mb-2 max-h-40 overflow-auto rounded-md bg-surface p-2 text-xs">{preview}</pre>}
      <div className="flex flex-wrap gap-2">
        <Button size="sm" variant="primary" onPress={() => actions.respondPermission(req.requestId, true)}>
          İzin ver
        </Button>
        {req.canAlwaysAllow && (
          <Button size="sm" variant="secondary" onPress={() => actions.respondPermission(req.requestId, true, true)}>
            Her zaman izin ver
          </Button>
        )}
        <Button size="sm" variant="ghost" onPress={() => actions.respondPermission(req.requestId, false)}>
          Reddet
        </Button>
      </div>
    </div>
  );
}

function previewOf(tool: string, input: Record<string, unknown>): string {
  if (typeof input.command === "string") return input.command;
  if (typeof input.file_path === "string") {
    if (typeof input.new_string === "string") return `${input.file_path}\n\n${input.new_string}`.slice(0, 1200);
    if (typeof input.content === "string") return `${input.file_path}\n\n${input.content}`.slice(0, 1200);
    return input.file_path;
  }
  if (typeof input.url === "string") return input.url;
  const json = JSON.stringify(input, null, 2);
  return json === "{}" ? "" : `${tool}\n${json}`.slice(0, 1200);
}

type Question = {
  question: string;
  header?: string;
  multiSelect?: boolean;
  options: { label: string; description?: string }[];
};

/** Claude'un seçenekli sorusu (AskUserQuestion). Cevaplar araca `answers` olarak geri gider. */
function QuestionCard({ req }: { req: PermissionReq }) {
  const questions = (Array.isArray(req.input.questions) ? req.input.questions : []) as Question[];
  const [picked, setPicked] = useState<Record<string, string[]>>({});
  const [other, setOther] = useState<Record<string, string>>({});

  const answerOf = (q: Question) => {
    const custom = other[q.question]?.trim();
    const list = [...(picked[q.question] ?? []), ...(custom ? [custom] : [])];
    return list.join(", ");
  };
  const complete = questions.every((q) => answerOf(q));

  const toggle = (q: Question, label: string) => {
    const cur = picked[q.question] ?? [];
    const next = q.multiSelect ? (cur.includes(label) ? cur.filter((l) => l !== label) : [...cur, label]) : [label];
    setPicked({ ...picked, [q.question]: next });
    if (!q.multiSelect) setOther({ ...other, [q.question]: "" });
  };

  return (
    <div className="flex flex-col gap-3 rounded-xl border border-accent/40 bg-accent-soft p-3 text-sm">
      <div className="flex items-center gap-2 font-medium text-accent-soft-foreground">
        <MessageCircleQuestion size={16} /> Claude soruyor
      </div>
      {questions.map((q) => (
        <div key={q.question} className="flex flex-col gap-1.5">
          <div>
            {q.header && <span className="mr-2 rounded bg-surface px-1.5 py-0.5 text-[10px] uppercase text-muted">{q.header}</span>}
            <span className="font-medium">{q.question}</span>
            {q.multiSelect && <span className="ml-1 text-xs text-muted">(birden fazla seçilebilir)</span>}
          </div>
          <div className="flex flex-col gap-1">
            {q.options.map((o) => {
              const on = (picked[q.question] ?? []).includes(o.label);
              return (
                <button
                  key={o.label}
                  type="button"
                  onClick={() => toggle(q, o.label)}
                  className={`rounded-lg border px-2.5 py-1.5 text-left transition ${on ? "border-accent bg-surface" : "border-separator bg-surface/60 hover:bg-surface"}`}
                >
                  <div className="font-medium">{o.label}</div>
                  {o.description && <div className="text-xs text-muted">{o.description}</div>}
                </button>
              );
            })}
            <input
              value={other[q.question] ?? ""}
              onChange={(e) => {
                setOther({ ...other, [q.question]: e.target.value });
                if (!q.multiSelect && e.target.value) setPicked({ ...picked, [q.question]: [] });
              }}
              placeholder="Diğer (kendi cevabın)"
              className="rounded-lg border border-separator bg-surface px-2.5 py-1.5 outline-none focus:border-accent"
            />
          </div>
        </div>
      ))}
      <div className="flex gap-2">
        <Button
          size="sm"
          variant="primary"
          isDisabled={!complete}
          onPress={() =>
            actions.respondPermission(req.requestId, true, false, {
              ...req.input,
              answers: Object.fromEntries(questions.map((q) => [q.question, answerOf(q)])),
            })
          }
        >
          Cevapla
        </Button>
        <Button size="sm" variant="ghost" onPress={() => actions.respondPermission(req.requestId, false)}>
          Geç
        </Button>
      </div>
    </div>
  );
}
