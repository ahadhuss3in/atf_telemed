import type { BusEvent, ClientMessage, MessageType } from "./protocol";
import { isServerMessage } from "./protocol";

export type ConnectionStatus = "idle" | "connecting" | "open" | "closed";

type Handler = (event: BusEvent) => void;

/** Timer handles are numbers in the browser and Timeout under @types/node, so
 *  the setTimeout return type is the only spelling correct for both. */
type TimerHandle = ReturnType<typeof setTimeout>;

/**
 * Typed WebSocket transport with a send queue and reconnect-with-backoff.
 *
 * Deliberately framework-agnostic: React binds to it through a hook, so the
 * socket lifecycle is never tangled up with effect ordering.
 */
export class SignalingClient {
  private ws: WebSocket | null = null;
  private readonly handlers = new Map<MessageType | "*", Set<Handler>>();
  private queue: ClientMessage[] = [];
  private attempts = 0;
  private timer: TimerHandle | undefined;
  private disposed = false;
  private listeners = new Set<() => void>();
  private snapshot: { status: ConnectionStatus; url: string } = {
    status: "idle",
    url: "",
  };

  constructor(readonly url: string) {}

  // ------------------------------------------------------------ react binding

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  getSnapshot = (): { status: ConnectionStatus; url: string } => this.snapshot;

  private setStatus(status: ConnectionStatus): void {
    if (this.snapshot.status === status) return;
    this.snapshot = { status, url: this.url };
    for (const listener of this.listeners) listener();
  }

  // ---------------------------------------------------------------- transport

  connect(): void {
    if (this.disposed) return;
    if (
      this.ws &&
      (this.ws.readyState === WebSocket.OPEN ||
        this.ws.readyState === WebSocket.CONNECTING)
    ) {
      return;
    }

    this.setStatus("connecting");
    let ws: WebSocket;
    try {
      ws = new WebSocket(this.url);
    } catch {
      this.setStatus("closed");
      this.scheduleReconnect();
      return;
    }
    this.ws = ws;

    ws.onopen = () => {
      this.attempts = 0;
      this.setStatus("open");
      // Emit before flushing: handlers authenticate here, so `hello` must be
      // sent ahead of anything that queued while the socket was down.
      this.emit({ t: "__open" });
      for (const message of this.queue.splice(0)) ws.send(JSON.stringify(message));
    };

    ws.onmessage = (event: MessageEvent<string>) => {
      let parsed: unknown;
      try {
        parsed = JSON.parse(event.data);
      } catch {
        return;
      }
      if (isServerMessage(parsed)) this.emit(parsed);
    };

    ws.onerror = () => {
      // onclose always follows; reconnect is scheduled there.
    };

    ws.onclose = () => {
      if (this.disposed) return;
      this.emit({ t: "__close" });
      this.setStatus("closed");
      this.scheduleReconnect();
    };
  }

  private scheduleReconnect(): void {
    if (this.disposed || this.timer) return;
    const delay = Math.min(1000 * 2 ** this.attempts++, 8000);
    this.timer = setTimeout(() => {
      this.timer = undefined;
      this.connect();
    }, delay);
  }

  /** Sends immediately when open, otherwise queues until the socket opens. */
  send(message: ClientMessage): void {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(message));
      return;
    }
    this.queue.push(message);
    this.connect();
  }

  dispose(): void {
    this.disposed = true;
    clearTimeout(this.timer);
    this.timer = undefined;
    this.handlers.clear();
    this.ws?.close();
    this.ws = null;
  }

  // ------------------------------------------------------------------ events

  on(type: MessageType | "*", handler: Handler): () => void {
    let set = this.handlers.get(type);
    if (!set) {
      set = new Set();
      this.handlers.set(type, set);
    }
    set.add(handler);
    return () => set.delete(handler);
  }

  private emit(event: BusEvent): void {
    for (const handler of this.handlers.get(event.t) ?? []) handler(event);
    for (const handler of this.handlers.get("*") ?? []) handler(event);
  }
}