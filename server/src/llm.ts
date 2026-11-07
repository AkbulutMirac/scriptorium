import OpenAI from "openai";
import { config } from "./config.js";
import type { Worker } from "./agents.js";

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
