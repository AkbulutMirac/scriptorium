import OpenAI from "openai";
import { config } from "./config.js";
import type { Worker } from "./agents.js";
import type { DeepSeekBalance, ReasoningLevel, TokenUsage, WorkerModel } from "./protocol.js";

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
  /** If empty, the worker's model */
  model?: string;
  reasoning?: ReasoningLevel;
  temperature?: number;
  json?: boolean;
};

export type ChatResult = { content: string; reasoning: string; usage?: TokenUsage };

/** Both DeepSeek and Ollama use OpenAI-compatible APIs, so a single client suffices for both. */
export function clientFor(worker: Worker): OpenAI {
  if (worker.provider === "deepseek") {
    if (!config.deepseekApiKey) {
      throw new Error("DEEPSEEK_API_KEY is not set. Add it to the .env file.");
    }
    return new OpenAI({ apiKey: config.deepseekApiKey, baseURL: config.deepseekBaseUrl });
  }
  return new OpenAI({ apiKey: "ollama", baseURL: config.ollamaBaseUrl });
}

/** Translates the reasoning setting into the fields the provider expects */
function reasoningParams(worker: Worker, level?: ReasoningLevel): Record<string, unknown> {
  if (!level) return {};
  if (worker.provider === "deepseek") {
    if (level === "none") return { thinking: { type: "disabled" } };
    return { thinking: { type: "enabled" }, reasoning_effort: level === "medium" ? "high" : level };
  }
  return { reasoning_effort: level };
}

/** Sends a message to the worker; streams the response and reasoning, then returns the full content and token usage. */
export async function chat(worker: Worker, messages: ChatMessage[], opts: ChatOptions = {}): Promise<ChatResult> {
  const body = {
    model: opts.model || worker.model,
    messages,
    // Only sent when set: otherwise the provider's default applies (see config.workerMaxTokens)
    ...((opts.maxTokens ?? config.workerMaxTokens) ? { max_tokens: opts.maxTokens ?? config.workerMaxTokens } : {}),
    stream: true,
    stream_options: { include_usage: true },
    ...(opts.temperature !== undefined ? { temperature: opts.temperature } : {}),
    ...(opts.json ? { response_format: { type: "json_object" } } : {}),
    ...reasoningParams(worker, opts.reasoning),
  };
  // Fields like thinking / reasoning_effort are not in OpenAI types; they go into the request body as-is
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
  if (usage) usage.contextWindow = await contextWindow(worker, body.model);
  return { content, reasoning, usage };
}

/** Both DeepSeek models take a 1M token context (api-docs.deepseek.com, Models & Pricing) */
const DEEPSEEK_CONTEXT = 1_000_000;

/** Ollama's own API address (not the OpenAI-compatible /v1) */
const ollamaRoot = () => config.ollamaBaseUrl.replace(/\/v1\/?$/, "");

/** The model's current context limit. On Ollama it's the loaded model's actual setting (/api/ps), on DeepSeek it's fixed. */
async function contextWindow(worker: Worker, model: string): Promise<number | undefined> {
  if (worker.provider === "deepseek") return DEEPSEEK_CONTEXT;
  try {
    const res = await fetch(`${ollamaRoot()}/api/ps`, { signal: AbortSignal.timeout(2000) });
    const j = (await res.json()) as { models?: { name: string; context_length?: number }[] };
    const norm = (m: string) => m.replace(/:latest$/, "");
    return j.models?.find((m) => norm(m.name) === norm(model))?.context_length;
  } catch {
    return undefined;
  }
}

/**
 * Can the model read images? DeepSeek: only Flash (api-docs.deepseek.com, Models & Pricing, "Vision"); Pro
 * silently ignores images. Ollama: the model's reported capabilities.
 */
const visionCache = new Map<string, boolean>();
export async function supportsVision(worker: Worker, model = worker.model): Promise<boolean> {
  if (worker.provider === "deepseek") return model === "deepseek-flash" || model.startsWith("deepseek-v4-flash");
  const key = model.replace(/:latest$/, "");
  if (visionCache.has(key)) return visionCache.get(key)!;
  try {
    const res = await fetch(`${ollamaRoot()}/api/show`, { method: "POST", body: JSON.stringify({ model }), signal: AbortSignal.timeout(3000) });
    const j = (await res.json()) as { capabilities?: string[] };
    const ok = !!j.capabilities?.includes("vision");
    visionCache.set(key, ok);
    return ok;
  } catch {
    return false;
  }
}

/** Models the worker can use: a fixed list for DeepSeek, installed models for Ollama */
export async function listModels(worker: Worker): Promise<WorkerModel[]> {
  if (worker.provider === "deepseek") return [{ id: "deepseek-flash", vision: true }, { id: "deepseek-v4-pro", vision: false }];
  // Ollama's own API: also returns size and vision capability info
  const root = ollamaRoot();
  try {
    const res = await fetch(`${root}/api/tags`, { signal: AbortSignal.timeout(3000) });
    if (!res.ok) return [];
    const j = (await res.json()) as { models?: { name: string; details?: { parameter_size?: string } }[] };
    return await Promise.all(
      (j.models ?? []).map(async (m) => {
        const show = await fetch(`${root}/api/show`, { method: "POST", body: JSON.stringify({ model: m.name }), signal: AbortSignal.timeout(3000) })
          .then((r) => r.json() as Promise<{ capabilities?: string[] }>)
          .catch(() => ({ capabilities: undefined }));
        return { id: m.name.replace(/:latest$/, ""), size: m.details?.parameter_size, vision: show.capabilities?.includes("vision") };
      }),
    );
  } catch {
    return [];
  }
}

/** Is the worker reachable right now? For DeepSeek the key is checked, for Ollama the server. */
export async function isAvailable(worker: Worker): Promise<{ ok: boolean; reason?: string }> {
  if (worker.provider === "deepseek") {
    return config.deepseekApiKey ? { ok: true } : { ok: false, reason: "DEEPSEEK_API_KEY missing" };
  }
  try {
    const res = await fetch(`${config.ollamaBaseUrl}/models`, { signal: AbortSignal.timeout(1500) });
    return res.ok ? { ok: true } : { ok: false, reason: `Ollama did not respond (${res.status})` };
  } catch {
    return { ok: false, reason: "Ollama is not running" };
  }
}

/** DeepSeek account balance. The key is never written anywhere, only used in the request header. */
export async function deepseekBalance(): Promise<DeepSeekBalance> {
  const checkedAt = Date.now();
  if (!config.deepseekApiKey) return { ok: false, error: "DEEPSEEK_API_KEY missing", checkedAt };
  try {
    const res = await fetch(`${config.deepseekBaseUrl}/user/balance`, {
      headers: { Authorization: `Bearer ${config.deepseekApiKey}`, Accept: "application/json" },
      signal: AbortSignal.timeout(8000),
    });
    if (res.status === 401) return { ok: false, error: "Invalid key (401)", checkedAt };
    if (!res.ok) return { ok: false, error: `DeepSeek did not respond (${res.status})`, checkedAt };
    const j = (await res.json()) as {
      is_available?: boolean;
      balance_infos?: { currency?: string; total_balance?: string; granted_balance?: string; topped_up_balance?: string }[];
    };
    // If there are multiple currencies, prefer USD
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
