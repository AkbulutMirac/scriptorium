import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));

/** server/ klasörü */
export const SERVER_ROOT = path.resolve(here, "..");

export const config = {
  deepseekApiKey: process.env.DEEPSEEK_API_KEY ?? "",
  deepseekBaseUrl: "https://api.deepseek.com",
  ollamaBaseUrl: process.env.OLLAMA_BASE_URL || "http://localhost:11434/v1",
  /** Boşsa SDK'nın kendi paketindeki Claude Code kullanılır. */
  claudeCodePath: process.env.CLAUDE_CODE_PATH || undefined,
  /** Claude'un varsayılan çalışma klasörü. Boşsa bu repo. Arayüzden sohbet başına değiştirilebilir. */
  claudeCwd: path.resolve(process.env.CLAUDE_CWD || path.join(SERVER_ROOT, "..")),
  workerMaxTokens: Number(process.env.WORKER_MAX_TOKENS) || 4000,
  port: Number(process.env.PORT) || 7777,
};
