import { existsSync } from "node:fs";
import { mkdir, readdir, stat } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { listSessions } from "@anthropic-ai/claude-agent-sdk";
import { config } from "./config.js";
import type { DirListing, ProjectInfo } from "./protocol.js";

const norm = (p: string) => path.resolve(p).normalize("NFC").toLowerCase();

/**
 * Folders not considered projects: temp folders, app data (the Claude app's scratch workspaces
 * under AppData\\Roaming\\Claude) and the Windows system folder.
 */
const IGNORED_ROOTS = [
  os.tmpdir(),
  process.env.APPDATA,
  process.env.LOCALAPPDATA,
  process.env.SystemRoot ?? "C:\\Windows",
  // Folders the user has fully excluded from the list (PROJECTS_EXCLUDE); the folders themselves are left untouched
  ...config.projectsExclude.map((p) => (path.isAbsolute(p) ? p : path.join(config.projectsDir, p))),
]
  .filter((p): p is string => !!p)
  .map(norm);
/** Folder-less chats of the Claude app ("This computer"): each runs in its own scratch folder here */
const SCRATCH_ROOT = process.env.APPDATA ? norm(path.join(process.env.APPDATA, "Claude", "scratch-workspaces")) : "";
export const isScratchPath = (p: string) => !!SCRATCH_ROOT && norm(p).startsWith(SCRATCH_ROOT + path.sep);
export const isIgnoredPath =(p: string) => IGNORED_ROOTS.some((root) => norm(p) === root || norm(p).startsWith(root + path.sep));

/**
 * Known project folders: every folder with a Claude Code session + folders under PROJECTS_DIR.
 * Most recently used first.
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

/** Folder browser: the subfolders of a folder. If no path is given, shortcuts (home, desktop, projects, drives). */
export async function listDir(dir?: string): Promise<DirListing> {
  if (!dir) {
    const home = os.homedir();
    const shortcuts = [
      { name: "Projects", path: config.projectsDir },
      { name: "Home folder", path: home },
      // OneDrive-backed desktops are localized on non-English Windows (e.g. "Masaüstü" in Turkish)
      { name: "Desktop", path: path.join(home, "OneDrive", "Desktop") },
      { name: "Desktop", path: path.join(home, "OneDrive", "Masaüstü") },
      { name: "Desktop", path: path.join(home, "Desktop") },
      { name: "Documents", path: path.join(home, "Documents") },
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
    .sort((a, b) => a.name.localeCompare(b.name));
  const parent = path.dirname(abs);
  return { path: abs, parent: parent !== abs ? parent : "", dirs };
}

/** Creates a subfolder (folder picker's "New folder") and returns its path */
export async function makeDir(parent: string, name: string): Promise<string> {
  const trimmed = name.trim();
  if (!trimmed) throw new Error("Folder name cannot be empty.");
  if (trimmed.includes("/") || trimmed.includes("\\")) throw new Error("Folder name cannot contain slashes.");
  if (trimmed === "." || trimmed === "..") throw new Error("Folder name is not allowed.");
  if (/[<>:"|?*\u0000-\u001F\u007F]/.test(trimmed)) throw new Error("Folder name contains invalid characters.");
  const full = path.join(path.resolve(parent), trimmed);
  if (existsSync(full)) throw new Error("A folder with this name already exists.");
  await mkdir(full);
  return full;
}
