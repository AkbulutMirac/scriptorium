import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { isInitializeRequest, ListRootsResultSchema } from "@modelcontextprotocol/sdk/types.js";
import { randomUUID } from "node:crypto";
import type { IncomingMessage, ServerResponse } from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { WORKER_INSTRUCTIONS, WORKER_SERVER_NAME, WORKER_TOOLS, type ToolCtx } from "./workerTools.js";

/**
 * Exposes the worker tools as an MCP server at http://127.0.0.1:<port>/mcp. This way, Claude Code sessions in the terminal
 * and in the desktop app also use the workers:
 *   claude mcp add --scope user --transport http scriptorium http://127.0.0.1:7777/mcp
 * All sessions share the same queues and appear in the 3D office.
 */

const MAX_BODY = 10 * 1024 * 1024;
const MAX_SESSIONS = 200;
const LOCAL_HOST = /^(localhost|127\.0\.0\.1)(:\d+)?$/;

type Session = { transport: StreamableHTTPServerTransport; ctx: ToolCtx; rootsTried: boolean; server: McpServer };
const sessions = new Map<string, Session>();

function readJson(req: IncomingMessage): Promise<unknown> {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks: Buffer[] = [];
    req.on("data", (c: Buffer) => {
      size += c.length;
      if (size > MAX_BODY) {
        reject(new Error("Request too large"));
        req.destroy();
      } else chunks.push(c);
    });
    req.on("end", () => {
      try {
        resolve(chunks.length ? JSON.parse(Buffer.concat(chunks).toString("utf8")) : undefined);
      } catch (err) {
        reject(err);
      }
    });
    req.on("error", reject);
  });
}

function jsonError(res: ServerResponse, status: number, message: string) {
  res.writeHead(status, { "content-type": "application/json" });
  res.end(JSON.stringify({ jsonrpc: "2.0", error: { code: -32000, message }, id: null }));
}

/**
 * Asks the client (MCP "roots") once for the session's working folder. If Claude Code provides its folder
 * here, file paths are resolved accordingly and the project name appears in the 3D office.
 */
async function resolveCtx(s: Session, extra: { sendRequest: (req: { method: "roots/list" }, schema: typeof ListRootsResultSchema) => Promise<{ roots: { uri: string }[] }> }) {
  if (s.rootsTried) return s.ctx;
  s.rootsTried = true;
  if (!s.server.server.getClientCapabilities()?.roots) return s.ctx;
  try {
    const { roots } = await Promise.race([
      extra.sendRequest({ method: "roots/list" }, ListRootsResultSchema),
      new Promise<never>((_, rej) => setTimeout(() => rej(new Error("timeout")), 3000)),
    ]);
    const uri = roots[0]?.uri;
    if (uri?.startsWith("file:")) {
      s.ctx.cwd = fileURLToPath(uri);
      s.ctx.caller.label = path.basename(s.ctx.cwd) || s.ctx.caller.label;
    }
  } catch {
    /* could not learn the folder: if Claude provides project_dir, that is used */
  }
  return s.ctx;
}

function newSession(): StreamableHTTPServerTransport {
  const server = new McpServer({ name: WORKER_SERVER_NAME, version: "0.2.0" }, { instructions: WORKER_INSTRUCTIONS });
  const session = { ctx: { caller: { kind: "claude", label: "Claude Code" } }, rootsTried: false, server } as Session;

  for (const t of WORKER_TOOLS) {
    // anthropic/alwaysLoad: Claude Code does not hide tools behind ToolSearch; they are ready from the first message
    server.registerTool(t.name, { description: t.description, inputSchema: t.schema, _meta: { "anthropic/alwaysLoad": true } }, (async (args: unknown, extra: Parameters<typeof resolveCtx>[1]) =>
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (t.handler as any)(args, await resolveCtx(session, extra))) as never);
  }

  const transport = new StreamableHTTPServerTransport({
    sessionIdGenerator: randomUUID,
    onsessioninitialized: (id) => {
      sessions.set(id, session);
      // Clean up old sessions that disappeared without closing
      while (sessions.size > MAX_SESSIONS) {
        const [oldId, old] = sessions.entries().next().value!;
        sessions.delete(oldId);
        old.transport.close().catch(() => {});
      }
    },
  });
  transport.onclose = () => {
    if (transport.sessionId) sessions.delete(transport.sessionId);
  };
  session.transport = transport;
  server.connect(transport).catch(() => {});
  return transport;
}

/** Handles /mcp requests. Only from this computer; other sites in the browser cannot access it. */
export function createMcpHandler(allowedOrigins: Set<string>) {
  return async (req: IncomingMessage, res: ServerResponse) => {
    // Against DNS rebinding and requests from the browser: Host must be local, and if Origin is present it must be our UI
    if (!LOCAL_HOST.test(req.headers.host ?? "")) return jsonError(res, 403, "Forbidden");
    const origin = req.headers.origin;
    if (origin && !allowedOrigins.has(origin)) return jsonError(res, 403, "Forbidden");

    try {
      const body = req.method === "POST" ? await readJson(req) : undefined;
      const sid = req.headers["mcp-session-id"];
      const id = Array.isArray(sid) ? sid[0] : sid;

      if (id) {
        const s = sessions.get(id);
        // If the server restarted: with 404 the client opens a new session
        if (!s) return jsonError(res, 404, "Session not found");
        return await s.transport.handleRequest(req, res, body);
      }
      if (req.method === "POST" && isInitializeRequest(body)) {
        return await newSession().handleRequest(req, res, body);
      }
      return jsonError(res, 400, "Invalid request: send initialize first");
    } catch (err) {
      if (!res.headersSent) jsonError(res, 500, err instanceof Error ? err.message : String(err));
    }
  };
}
