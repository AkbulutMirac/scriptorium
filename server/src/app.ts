import { execFile, spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { rm } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { config, SERVER_ROOT } from "./config.js";

const execFileAsync = promisify(execFile);

export const appControlSupported = process.platform === "win32";

const scriptsDir = path.join(path.resolve(SERVER_ROOT, ".."), "scripts");
const vbsPath = path.join(scriptsDir, "Scriptorium.vbs");
const wscriptPath = path.join(process.env.WINDIR || "C:\\Windows", "System32", "wscript.exe");

function psQuote(value: string): string {
  return `'${value.replace(/'/g, "''")}'`;
}

function autostartLnkPath(): string {
  return path.join(process.env.APPDATA || "", "Microsoft", "Windows", "Start Menu", "Programs", "Startup", "Scriptorium.lnk");
}

/** Starts a detached process that waits for this server to exit, then relaunches it (the caller exits right after) */
export function restartApp(): void {
  if (!appControlSupported) return;
  // A detached Node process, not PowerShell: powershell.exe started detached (no console) exits without running its command
  const script = `
const { spawn } = require("node:child_process");
const url = ${JSON.stringify(`http://127.0.0.1:${config.port}/api/health`)};
(async () => {
  for (let i = 0; i < 40; i++) {
    try { await fetch(url, { signal: AbortSignal.timeout(1000) }); } catch { break; }
    await new Promise((r) => setTimeout(r, 500));
  }
  spawn(${JSON.stringify(wscriptPath)}, [${JSON.stringify(vbsPath)}, "--no-browser"], { detached: true, stdio: "ignore" }).unref();
})();
`;
  spawn(process.execPath, ["-e", script], { detached: true, stdio: "ignore", windowsHide: true }).unref();
}

/** Whether a Scriptorium shortcut is in the Windows Startup folder */
export function getAutostart(): boolean {
  if (!appControlSupported) return false;
  return existsSync(autostartLnkPath());
}

export async function setAutostart(on: boolean): Promise<boolean> {
  if (!appControlSupported) throw new Error("Start at login is only supported on Windows.");
  const lnkPath = autostartLnkPath();
  if (on) {
    const script = `
$sh = New-Object -ComObject WScript.Shell
$lnk = $sh.CreateShortcut(${psQuote(lnkPath)})
$lnk.TargetPath = ${psQuote(wscriptPath)}
$lnk.Arguments = ${psQuote(`"${vbsPath}" --no-browser`)}
$lnk.WorkingDirectory = ${psQuote(scriptsDir)}
$lnk.IconLocation = ${psQuote(`${path.join(scriptsDir, "scriptorium.ico")},0`)}
$lnk.Save()
`;
    await execFileAsync("powershell", ["-NoProfile", "-Command", script], { windowsHide: true });
  } else {
    await rm(lnkPath, { force: true });
  }
  return getAutostart();
}
