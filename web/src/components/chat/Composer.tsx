import { Button, toast, Tooltip } from "@heroui/react";
import { ArrowUp, FileText, ImageIcon, Quote, Square, X } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import type { Attachment, SlashCommandInfo } from "../../protocol";
import { actions, useApp } from "../../store";
import { PlusMenu } from "./PlusMenu";

/** Alıntıyı Markdown alıntısına çevirip mesajın başına ekler */
export function withQuote(text: string, quote?: string) {
  if (!quote) return text;
  const quoted = quote
    .split("\n")
    .map((l) => `> ${l}`)
    .join("\n");
  return `${quoted}\n\n${text}`;
}

const MAX_FILE_BYTES = 10 * 1024 * 1024;
const TEXT_EXT = /\.(txt|md|json|ya?ml|csv|tsv|xml|html?|css|scss|js|jsx|ts|tsx|py|java|c|cpp|h|cs|go|rs|rb|php|sh|ps1|bat|sql|toml|ini|env|log)$/i;

/** Tarayıcı dosyasını Claude'a gönderilebilecek eke çevirir */
async function toAttachment(file: File): Promise<Attachment | null> {
  if (file.size > MAX_FILE_BYTES) {
    toast.warning(`${file.name} çok büyük (en fazla 10 MB).`);
    return null;
  }
  const isImage = /^image\/(png|jpeg|gif|webp)$/.test(file.type);
  const isPdf = file.type === "application/pdf";
  const isText = file.type.startsWith("text/") || TEXT_EXT.test(file.name) || file.type === "application/json";
  if (!isImage && !isPdf && !isText) {
    toast.warning(`${file.name}: bu dosya türü desteklenmiyor (görsel, PDF ya da metin dosyası olmalı).`);
    return null;
  }
  const data = await new Promise<string>((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result).split(",")[1] ?? "");
    r.onerror = () => reject(r.error);
    r.readAsDataURL(file);
  });
  return { name: file.name, mediaType: isImage || isPdf ? file.type : "text/plain", data };
}

/** Komutları sorguya göre sıralar: baştan eşleşen > ":" sonrası eşleşen (plugin:komut) > içinde geçen */
function rankCommands(commands: SlashCommandInfo[], q: string): SlashCommandInfo[] {
  const score = (name: string) => {
    const n = name.toLowerCase();
    if (n.startsWith(q)) return 0;
    if (n.split(/[:/-]/).some((part) => part.startsWith(q))) return 1;
    if (n.includes(q)) return 2;
    return -1;
  };
  return commands
    .map((c) => ({ c, s: score(c.name) }))
    .filter((x) => x.s >= 0)
    .sort((a, b) => a.s - b.s || a.c.name.length - b.c.name.length)
    .map((x) => x.c);
}

