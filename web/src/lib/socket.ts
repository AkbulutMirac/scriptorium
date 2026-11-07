import type { ClientMsg, ServerMsg } from "../protocol";

export type ConnectionStatus = "connecting" | "open" | "closed";

/** Arka uca tek WebSocket bağlantısı. Kopunca kendiliğinden yeniden bağlanır, bağlantı yokken gönderilenleri sıraya alır. */
class Socket {
  private ws: WebSocket | null = null;
  private queue: ClientMsg[] = [];
  private listeners = new Set<(msg: ServerMsg) => void>();
  private statusListeners = new Set<(s: ConnectionStatus) => void>();
  private openListeners = new Set<() => void>();
  status: ConnectionStatus = "closed";

  connect() {
    if (this.ws) return;
    this.setStatus("connecting");
    const url = `${location.protocol === "https:" ? "wss" : "ws"}://${location.host}/ws`;
    const ws = new WebSocket(url);
    this.ws = ws;

    ws.onopen = () => {
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
    ws.onclose = () => {
      this.ws = null;
      this.setStatus("closed");
      setTimeout(() => this.connect(), 1500);
    };
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

  /** Her (yeniden) bağlanışta çalışır */
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
