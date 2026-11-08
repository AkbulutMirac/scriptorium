import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));

/** server/ folder */
export const SERVER_ROOT = path.resolve(here, "..");

export const config = {
  deepseekApiKey: process.env.DEEPSEEK_API_KEY ?? "",
  deepseekBaseUrl: "https://api.deepseek.com",
  ollamaBaseUrl: process.env.OLLAMA_BASE_URL || "http://localhost:11434/v1",
  /** If empty, the Claude Code bundled with the SDK is used. */
  claudeCodePath: process.env.CLAUDE_CODE_PATH || undefined,
  /** Claude's default working folder. If empty, this repo. Can be changed per chat from the UI. */
  claudeCwd: path.resolve(process.env.CLAUDE_CWD || path.join(SERVER_ROOT, "..")),
  /** Where project folders live (auto-listed in the folder picker). If empty, the parent folder of this repo. */
  projectsDir: path.resolve(process.env.PROJECTS_DIR || path.join(SERVER_ROOT, "..", "..")),
  /** Folders that never appear in lists: names under PROJECTS_DIR or full paths, comma-separated. Folders are not touched. */
  projectsExclude: (process.env.PROJECTS_EXCLUDE ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean),
  workerMaxTokens: Number(process.env.WORKER_MAX_TOKENS) || 4000,
  port: Number(process.env.PORT) || 7777,
  /**
   * Optional remote access through `tailscale serve` (off unless set). Addresses the UI is opened from,
   * comma-separated, e.g. "http://mypc.tailnet.ts.net:7777". Requests to these must carry Tailscale's
   * identity header, which only `tailscale serve` adds.
   */
  remoteOrigins: (process.env.REMOTE_ORIGINS ?? "")
    .split(",")
    .map((s) => s.trim().replace(/\/+$/, ""))
    .filter(Boolean),
  /** Tailscale logins allowed to use remote access (comma-separated). Empty: any user of your tailnet. */
  remoteUsers: (process.env.REMOTE_USERS ?? "")
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean),
};
