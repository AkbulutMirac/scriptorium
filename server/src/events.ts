import { EventEmitter } from "node:events";
import type { AgentActivity } from "./protocol.js";

/** Uygulama içi olay yolu. WebSocket sunucusu bunları dinleyip arayüze iletir. */
export const bus = new EventEmitter<{
  activity: [AgentActivity];
  jobs: [];
  requests: [];
}>();

const ERROR_VISIBLE_MS = 12_000;
const errorTimers = new Map<string, ReturnType<typeof setTimeout>>();

/** Ajan durumunu bildirir. Hata durumu bir süre görünür, sonra kendiliğinden "boşta"ya döner. */
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
