import OpenAI from "openai";
import { config } from "./config.js";
import type { Worker } from "./agents.js";
import type { DeepSeekBalance, ReasoningLevel, TokenUsage } from "./protocol.js";

export type ChatPart =
  | { type: "text"; text: string }
  | { type: "image_url"; image_url: { url: string } }
  | { type: "file"; file: { file_data: string; filename?: string } };

export type ChatMessage = { role: "system" | "user" | "assistant"; content: string | ChatPart[] };

export type ChatOptions = {
  maxTokens?: number;
  signal?: AbortSignal;
  onToken?: (text: string) => void;
  onReasoning?: (text: string) => void;
  /** Boşsa işçinin modeli */
  model?: string;
  reasoning?: ReasoningLevel;
  temperature?: number;
  json?: boolean;
};

export type ChatResult = { content: string; reasoning: string; usage?: TokenUsage };

/** DeepSeek ve Ollama ikisi de OpenAI uyumlu API kullanıyor, tek istemci ikisine de yetiyor. */
function clientFor(worker: Worker): OpenAI {
  if (worker.provider === "deepseek") {
    if (!config.deepseekApiKey) {
      throw new Error("DEEPSEEK_API_KEY tanımlı değil. .env dosyasına ekle.");
    }
    return new OpenAI({ apiKey: config.deepseekApiKey, baseURL: config.deepseekBaseUrl });
  }
  return new OpenAI({ apiKey: "ollama", baseURL: config.ollamaBaseUrl });
}

/** Düşünme ayarını sağlayıcının beklediği alanlara çevirir */
function reasoningParams(worker: Worker, level?: ReasoningLevel): Record<string, unknown> {
  if (!level) return {};
  if (worker.provider === "deepseek") {
    if (level === "none") return { thinking: { type: "disabled" } };
    return { thinking: { type: "enabled" }, reasoning_effort: level === "medium" ? "high" : level };
  }
  return { reasoning_effort: level };
}

/** İşçiye mesaj gönderir; cevabı ve düşünceyi akış halinde iletir, sonunda tamamını ve token kullanımını döndürür. */
export async function chat(worker: Worker, messages: ChatMessage[], opts: ChatOptions = {}): Promise<ChatResult> {
  const body = {
    model: opts.model || worker.model,
    messages,
    max_tokens: opts.maxTokens ?? config.workerMaxTokens,
    stream: true,
    stream_options: { include_usage: true },
    ...(opts.temperature !== undefined ? { temperature: opts.temperature } : {}),
    ...(opts.json ? { response_format: { type: "json_object" } } : {}),
    ...reasoningParams(worker, opts.reasoning),
  };
  // thinking / reasoning_effort gibi alanlar OpenAI tiplerinde yok; istek gövdesine aynen gider
  const stream = (await clientFor(worker).chat.completions.create(body as never, { signal: opts.signal })) as unknown as AsyncIterable<{
    choices?: { delta?: { content?: string | null; reasoning_content?: string | null; reasoning?: string | null } }[];
    usage?: {
      prompt_tokens?: number;
      completion_tokens?: number;
      prompt_cache_hit_tokens?: number;
      prompt_tokens_details?: { cached_tokens?: number };
      completion_tokens_details?: { reasoning_tokens?: number };
    } | null;
  }>;

  let content = "";
  let reasoning = "";
  let usage: TokenUsage | undefined;
  for await (const chunk of stream) {
    const delta = chunk.choices?.[0]?.delta;
    const r = delta?.reasoning_content ?? delta?.reasoning ?? "";
    if (r) {
      reasoning += r;
      opts.onReasoning?.(r);
    }
    const text = delta?.content ?? "";
    if (text) {
      content += text;
      opts.onToken?.(text);
    }
    if (chunk.usage) {
      usage = {
        prompt: chunk.usage.prompt_tokens ?? 0,
        completion: chunk.usage.completion_tokens ?? 0,
        cacheHit: chunk.usage.prompt_cache_hit_tokens ?? chunk.usage.prompt_tokens_details?.cached_tokens,
        reasoning: chunk.usage.completion_tokens_details?.reasoning_tokens,
      };
    }
  }
  return { content, reasoning, usage };
}

/** İşçinin kullanabileceği modeller: DeepSeek için sabit liste, Ollama için kurulu modeller */
export async function listModels(worker: Worker): Promise<string[]> {
  if (worker.provider === "deepseek") return ["deepseek-flash", "deepseek-v4-pro"];
  try {
    const res = await fetch(`${config.ollamaBaseUrl}/models`, { signal: AbortSignal.timeout(3000) });
    if (!res.ok) return [];
    const j = (await res.json()) as { data?: { id: string }[] };
    return (j.data ?? []).map((m) => m.id);
  } catch {
    return [];
  }
}

/** İşçiye şu an ulaşılabiliyor mu? DeepSeek için anahtar, Ollama için sunucu kontrol edilir. */
export async function isAvailable(worker: Worker): Promise<{ ok: boolean; reason?: string }> {
  if (worker.provider === "deepseek") {
    return config.deepseekApiKey ? { ok: true } : { ok: false, reason: "DEEPSEEK_API_KEY yok" };
  }
  try {
    const res = await fetch(`${config.ollamaBaseUrl}/models`, { signal: AbortSignal.timeout(1500) });
    return res.ok ? { ok: true } : { ok: false, reason: `Ollama cevap vermedi (${res.status})` };
  } catch {
    return { ok: false, reason: "Ollama çalışmıyor" };
  }
}

/** DeepSeek hesap bakiyesi. Anahtar hiçbir yere yazılmaz, sadece istek başlığında kullanılır. */
export async function deepseekBalance(): Promise<DeepSeekBalance> {
  const checkedAt = Date.now();
  if (!config.deepseekApiKey) return { ok: false, error: "DEEPSEEK_API_KEY yok", checkedAt };
  try {
    const res = await fetch(`${config.deepseekBaseUrl}/user/balance`, {
      headers: { Authorization: `Bearer ${config.deepseekApiKey}`, Accept: "application/json" },
      signal: AbortSignal.timeout(8000),
    });
    if (res.status === 401) return { ok: false, error: "Anahtar geçersiz (401)", checkedAt };
    if (!res.ok) return { ok: false, error: `DeepSeek cevap vermedi (${res.status})`, checkedAt };
    const j = (await res.json()) as {
      is_available?: boolean;
      balance_infos?: { currency?: string; total_balance?: string; granted_balance?: string; topped_up_balance?: string }[];
    };
    // Birden çok para birimi varsa USD'yi tercih et
    const info = j.balance_infos?.find((b) => b.currency === "USD") ?? j.balance_infos?.[0];
    return {
      ok: true,
      available: j.is_available,
      currency: info?.currency,
      total: Number(info?.total_balance ?? 0),
      granted: Number(info?.granted_balance ?? 0),
      toppedUp: Number(info?.topped_up_balance ?? 0),
      checkedAt,
    };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err), checkedAt };
  }
}
