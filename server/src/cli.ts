/**
 * Terminal test tool. We test the Claude session and worker tools from here until the UI is ready.
 *
 *   npm run cli                  → chat mode
 *   npm run cli -- "mesaj"       → sends a single message, prints the reply, exits
 */
import readline from "node:readline/promises";
import { stdin, stdout } from "node:process";
import type { CanUseTool, SDKMessage } from "@anthropic-ai/claude-agent-sdk";
import { ClaudeSession } from "./claude.js";
import { bus } from "./events.js";

const rl = readline.createInterface({ input: stdin, output: stdout });
const dim = (s: string) => `\x1b[2m${s}\x1b[0m`;

bus.on("activity", (e) => {
  const detail = e.task ? `: ${e.task.slice(0, 80)}` : e.error ? `: ${e.error}` : "";
  console.log(dim(`\n[worker ${e.agentId} → ${e.status}${detail}]`));
});

let finishTurn: (() => void) | null = null;

function render(msg: SDKMessage) {
  if (process.env.DEBUG_SDK) {
    const sub = "subtype" in msg ? `/${msg.subtype}` : "";
    const extra = msg.type === "result" ? ` ${JSON.stringify({ is_error: msg.is_error, num_turns: msg.num_turns, result: "result" in msg ? msg.result : undefined }).slice(0, 300)}` : "";
    console.log(dim(`<${msg.type}${sub}>${extra}`));
  }
  switch (msg.type) {
    case "system":
      if (msg.subtype === "init") {
        const mcpTools = msg.tools.filter((t) => t.startsWith("mcp__scriptorium__"));
        const auth = msg.apiKeySource === "none" ? "subscription login" : `API key (${msg.apiKeySource})`;
        console.log(dim(`[Claude Code ${msg.claude_code_version} · ${msg.model} · ${auth} · worker tools: ${mcpTools.join(", ") || "NONE"}]`));
      }
      break;
    case "stream_event": {
      const ev = msg.event;
      if (ev.type === "content_block_delta" && ev.delta.type === "text_delta") stdout.write(ev.delta.text);
      break;
    }
    case "assistant":
      for (const block of msg.message.content) {
        if (block.type === "tool_use") {
          console.log(dim(`\n[tool] ${block.name} ${JSON.stringify(block.input).slice(0, 200)}`));
        }
      }
      break;
    case "result":
      if (msg.is_error) {
        const reason = "result" in msg ? msg.result : msg.subtype;
        console.log(`\n\x1b[31m[error] ${reason}\x1b[0m`);
      }
      console.log(dim(`\n[turn finished: ${msg.subtype}, ${(msg.duration_ms / 1000).toFixed(1)} s]`));
      finishTurn?.();
      finishTurn = null;
      break;
  }
}

const canUseTool: CanUseTool = async (toolName, input, { title }) => {
  const answer = await rl.question(
    `\n${title ?? toolName}\n${dim(JSON.stringify(input).slice(0, 300))}\nAllow? (y/n) `,
  );
  return answer.trim().toLowerCase().startsWith("y")
    ? { behavior: "allow", updatedInput: input }
    : { behavior: "deny", message: "User denied permission." };
};

async function runTurn(session: ClaudeSession, text: string) {
  const turnDone = new Promise<void>((resolve) => (finishTurn = resolve));
  session.send(text);
  await Promise.race([turnDone, session.done]);
}

const main = new ClaudeSession({ onMessage: render, canUseTool });

const oneShot = process.argv.slice(2).join(" ").trim();
if (oneShot) {
  await runTurn(main, oneShot);
} else {
  console.log(dim("Commands: /side <message> → side chat (does not disturb the main chat), /quit → exit"));
  while (true) {
    const line = (await rl.question("\n> ")).trim();
    if (!line) continue;
    if (line === "/quit") break;
    if (line.startsWith("/side ")) {
      if (!main.sessionId) {
        console.log("First send a message to the main chat.");
        continue;
      }
      const side = new ClaudeSession({ resume: main.sessionId, fork: true, onMessage: render, canUseTool });
      console.log(dim("[side chat opened]"));
      await runTurn(side, line.slice(6));
      side.close();
      console.log(dim("[side chat closed, returned to main chat]"));
      continue;
    }
    await runTurn(main, line);
  }
}

main.close();
rl.close();
