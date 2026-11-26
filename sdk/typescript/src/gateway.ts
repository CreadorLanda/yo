import type { BotEvent } from './types.js';

type Frame = { op: string; t?: string; s?: number; d?: unknown };

export type GatewayOptions = {
  url: string;
  token: string;
  intents?: string[];
  /** The last event id handled; the gateway replays what came after it. */
  resumeFrom?: () => number;
  onEvent: (e: BotEvent) => void | Promise<void>;
  onReady?: () => void;
  onClose?: (code: number, reason: string) => void;
  log?: (msg: string) => void;
};

/**
 * A gateway connection that keeps itself alive: heartbeats at the interval
 * the server gives, and on any drop reconnects with backoff (1 s → 30 s)
 * and resumes from the last event handled, so nothing is missed.
 */
export class Gateway {
  private ws: WebSocket | null = null;
  private heartbeat: ReturnType<typeof setInterval> | null = null;
  private stopped = false;
  private backoff = 1000;
  private queue: Promise<void> = Promise.resolve();

  constructor(private readonly opts: GatewayOptions) {}

  start(): void {
    this.stopped = false;
    this.connect();
  }

  stop(): void {
    this.stopped = true;
    this.clearHeartbeat();
    this.ws?.close(1000, 'bye');
  }

  /** Resolves once every event received so far has been handled. */
  idle(): Promise<void> {
    return this.queue;
  }

  private connect(): void {
    const ws = new WebSocket(this.opts.url, {
      headers: { Authorization: `Bot ${this.opts.token}` },
    } as unknown as string[]);
    this.ws = ws;
    ws.onmessage = (m) => this.onFrame(JSON.parse(String(m.data)) as Frame);
    ws.onclose = (e) => {
      this.clearHeartbeat();
      this.opts.onClose?.(e.code, e.reason);
      if (this.stopped) return;
      // 4002 (bad intents) will not fix itself by retrying.
      if (e.code === 4002) {
        this.opts.log?.(`gateway refused the intents: ${e.reason}`);
        return;
      }
      const wait = this.backoff;
      this.backoff = Math.min(this.backoff * 2, 30_000);
      this.opts.log?.(`gateway closed (${e.code}); reconnecting in ${wait} ms`);
      setTimeout(() => !this.stopped && this.connect(), wait);
    };
  }

  private onFrame(f: Frame): void {
    switch (f.op) {
      case 'hello': {
        const interval = (f.d as { heartbeat_interval: number }).heartbeat_interval;
        this.send({ op: 'identify', d: { intents: this.opts.intents ?? [], resume_from: this.opts.resumeFrom?.() ?? 0 } });
        this.clearHeartbeat();
        this.heartbeat = setInterval(() => this.send({ op: 'heartbeat' }), interval);
        break;
      }
      case 'ready':
        this.backoff = 1000;
        this.opts.onReady?.();
        break;
      case 'dispatch': {
        const event = f.d as BotEvent;
        // One at a time, in order: handlers see events as they happened.
        this.queue = this.queue.then(async () => {
          try {
            await this.opts.onEvent(event);
          } catch (err) {
            this.opts.log?.(`handler failed for ${event.type}: ${String(err)}`);
          }
        });
        break;
      }
    }
  }

  private send(f: Frame): void {
    if (this.ws?.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify(f));
  }

  private clearHeartbeat(): void {
    if (this.heartbeat) clearInterval(this.heartbeat);
    this.heartbeat = null;
  }
}
