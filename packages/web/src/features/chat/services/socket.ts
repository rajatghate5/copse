/**
 * The WebSocket service - the whole reason for a service layer. All connection
 * concern lives here: opening, JSON framing, and automatic reconnection with
 * backoff. Nothing above it touches a raw socket; hooks call `send` and receive
 * parsed frames through a handler.
 *
 * Resilience is the point. A dropped socket retries on its own with growing
 * backoff, and the first connection may take ~50s on a cold free-tier server, so
 * "connecting" is a normal state the UI shows rather than an error.
 */

import type { ClientMessage, ServerMessage } from '@copse/protocol';
import type { Connection } from '../store/chatStore.ts';

interface Handlers {
  onMessage: (msg: ServerMessage) => void;
  onState: (state: Connection) => void;
}

const MIN_BACKOFF = 500;
const MAX_BACKOFF = 8000;

export class SocketService {
  private ws: WebSocket | null = null;
  private handlers: Handlers | null = null;
  private backoff = MIN_BACKOFF;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private closedByUs = false;

  connect(handlers: Handlers): void {
    this.handlers = handlers;
    this.closedByUs = false;
    this.open(true);
  }

  private url(): string {
    const proto = location.protocol === 'https:' ? 'wss' : 'ws';
    return `${proto}://${location.host}/ws`;
  }

  private open(first: boolean): void {
    this.handlers?.onState(first ? 'connecting' : 'reconnecting');
    let ws: WebSocket;
    try {
      ws = new WebSocket(this.url());
    } catch {
      this.scheduleReconnect();
      return;
    }
    this.ws = ws;

    ws.onopen = () => {
      this.backoff = MIN_BACKOFF;
      this.handlers?.onState('online');
    };
    ws.onmessage = (ev) => {
      try {
        this.handlers?.onMessage(JSON.parse(ev.data as string) as ServerMessage);
      } catch { /* ignore a frame we can't parse */ }
    };
    ws.onclose = () => {
      this.ws = null;
      if (this.closedByUs) return this.handlers?.onState('offline');
      this.scheduleReconnect();
    };
    ws.onerror = () => ws.close();
  }

  private scheduleReconnect(): void {
    this.handlers?.onState('reconnecting');
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => this.open(false), this.backoff);
    this.backoff = Math.min(this.backoff * 2, MAX_BACKOFF);
  }

  /** Send a client message. Returns false if the socket is not open, so the
   * caller can queue it instead of losing it. */
  send(msg: ClientMessage): boolean {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(msg));
      return true;
    }
    return false;
  }

  get isOpen(): boolean {
    return this.ws?.readyState === WebSocket.OPEN;
  }

  close(): void {
    this.closedByUs = true;
    if (this.timer) clearTimeout(this.timer);
    this.ws?.close();
    this.ws = null;
  }
}
