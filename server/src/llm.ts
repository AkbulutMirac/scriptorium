import OpenAI from "openai";
import { config } from "./config.js";
import type { Worker } from "./agents.js";
import type { DeepSeekBalance } from "./protocol.js";

export type ChatMessage = { role: "system" | "user" | "assistant"; content: string };

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

/** İşçiye mesaj gönderir, cevabı akış halinde alır ve tamamını döndürür. */
export async function chat(
  worker: Worker,
  messages: ChatMessage[],
  opts: { maxTokens?: number; signal?: AbortSignal; onToken?: (text: string) => void } = {},
): Promise<string> {
  const stream = await clientFor(worker).chat.completions.create(
    {
      model: worker.model,
      messages,
      max_tokens: opts.maxTokens ?? config.workerMaxTokens,
      stream: true,
    },
    { signal: opts.signal },
  );

  let full = "";
  for await (const chunk of stream) {
    const text = chunk.choices[0]?.delta?.content ?? "";
    if (text) {
      full += text;
      opts.onToken?.(text);
    }
  }
  return full;
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
