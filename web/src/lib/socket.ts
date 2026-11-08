import type { ClientMsg, ServerMsg } from "../protocol";

export type ConnectionStatus = "connecting" | "open" | "closed";

/** Single WebSocket connection to the backend. Reconnects automatically when dropped, queues messages sent while disconnected. */
class Socket {
  private ws: WebSocket | null = null;
  private queue: ClientMsg[] = [];
  private listeners = new Set<(msg: ServerMsg) => void>();
  private statusListeners = new Set<(s: ConnectionStatus) => void>();
  private openListeners = new Set<() => void>();
  status: ConnectionStatus = "closed";
  private retry: ReturnType<typeof setTimeout> | undefined;

  constructor() {
    // Background tabs throttle timers: when the tab comes back (or the network does), retry right away
    const now = () => this.status === "closed" && this.connect();
    document.addEventListener("visibilitychange", () => document.visibilityState === "visible" && now());
    window.addEventListener("focus", now);
    window.addEventListener("online", now);
  }

  connect() {
    if (this.ws) return;
    clearTimeout(this.retry);
    this.setStatus("connecting");
    const url = `${location.protocol === "https:" ? "wss" : "ws"}://${location.host}/ws`;
    const ws = new WebSocket(url);
    this.ws = ws;
    // A connection attempt made while the server restarts can hang in "connecting" forever: give up and retry
    const timeout = setTimeout(() => ws.readyState === WebSocket.CONNECTING && drop(), 5000);
    const drop = () => {
      clearTimeout(timeout);
      if (this.ws !== ws) return;
      ws.onopen = ws.onmessage = ws.onclose = null;
      ws.close();
      this.ws = null;
      this.setStatus("closed");
      this.retry = setTimeout(() => this.connect(), 1500);
    };

    ws.onopen = () => {
      clearTimeout(timeout);
      this.setStatus("open");
      for (const fn of this.openListeners) fn();
      const pending = this.queue;
      this.queue = [];
      for (const msg of pending) ws.send(JSON.stringify(msg));
    };
    ws.onmessage = (e) => {
      const msg = JSON.parse(e.data) as ServerMsg;
      for (const fn of this.listeners) fn(msg);
    };
    ws.onclose = drop;
  }

  send(msg: ClientMsg) {
    if (this.ws?.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify(msg));
    else this.queue.push(msg);
  }

  onMessage(fn: (msg: ServerMsg) => void) {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  onStatus(fn: (s: ConnectionStatus) => void) {
    this.statusListeners.add(fn);
    return () => this.statusListeners.delete(fn);
  }

  /** Runs on every (re)connect */
  onOpen(fn: () => void) {
    this.openListeners.add(fn);
    return () => this.openListeners.delete(fn);
  }

  private setStatus(s: ConnectionStatus) {
    this.status = s;
    for (const fn of this.statusListeners) fn(s);
  }
}

export const socket = new Socket();
