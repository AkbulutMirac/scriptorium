import { execFile } from "node:child_process";
import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import type { GitInfo } from "./protocol.js";

const run = promisify(execFile);

/** runs the git command (no shell, arguments separate: no command injection) */
async function git(cwd: string, args: string[]): Promise<string> {
  const { stdout } = await run("git", args, { cwd, timeout: 10_000, maxBuffer: 20 * 1024 * 1024, windowsHide: true });
  return stdout;
}

async function hasHead(cwd: string) {
  try {
    await git(cwd, ["rev-parse", "--verify", "HEAD"]);
    return true;
  } catch {
    return false;
  }
}

function parseNumstat(out: string) {
  return out
    .split("\n")
    .filter(Boolean)
    .map((line) => {
      const [a, r, ...rest] = line.split("\t");
      return { path: rest.join("\t"), added: Number(a) || 0, removed: Number(r) || 0 };
    });
}

const MAX_UNTRACKED = 200;
const MAX_FILE_BYTES = 1_000_000;

async function countLines(file: string): Promise<number> {
  try {
    if ((await stat(file)).size > MAX_FILE_BYTES) return 0;
    const text = await readFile(file, "utf8");
    if (text.includes("\u0000")) return 0; // binary file
    return text.split("\n").length;
  } catch {
    return 0;
  }
}

/** Branch name and lines changed relative to HEAD (including untracked new files) */
export async function gitInfo(cwd: string): Promise<GitInfo> {
  try {
    await git(cwd, ["rev-parse", "--is-inside-work-tree"]);
  } catch {
    return { cwd, isRepo: false, added: 0, removed: 0, files: [] };
  }
  const branch = (await git(cwd, ["rev-parse", "--abbrev-ref", "HEAD"]).catch(() => "")).trim() || undefined;
  const tracked = (await hasHead(cwd))
    ? parseNumstat(await git(cwd, ["diff", "--numstat", "HEAD"]))
    : parseNumstat(await git(cwd, ["diff", "--numstat", "--cached"]));

  const untrackedPaths = (await git(cwd, ["ls-files", "--others", "--exclude-standard"])).split("\n").filter(Boolean).slice(0, MAX_UNTRACKED);
  const untracked = await Promise.all(
    untrackedPaths.map(async (p) => ({ path: p, added: await countLines(path.join(cwd, p)), removed: 0, untracked: true })),
  );

  const files = [...tracked, ...untracked];
  return {
    cwd,
    isRepo: true,
    branch,
    added: files.reduce((n, f) => n + f.added, 0),
    removed: files.reduce((n, f) => n + f.removed, 0),
    files,
  };
}

/** Diff of a file (or the entire working tree) relative to HEAD */
export async function gitDiff(cwd: string, file?: string): Promise<string> {
  const base = (await hasHead(cwd)) ? ["diff", "HEAD"] : ["diff", "--cached"];
  if (file) {
    const out = await git(cwd, [...base, "--", file]);
    if (out.trim()) return out;
    // Untracked new file: show it entirely as added
    const abs = path.resolve(cwd, file);
    if (!abs.startsWith(path.resolve(cwd))) return "";
    const text = await readFile(abs, "utf8").catch(() => "");
    return text
      .split("\n")
      .map((l) => `+${l}`)
      .join("\n");
  }
  return git(cwd, base);
}
