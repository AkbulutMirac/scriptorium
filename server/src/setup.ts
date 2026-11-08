import { execFile, spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { appendFile, readFile, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { config, SERVER_ROOT } from "./config.js";
import { deepseekBalance, listModels } from "./llm.js";
import type { SetupStatus } from "./protocol.js";
import { WORKER_SERVER_NAME } from "./workerTools.js";

/**
 * İlk kurulum: Claude girişi, DeepSeek anahtarı, Ollama modelleri, bütün Claude Code oturumlarına
 * bağlama ve CLAUDE.md kuralları. Hepsi arayüzdeki Kurulum penceresinden yapılır.
 */

const run = promisify(execFile);
const REPO_ROOT = path.resolve(SERVER_ROOT, "..");
const ENV_PATH = path.join(REPO_ROOT, ".env");
const RULES_PATH = path.join(REPO_ROOT, "docs", "CLAUDE-isciler.md");
const RULES_MARKER = "## Scriptorium işçileri";
const GLOBAL_CLAUDE_MD = path.join(os.homedir(), ".claude", "CLAUDE.md");

/**
 * Kullanılacak Claude Code programı: .env'deki CLAUDE_CODE_PATH, yoksa SDK ile gelen dahili sürüm.
 * Kullanıcının ayrıca Claude Code kurmasına gerek yok; giriş bilgileri ikisinde de ortak (~/.claude).
 */
function claudeCli(): { path: string; source: "kurulu" | "dahili" } | undefined {
  if (config.claudeCodePath && existsSync(config.claudeCodePath)) return { path: config.claudeCodePath, source: "kurulu" };
  try {
    const require = createRequire(import.meta.url);
    const pkg = require.resolve(`@anthropic-ai/claude-agent-sdk-${process.platform}-${process.arch}/package.json`);
    const exe = path.join(path.dirname(pkg), process.platform === "win32" ? "claude.exe" : "claude");
    if (existsSync(exe)) return { path: exe, source: "dahili" };
  } catch {
    /* bu platform için paket yok */
  }
  return undefined;
}

async function claudeStatus(): Promise<SetupStatus["claude"]> {
  const cli = claudeCli();
  if (!cli) return { found: false, loggedIn: false };
  try {
    const { stdout } = await run(cli.path, ["auth", "status", "--json"], { timeout: 20_000, windowsHide: true });
    const s = JSON.parse(stdout) as { loggedIn?: boolean; email?: string; authMethod?: string; subscriptionType?: string };
    return { found: true, cliSource: cli.source, loggedIn: !!s.loggedIn, email: s.email, authMethod: s.authMethod };
  } catch (err) {
    // Giriş yapılmamışken bazı sürümler hata koduyla çıkıp yine JSON yazar
    const out = (err as { stdout?: string }).stdout;
    try {
      const s = JSON.parse(out ?? "") as { loggedIn?: boolean };
      return { found: true, cliSource: cli.source, loggedIn: !!s.loggedIn };
    } catch {
      return { found: true, cliSource: cli.source, loggedIn: false, error: err instanceof Error ? err.message : String(err) };
    }
  }
}

/** Tarayıcıda Anthropic giriş sayfasını açar. Giriş bitince Claude Code kendiliğinden kapanır. */
export function claudeLogin() {
  const cli = claudeCli();
  if (!cli) throw new Error("Claude Code bulunamadı. Proje klasöründe npm install çalıştır.");
  spawn(cli.path, ["auth", "login", "--claudeai"], { detached: true, stdio: "ignore", windowsHide: true }).unref();
}

async function mcpRegistered(): Promise<boolean> {
  const cli = claudeCli();
  if (!cli) return false;
  try {
    await run(cli.path, ["mcp", "get", WORKER_SERVER_NAME], { timeout: 20_000, windowsHide: true });
    return true;
  } catch {
    return false;
  }
}

/** Terminaldeki ve masaüstü uygulamasındaki bütün Claude Code oturumlarına işçi araçlarını ekler */
export async function registerMcp() {
  const cli = claudeCli();
  if (!cli) throw new Error("Claude Code bulunamadı.");
  const url = `http://127.0.0.1:${config.port}/mcp`;
  await run(cli.path, ["mcp", "add", "--scope", "user", "--transport", "http", WORKER_SERVER_NAME, url], { timeout: 30_000, windowsHide: true });
}

async function rulesInstalled(): Promise<boolean> {
  const text = await readFile(GLOBAL_CLAUDE_MD, "utf8").catch(() => "");
  return text.includes(RULES_MARKER);
}

/** Claude'un ne zaman iş devredeceğini anlatan kuralları ~/.claude/CLAUDE.md sonuna ekler (zaten varsa dokunmaz) */
export async function installRules() {
  if (await rulesInstalled()) return;
  const rules = await readFile(RULES_PATH, "utf8");
  const existing = await readFile(GLOBAL_CLAUDE_MD, "utf8").catch(() => "");
  await appendFile(GLOBAL_CLAUDE_MD, `${existing && !existing.endsWith("\n") ? "\n" : ""}\n${rules}`, "utf8");
}

/** .env dosyasında bir değeri günceller ya da ekler. .env yoksa örnek dosyadan oluşturur. */
async function setEnv(key: string, value: string) {
  let text = existsSync(ENV_PATH)
    ? await readFile(ENV_PATH, "utf8")
    : await readFile(path.join(REPO_ROOT, ".env.example"), "utf8").catch(() => "");
  const line = `${key}=${value}`;
  const re = new RegExp(`^${key}=.*$`, "m");
  text = re.test(text) ? text.replace(re, line) : `${text}${text && !text.endsWith("\n") ? "\n" : ""}${line}\n`;
  await writeFile(ENV_PATH, text, "utf8");
}

/** DeepSeek anahtarını önce bakiye sorgusuyla dener, çalışırsa .env'ye yazar. Anahtar arayüze geri gönderilmez. */
export async function saveDeepseekKey(key: string) {
  const k = key.trim();
  if (!/^sk-[A-Za-z0-9_-]{16,200}$/.test(k)) throw new Error("Anahtar \"sk-\" ile başlamalı ve boşluk içermemeli.");
  const previous = config.deepseekApiKey;
  config.deepseekApiKey = k;
  const balance = await deepseekBalance();
  if (!balance.ok) {
    config.deepseekApiKey = previous;
    throw new Error(`DeepSeek anahtarı kabul etmedi: ${balance.error}`);
  }
  await setEnv("DEEPSEEK_API_KEY", k);
}

async function ollamaStatus(): Promise<SetupStatus["ollama"]> {
  const models = await listModels({ id: "_", name: "_", provider: "ollama", model: "_", color: "", description: "", local: true });
  const root = config.ollamaBaseUrl.replace(/\/v1\/?$/, "");
  const running = await fetch(`${root}/api/version`, { signal: AbortSignal.timeout(1500) })
    .then((r) => r.ok)
    .catch(() => false);
  return { running, models };
}

export async function setupStatus(): Promise<SetupStatus> {
  const [claude, ollama, mcp, rules] = await Promise.all([claudeStatus(), ollamaStatus(), mcpRegistered(), rulesInstalled()]);
  return { claude, deepseek: { configured: !!config.deepseekApiKey }, ollama, mcp, rules };
}
