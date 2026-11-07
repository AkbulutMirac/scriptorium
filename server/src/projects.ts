import { existsSync } from "node:fs";
import { readdir, stat } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { listSessions } from "@anthropic-ai/claude-agent-sdk";
import { config } from "./config.js";
import type { DirListing, ProjectInfo } from "./protocol.js";

const norm = (p: string) => path.resolve(p).normalize("NFC").toLowerCase();

/**
 * Proje sayılmayacak klasörler: geçici klasörler, uygulama verileri (Claude uygulamasının scratch çalışma alanları
 * AppData\\Roaming\\Claude altında) ve Windows sistem klasörü.
 */
const IGNORED_ROOTS = [
  os.tmpdir(),
  process.env.APPDATA,
  process.env.LOCALAPPDATA,
  process.env.SystemRoot ?? "C:\\Windows",
  // Kullanıcının listeden tamamen çıkardığı klasörler (PROJECTS_EXCLUDE); klasörlere dokunulmaz
  ...config.projectsExclude.map((p) => (path.isAbsolute(p) ? p : path.join(config.projectsDir, p))),
]
  .filter((p): p is string => !!p)
  .map(norm);
export const isIgnoredPath = (p: string) => IGNORED_ROOTS.some((root) => norm(p) === root || norm(p).startsWith(root + path.sep));

/**
 * Bilinen proje klasörleri: Claude Code oturumu olan her klasör + PROJECTS_DIR altındaki klasörler.
 * En son kullanılan önce.
 */
export async function listProjects(): Promise<ProjectInfo[]> {
  const byPath = new Map<string, ProjectInfo>();

  const sessions = await listSessions({ limit: 500 }).catch(() => []);
  for (const s of sessions) {
    if (!s.cwd || isIgnoredPath(s.cwd) || !existsSync(s.cwd)) continue;
    const key = norm(s.cwd);
    const prev = byPath.get(key);
    if (prev) {
      prev.sessionCount += 1;
      prev.lastUsed = Math.max(prev.lastUsed, s.lastModified);
    } else {
      byPath.set(key, { path: s.cwd, name: path.basename(s.cwd), lastUsed: s.lastModified, sessionCount: 1 });
    }
  }

  if (config.projectsDir && existsSync(config.projectsDir)) {
    const entries = await readdir(config.projectsDir, { withFileTypes: true }).catch(() => []);
    for (const e of entries) {
      if (!e.isDirectory() || e.name.startsWith(".") || e.name === "node_modules") continue;
      const full = path.join(config.projectsDir, e.name);
      const key = norm(full);
      if (byPath.has(key) || isIgnoredPath(full)) continue;
      const mtime = await stat(full).then((s) => s.mtimeMs).catch(() => 0);
      byPath.set(key, { path: full, name: e.name, lastUsed: mtime, sessionCount: 0 });
    }
  }

  return [...byPath.values()].sort((a, b) => b.lastUsed - a.lastUsed);
}

/** Klasör gezgini: bir klasörün alt klasörleri. Yol verilmezse kısayollar (ev, masaüstü, projeler, sürücüler). */
export async function listDir(dir?: string): Promise<DirListing> {
  if (!dir) {
    const home = os.homedir();
    const shortcuts = [
      { name: "Projeler", path: config.projectsDir },
      { name: "Ev klasörü", path: home },
      { name: "Masaüstü", path: path.join(home, "OneDrive", "Masaüstü") },
      { name: "Masaüstü", path: path.join(home, "Desktop") },
      { name: "Belgeler", path: path.join(home, "Documents") },
    ].filter((s) => s.path && existsSync(s.path));
    const drives =
      process.platform === "win32"
        ? "CDEFGHIJ".split("").map((d) => `${d}:\\`).filter((d) => existsSync(d)).map((d) => ({ name: d, path: d }))
        : [{ name: "/", path: "/" }];
    const seen = new Set<string>();
    const dirs = [...shortcuts, ...drives].filter((d) => !seen.has(norm(d.path)) && seen.add(norm(d.path)));
    return { path: "", dirs };
  }

  const abs = path.resolve(dir);
  const entries = await readdir(abs, { withFileTypes: true });
  const dirs = entries
    .filter((e) => e.isDirectory() && !e.name.startsWith(".") && !e.name.startsWith("$") && e.name !== "node_modules")
    .map((e) => ({ name: e.name, path: path.join(abs, e.name) }))
    .sort((a, b) => a.name.localeCompare(b.name, "tr"));
  const parent = path.dirname(abs);
  return { path: abs, parent: parent !== abs ? parent : "", dirs };
}
