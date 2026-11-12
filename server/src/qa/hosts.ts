import net from "node:net";
import { config } from "../config.js";

/** Remote-access hosts set up for Scriptorium (REMOTE_ORIGINS), e.g. this computer's Tailscale name */
const REMOTE_QA_HOSTS = new Set(config.remoteOrigins.map((o) => new URL(o).hostname.toLowerCase()));

/** A private or loopback IP literal: a name like 10.example.com is not one */
function privateIp(host: string): boolean {
  const ip = host.replace(/^\[|\]$/g, "");
  const version = net.isIP(ip);
  if (version === 4) {
    const [a, b] = ip.split(".").map(Number);
    // Loopback, private ranges, link-local and Tailscale's 100.64.0.0/10
    return a === 127 || a === 10 || (a === 192 && b === 168) || (a === 172 && b >= 16 && b <= 31) || (a === 169 && b === 254) || (a === 100 && b >= 64 && b <= 127);
  }
  if (version === 6) {
    const x = ip.toLowerCase();
    return x === "::1" || /^f[cd]/.test(x) || x.startsWith("fe80:");
  }
  return false;
}

/** Hosts the QA browser may open: checked for the first page and for every page it navigates to */
export function isLocalQaHost(host: string): boolean {
  const h = host.toLowerCase();
  return h === "localhost" || h.endsWith(".localhost") || h.endsWith(".test") || privateIp(h) || REMOTE_QA_HOSTS.has(h);
}
