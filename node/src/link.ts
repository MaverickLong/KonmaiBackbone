import { EventEmitter } from 'node:events';
import { randomUUID } from 'node:crypto';
import {
  hostMessage,
  protocolHeader,
  protocolVersion,
  type HostMessage,
  type NodeMessage,
} from 'konmai-shared';
import WebSocket from 'ws';
import type { Config } from './config.js';
import type { Logger } from './logger.js';

const minimumBackoffMilliseconds = 1_000;
const maximumBackoffMilliseconds = 60_000;
// The host pings every 30 s; three missed pings means the connection is dead.
const silenceLimitMilliseconds = 90_000;

type LinkEvents = {
  connected: [];
  disconnected: [];
  message: [HostMessage];
};

export class Link extends EventEmitter<LinkEvents> {
  private socket: WebSocket | null = null;
  private backoff = minimumBackoffMilliseconds;
  private stopped = false;
  private silenceTimer: NodeJS.Timeout | null = null;

  constructor(
    private readonly config: Config,
    private readonly logger: Logger,
  ) {
    super();
  }

  get connected(): boolean {
    return this.socket?.readyState === WebSocket.OPEN;
  }

  start(): void {
    this.stopped = false;
    this.connect();
  }

  stop(): void {
    this.stopped = true;
    this.socket?.close(1000, 'agent stopping');
  }

  send(message: Omit<NodeMessage, 'id'> & { id?: string }): string {
    const id = message.id ?? randomUUID();
    if (this.socket?.readyState === WebSocket.OPEN) {
      this.socket.send(JSON.stringify({ ...message, id }));
    }
    return id;
  }

  private connect(): void {
    const url = this.config.hostUrl.replace(/^http/, 'ws') + '/api/nodes/ws';
    const socket = new WebSocket(url, {
      headers: {
        authorization: `Bearer ${this.config.token}`,
        [protocolHeader]: String(protocolVersion),
      },
    });
    this.socket = socket;

    socket.on('open', () => {
      this.logger.info({ url }, 'connected to host');
      this.backoff = minimumBackoffMilliseconds;
      this.touch();
      this.emit('connected');
    });
    socket.on('ping', () => this.touch());
    socket.on('message', (data) => {
      this.touch();
      let parsed: unknown;
      try {
        parsed = JSON.parse(data.toString());
      } catch {
        this.logger.warn('dropping non-JSON frame from host');
        return;
      }
      const result = hostMessage.safeParse(parsed);
      if (!result.success) {
        this.logger.warn({ issues: result.error.issues }, 'dropping invalid message from host');
        return;
      }
      this.emit('message', result.data);
    });
    socket.on('unexpected-response', (_request, response) => {
      this.logger.error({ status: response.statusCode }, 'host rejected the connection');
    });
    socket.on('error', (error) => this.logger.warn({ error: error.message }, 'socket error'));
    socket.on('close', (code, reason) => {
      this.clearSilenceTimer();
      this.logger.info({ code, reason: reason.toString() }, 'disconnected from host');
      this.emit('disconnected');
      if (!this.stopped) {
        this.scheduleReconnect();
      }
    });
  }

  private scheduleReconnect(): void {
    const jitter = Math.random() * this.backoff;
    setTimeout(() => this.connect(), jitter);
    this.backoff = Math.min(this.backoff * 2, maximumBackoffMilliseconds);
  }

  private touch(): void {
    this.clearSilenceTimer();
    this.silenceTimer = setTimeout(() => {
      this.logger.warn('no traffic from host, reconnecting');
      this.socket?.terminate();
    }, silenceLimitMilliseconds);
  }

  private clearSilenceTimer(): void {
    if (this.silenceTimer !== null) {
      clearTimeout(this.silenceTimer);
      this.silenceTimer = null;
    }
  }
}
