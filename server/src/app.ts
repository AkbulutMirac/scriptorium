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
  const script = `
for ($i = 0; $i -lt 40; $i++) {
  try {
    Invoke-WebRequest -UseBasicParsing http://127.0.0.1:${config.port}/api/health -TimeoutSec 1 | Out-Null
    Start-Sleep -Milliseconds 500
  } catch {
    break
  }
}
Start-Process -FilePath ${psQuote(wscriptPath)} -ArgumentList @(${psQuote(`"${vbsPath}" --no-browser`)})
`;
  const child = spawn("powershell", ["-NoProfile", "-WindowStyle", "Hidden", "-Command", script], {
    detached: true,
    stdio: "ignore",
    windowsHide: true,
  });
  child.unref();
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
