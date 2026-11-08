import { mkdtemp, rm } from 'node:fs/promises';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';
import type { MikroORM } from '@mikro-orm/sqlite';
import { protocolHeader, protocolVersion } from 'konmai-shared';
import pino from 'pino';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import WebSocket from 'ws';
import { Store } from '../catalogue/store.js';
import type { Config } from '../config.js';
import { HealthEvent, Node } from '../db/entities.js';
import { openDatabase } from '../db/orm.js';
import { hashToken } from '../http/admin/nodes.js';
import type { Context } from '../http/context.js';
import { Gateway } from './gateway.js';

const token = 'node-token-for-tests';

async function waitFor(condition: () => Promise<boolean> | boolean): Promise<void> {
  for (let attempt = 0; attempt < 100; attempt++) {
    if (await condition()) {
      return;
    }
    await sleep(20);
  }
  throw new Error('condition not met in time');
}

describe('Gateway', () => {
  let directory: string;
  let orm: MikroORM;
  let context: Context;
  let server: Server;
  let gateway: Gateway;
  let port: number;
  let nodeId: number;

  beforeEach(async () => {
    directory = await mkdtemp(path.join(tmpdir(), 'konmai-gateway-'));
    orm = await openDatabase(path.join(directory, 'host.sqlite'));
    const em = orm.em.fork();
    const node = em.create(Node, {
      name: 'node',
      domain: 'node.example.com',
      countries: [],
      allowedVariants: [],
      monthlyQuotaBytes: 1_000,
      quotaResetDay: 1,
      status: 'unknown',
      agentVersion: null,
      lastHealthyAt: null,
      lastFailureAt: null,
      lastFailureReason: null,
      usageAdjustmentPeriodStart: null,
      tokenHash: hashToken(token),
      storageTotalBytes: null,
      storageFreeBytes: null,
    });
    await em.flush();
    nodeId = node.id;
    context = {
      config: { deepVerifyCron: '0 4 * * 0' } as Config,
      orm,
      store: new Store(directory),
      logger: pino({ level: 'silent' }),
    };
    server = createServer();
    gateway = new Gateway(context, server);
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    port = (server.address() as AddressInfo).port;
  });

  afterEach(async () => {
    gateway.close();
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await orm.close();
    await rm(directory, { recursive: true, force: true });
  });

  function connect(): Promise<WebSocket> {
    const socket = new WebSocket(`ws://127.0.0.1:${port}/api/nodes/ws`, {
      headers: { authorization: `Bearer ${token}`, [protocolHeader]: String(protocolVersion) },
    });
    return new Promise((resolve, reject) => {
      socket.once('message', () => resolve(socket));
      socket.once('error', reject);
    });
  }

  async function agentEvents(): Promise<string[]> {
    const events = await orm.em
      .fork()
      .find(
        HealthEvent,
        { node: nodeId, kind: { $in: ['agent_connected', 'agent_disconnected'] } },
        { orderBy: { at: 'asc', id: 'asc' } },
      );
    return events.map((event) => event.kind);
  }

  it('tracks a session in memory and records both ends of it', async () => {
    const socket = await connect();
    expect(gateway.isConnected(nodeId)).toBe(true);
    expect(gateway.connectedNodeIds()).toEqual([nodeId]);
    expect(await agentEvents()).toEqual(['agent_connected']);

    socket.close(1000, 'test over');
    await waitFor(async () => (await agentEvents()).length === 2);
    expect(gateway.isConnected(nodeId)).toBe(false);
    expect(await agentEvents()).toEqual(['agent_connected', 'agent_disconnected']);
  });

  it('records the disconnect of a session the host could not close cleanly', async () => {
    const socket = await connect();
    const closed = new Promise<number>((resolve) => socket.once('close', resolve));
    gateway.close();
    expect(gateway.connectedNodeIds()).toEqual([]);
    expect(await closed).toBe(1001);
    await sleep(100);
    expect(await agentEvents()).toEqual(['agent_connected']);

    await gateway.recordMissedDisconnects();
    expect(await agentEvents()).toEqual(['agent_connected', 'agent_disconnected']);
    const latest = await orm.em
      .fork()
      .findOne(HealthEvent, { node: nodeId }, { orderBy: { at: 'desc', id: 'desc' } });
    expect(latest?.detail).toBe('connection lost when the host stopped');

    await gateway.recordMissedDisconnects();
    expect(await agentEvents()).toEqual(['agent_connected', 'agent_disconnected']);
  });
});
