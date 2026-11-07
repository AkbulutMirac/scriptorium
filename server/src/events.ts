import { EventEmitter } from "node:events";
import type { AgentActivity } from "./protocol.js";

/** Uygulama içi olay yolu. WebSocket sunucusu bunları dinleyip arayüze iletir. */
export const bus = new EventEmitter<{
  activity: [AgentActivity];
  jobs: [];
}>();