export function Composer(props: {
  quoteKey: string;
  placeholder: string;
  busy: boolean;
  disabledReason?: string;
  /** Verilirse "+" menüsü, ek dosyalar ve slash komut önerileri açılır (Claude sohbeti) */
  claudeChatId?: string;
  /** Yazma kutusunun altındaki çubuk (verilmezse kısa ipucu yazısı gösterilir) */
  footer?: React.ReactNode;
  onSend: (text: string, attachments: Attachment[]) => void;
  onStop: () => void;
}) {
  const [text, setText] = useState("");
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const [slashIndex, setSlashIndex] = useState(0);
  const [slashClosed, setSlashClosed] = useState(false);
  const quote = useApp((s) => s.quotes[props.quoteKey]);
  const chat = useApp((s) => (props.claudeChatId ? s.chats[props.claudeChatId] : undefined));
  const globalCommands = useApp((s) => s.globalInfo?.commands);
  const ref = useRef<HTMLTextAreaElement>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const claude = !!props.claudeChatId;

  // Yükseklik içeriğe göre büyüsün (en fazla ~10 satır)
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 240)}px`;
  }, [text]);

  useEffect(() => {
    if (quote) ref.current?.focus();
  }, [quote]);

  // Slash komut önerileri: "/" ile başlayan, henüz boşluk içermeyen metin
  const commands: SlashCommandInfo[] = useMemo(
    () => chat?.info?.commands ?? globalCommands ?? chat?.init?.slashCommands.map((name) => ({ name, description: "" })) ?? [],
    [chat?.info?.commands, globalCommands, chat?.init?.slashCommands],
  );
  const slashQuery = claude && /^\/\S*$/.test(text) ? text.slice(1).toLowerCase() : null;
  const suggestions = slashQuery === null || slashClosed ? [] : rankCommands(commands, slashQuery).slice(0, 8);

  useEffect(() => {
    setSlashIndex(0);
    if (slashQuery === "" && claude && props.claudeChatId && !commands.length) actions.requestInfo(props.claudeChatId);
    if (slashQuery === null) setSlashClosed(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [slashQuery]);

  const pickCommand = (c: SlashCommandInfo) => {
    setText(`/${c.name} `);
    ref.current?.focus();
  };

  const addFiles = async (files: FileList | File[]) => {
    const list = (await Promise.all([...files].map(toAttachment))).filter((a): a is Attachment => !!a);
    if (list.length) setAttachments((prev) => [...prev, ...list]);
  };

  const send = () => {
    const t = text.trim();
    if ((!t && !attachments.length) || props.busy || props.disabledReason) return;
    props.onSend(withQuote(t || "Ekteki dosyalara bak.", quote), attachments);
    setText("");
    setAttachments([]);
    actions.setQuote(props.quoteKey, undefined);
  };

  return (
    <div
      className="relative border-t border-separator p-3"
      onDragOver={(e) => claude && e.preventDefault()}
      onDrop={(e) => {
        if (!claude || !e.dataTransfer.files.length) return;
        e.preventDefault();
        addFiles(e.dataTransfer.files);
      }}
    >
      {suggestions.length > 0 && (
        <ul className="absolute bottom-full left-3 right-3 z-20 mb-1 overflow-hidden rounded-xl border border-separator bg-overlay p-1 shadow-lg" role="listbox" aria-label="Slash komutları">
          {suggestions.map((c, i) => (
            <li key={c.name} role="option" aria-selected={i === slashIndex}>
              <button
                type="button"
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => pickCommand(c)}
                className={`flex w-full items-baseline gap-2 rounded-lg px-2.5 py-1.5 text-left ${i === slashIndex ? "bg-accent-soft" : "hover:bg-default-soft"}`}
              >
                <span className="font-code shrink-0 text-sm">/{c.name}</span>
                {c.argumentHint && <span className="font-code shrink-0 text-xs text-muted">{c.argumentHint}</span>}
                <span className="truncate text-xs text-muted">{c.description}</span>
              </button>
            </li>
          ))}
        </ul>
      )}

      {quote && (
        <div className="mb-2 flex items-start gap-2 rounded-lg bg-default-soft px-2.5 py-1.5 text-xs text-muted">
          <Quote size={13} className="mt-0.5 shrink-0" />
          <span className="line-clamp-3 min-w-0 flex-1 whitespace-pre-wrap">{quote}</span>
          <button type="button" aria-label="Alıntıyı kaldır" onClick={() => actions.setQuote(props.quoteKey, undefined)} className="shrink-0 hover:text-foreground">
            <X size={13} />
          </button>
        </div>
      )}

      {attachments.length > 0 && (
        <div className="mb-2 flex flex-wrap gap-1.5">
          {attachments.map((a, i) => (
            <span key={`${a.name}-${i}`} className="flex max-w-56 items-center gap-1.5 rounded-lg border border-separator bg-default-soft px-2 py-1 text-xs">
              {a.mediaType.startsWith("image/") ? (
                <img src={`data:${a.mediaType};base64,${a.data}`} alt="" className="size-5 rounded object-cover" />
              ) : a.mediaType === "application/pdf" ? (
                <FileText size={13} className="shrink-0 text-danger" />
              ) : (
                <FileText size={13} className="shrink-0 text-muted" />
              )}
              <span className="truncate">{a.name}</span>
              <button type="button" aria-label={`${a.name} ekini kaldır`} onClick={() => setAttachments(attachments.filter((_, j) => j !== i))} className="shrink-0 text-muted hover:text-foreground">
                <X size={12} />
              </button>
            </span>
          ))}
        </div>
      )}

      <div className="flex items-end gap-1.5 rounded-2xl border border-field-border bg-field px-2 py-2 focus-within:border-accent">
        {claude && props.claudeChatId && (
          <PlusMenu
            chatId={props.claudeChatId}
            onPickFiles={() => fileInput.current?.click()}
            onPickCommand={pickCommand}
          />
        )}
        <textarea
          ref={ref}
          rows={1}
          value={text}
          onChange={(e) => setText(e.target.value)}
          onPaste={(e) => {
            if (!claude) return;
            const files = [...e.clipboardData.files];
            if (files.length) {
              e.preventDefault();
              addFiles(files);
            }
          }}
          onKeyDown={(e) => {
            if (suggestions.length) {
              if (e.key === "ArrowDown") {
                e.preventDefault();
                setSlashIndex((i) => (i + 1) % suggestions.length);
                return;
              }
              if (e.key === "ArrowUp") {
                e.preventDefault();
                setSlashIndex((i) => (i - 1 + suggestions.length) % suggestions.length);
                return;
              }
              if (e.key === "Tab" || (e.key === "Enter" && !e.shiftKey)) {
                e.preventDefault();
                pickCommand(suggestions[slashIndex]);
                return;
              }
              if (e.key === "Escape") {
                setSlashClosed(true);
                return;
              }
            }
            if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
              e.preventDefault();
              send();
            }
          }}
          placeholder={props.disabledReason ?? props.placeholder}
          aria-label="Mesaj"
          className="max-h-60 min-h-6 flex-1 resize-none bg-transparent px-1 py-1 text-[0.9375rem] outline-none placeholder:text-field-placeholder"
        />
        {props.busy ? (
          <Tooltip delay={300}>
            <Button isIconOnly size="sm" variant="danger" aria-label="Durdur" onPress={props.onStop}>
              <Square size={14} fill="currentColor" />
            </Button>
            <Tooltip.Content>Durdur</Tooltip.Content>
          </Tooltip>
        ) : (
          <Button
            isIconOnly
            size="sm"
            variant="primary"
            aria-label="Gönder"
            isDisabled={(!text.trim() && !attachments.length) || !!props.disabledReason}
            onPress={send}
          >
            <ArrowUp size={16} />
          </Button>
        )}
      </div>
      <input
        ref={fileInput}
        type="file"
        multiple
        hidden
        accept="image/png,image/jpeg,image/gif,image/webp,application/pdf,text/*,.md,.json,.yaml,.yml,.csv,.ts,.tsx,.js,.jsx,.py,.java,.cs,.go,.rs,.sql,.html,.css"
        onChange={(e) => {
          if (e.target.files) addFiles(e.target.files);
          e.target.value = "";
        }}
      />
      {props.footer ?? (
      <p className="mt-1.5 flex items-center gap-1 px-1 text-[11px] text-muted">
        Enter gönderir, Shift+Enter yeni satır
        {claude && (
          <>
            {" "}
            · <span className="font-code">/</span> komutlar · <ImageIcon size={11} /> yapıştır veya sürükle
          </>
        )}
      </p>
      )}
    </div>
  );
}
