import { randomUUID } from 'node:crypto';
import type { IncomingMessage, Server } from 'node:http';
import type { Duplex } from 'node:stream';
import {
  hostMessage,
  nodeMessage,
  protocolHeader,
  protocolVersion,
  type HostMessage,
} from 'konmai-shared';
import { WebSocketServer, type WebSocket } from 'ws';
import { catalogueEvents } from '../catalogue/lifecycle.js';
import { HealthEvent, Node } from '../db/entities.js';
import type { EntityManager } from '../db/orm.js';
import { bearerToken } from '../http/auth.js';
import { hashToken } from '../http/admin/nodes.js';
import type { Context } from '../http/context.js';
import { catalogueSnapshot, manifestFor } from './manifest.js';
import { applyInventory, applyStorage, applySyncResult, applyTraffic } from './reports.js';

export const gatewayPath = '/api/nodes/ws';
const pingIntervalMilliseconds = 30_000;
const maxMissedPongs = 2;

interface Connection {
  nodeId: number;
  socket: WebSocket;
  missedPongs: number;
}

export class Gateway {
  private readonly server = new WebSocketServer({ noServer: true });
  private readonly connections = new Map<number, Connection>();
  private readonly pinger: NodeJS.Timeout;

  constructor(
    private readonly context: Context,
    httpServer: Server,
  ) {
    httpServer.on('upgrade', (request, socket, head) => void this.upgrade(request, socket, head));
    this.pinger = setInterval(() => this.pingAll(), pingIntervalMilliseconds);
    catalogueEvents.on('changed', () => void this.broadcastManifest());
  }

  isConnected(nodeId: number): boolean {
    return this.connections.has(nodeId);
  }

  connectedNodeIds(): number[] {
    return [...this.connections.keys()];
  }

  async resync(nodeId: number): Promise<boolean> {
    const connection = this.connections.get(nodeId);
    if (connection === undefined) {
      return false;
    }
    this.send(connection, { type: 'resync', id: randomUUID(), payload: {} });
    return true;
  }

  disconnect(nodeId: number, reason = 'disconnected by host'): void {
    const connection = this.connections.get(nodeId);
    if (connection === undefined) {
      return;
    }
    this.send(connection, {
      type: 'error',
      id: randomUUID(),
      payload: { code: 'CLOSED', message: reason },
    });
    connection.socket.close(4000, reason);
  }

  async broadcastManifest(): Promise<void> {
    if (this.connections.size === 0) {
      return;
    }
    const em = this.context.orm.em.fork();
    try {
      const snapshot = await catalogueSnapshot(em);
      const nodes = await em.find(Node, { id: { $in: this.connectedNodeIds() } });
      for (const node of nodes) {
        const connection = this.connections.get(node.id);
        if (connection !== undefined) {
          this.send(connection, {
            type: 'manifest',
            id: randomUUID(),
            payload: manifestFor(this.context.config, node, snapshot),
          });
        }
      }
    } catch (error) {
      this.context.logger.error({ error }, 'broadcasting manifest failed');
    }
  }

  close(): void {
    clearInterval(this.pinger);
    for (const connection of this.connections.values()) {
      connection.socket.close(1001, 'host shutting down');
    }
    this.server.close();
  }

  private async upgrade(request: IncomingMessage, socket: Duplex, head: Buffer): Promise<void> {
    const url = new URL(request.url ?? '/', 'http://localhost');
    if (url.pathname !== gatewayPath) {
      socket.destroy();
      return;
    }
    const reject = (status: number, message: string): void => {
      socket.write(`HTTP/1.1 ${status} ${message}\r\nConnection: close\r\n\r\n`);
      socket.destroy();
    };
    const version = Number(request.headers[protocolHeader] ?? '0');
    if (version !== protocolVersion) {
      reject(426, 'Upgrade Required');
      return;
    }
    const token = bearerToken(request.headers.authorization);
    if (token === null) {
      reject(401, 'Unauthorized');
      return;
    }
    const em = this.context.orm.em.fork();
    const node = await em.findOne(Node, { tokenHash: hashToken(token), enabled: true });
    if (node === null) {
      reject(401, 'Unauthorized');
      return;
    }
    this.server.handleUpgrade(request, socket, head, (webSocket) => {
      void this.accept(webSocket, node.id);
    });
  }

