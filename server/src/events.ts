import { EventEmitter } from "node:events";
import type { AgentActivity } from "./protocol.js";

/** In-app event bus. The WebSocket server listens to these and forwards them to the UI. */
export const bus = new EventEmitter<{
  activity: [AgentActivity];
  jobs: [];
  requests: [];
}>();

const ERROR_VISIBLE_MS = 12_000;
const errorTimers = new Map<string, ReturnType<typeof setTimeout>>();

/** Reports agent status. The error state stays visible for a while, then automatically reverts to "idle". */
export function reportActivity(a: AgentActivity) {
  clearTimeout(errorTimers.get(a.agentId));
  errorTimers.delete(a.agentId);
  bus.emit("activity", a);
  if (a.status === "error") {
    errorTimers.set(
      a.agentId,
      setTimeout(() => {
        errorTimers.delete(a.agentId);
        bus.emit("activity", { agentId: a.agentId, status: "idle" });
      }, ERROR_VISIBLE_MS),
    );
  }
}