  private async accept(socket: WebSocket, nodeId: number): Promise<void> {
    const previous = this.connections.get(nodeId);
    if (previous !== undefined) {
      previous.socket.close(4001, 'replaced by a newer connection');
      this.connections.delete(nodeId);
    }
    const connection: Connection = { nodeId, socket, missedPongs: 0 };
    this.connections.set(nodeId, connection);
    this.context.logger.info({ nodeId }, 'node agent connected');

    socket.on('pong', () => {
      connection.missedPongs = 0;
    });
    socket.on('message', (data) => void this.receive(connection, data.toString()));
    socket.on('close', () => void this.closed(connection));
    socket.on('error', (error) => this.context.logger.warn({ nodeId, error }, 'node socket error'));

    await this.withNode(nodeId, async (em, node) => {
      node.agentConnected = true;
      em.create(HealthEvent, {
        node,
        at: new Date(),
        kind: 'agent_connected',
        detail: null,
        emailSent: false,
      });
      await em.flush();
      const snapshot = await catalogueSnapshot(em);
      this.send(connection, {
        type: 'manifest',
        id: randomUUID(),
        payload: manifestFor(this.context.config, node, snapshot),
      });
    });
  }

  private async closed(connection: Connection): Promise<void> {
    if (this.connections.get(connection.nodeId) !== connection) {
      return;
    }
    this.connections.delete(connection.nodeId);
    this.context.logger.info({ nodeId: connection.nodeId }, 'node agent disconnected');
    await this.withNode(connection.nodeId, async (em, node) => {
      node.agentConnected = false;
      em.create(HealthEvent, {
        node,
        at: new Date(),
        kind: 'agent_disconnected',
        detail: null,
        emailSent: false,
      });
      await em.flush();
    });
  }

  private async receive(connection: Connection, raw: string): Promise<void> {
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      this.context.logger.warn({ nodeId: connection.nodeId }, 'dropping non-JSON frame');
      return;
    }
    const result = nodeMessage.safeParse(parsed);
    if (!result.success) {
      this.context.logger.warn(
        { nodeId: connection.nodeId, issues: result.error.issues },
        'dropping invalid message',
      );
      return;
    }
    const message = result.data;
    await this.withNode(connection.nodeId, async (em, node) => {
      switch (message.type) {
        case 'hello':
          node.agentVersion = message.payload.agentVersion;
          await applyStorage(em, node, message.payload.storage);
          break;
        case 'storage':
          await applyStorage(em, node, message.payload);
          break;
        case 'inventory': {
          const counts = await applyInventory(em, node, message.payload.files);
          this.context.logger.info({ nodeId: node.id, ...counts }, 'inventory applied');
          const snapshot = await catalogueSnapshot(em);
          this.send(connection, {
            type: 'manifest',
            id: randomUUID(),
            replyTo: message.id,
            payload: manifestFor(this.context.config, node, snapshot),
          });
          break;
        }
        case 'traffic': {
          const hourStarts = await applyTraffic(em, node, message.payload.buckets);
          this.send(connection, {
            type: 'ack',
            id: randomUUID(),
            replyTo: message.id,
            payload: { hourStarts },
          });
          break;
        }
        case 'syncResult':
          await applySyncResult(em, node, message.payload);
          break;
        case 'log':
          this.context.logger[message.payload.level](
            { nodeId: node.id },
            `node: ${message.payload.message}`,
          );
          break;
      }
    });
  }

  private async withNode(
    nodeId: number,
    work: (em: EntityManager, node: Node) => Promise<void>,
  ): Promise<void> {
    const em = this.context.orm.em.fork();
    try {
      const node = await em.findOne(Node, { id: nodeId });
      if (node === null) {
        this.disconnect(nodeId, 'node removed');
        return;
      }
      await work(em, node);
    } catch (error) {
      this.context.logger.error({ nodeId, error }, 'handling node message failed');
    }
  }

  private send(connection: Connection, message: HostMessage): void {
    if (connection.socket.readyState !== connection.socket.OPEN) {
      return;
    }
    connection.socket.send(JSON.stringify(hostMessage.parse(message)));
  }

  private pingAll(): void {
    for (const connection of this.connections.values()) {
      if (connection.missedPongs >= maxMissedPongs) {
        this.context.logger.warn(
          { nodeId: connection.nodeId },
          'node agent stopped answering pings',
        );
        connection.socket.terminate();
        continue;
      }
      connection.missedPongs++;
      connection.socket.ping();
    }
  }
}
