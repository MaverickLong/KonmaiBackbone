import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { setTimeout as sleep } from 'node:timers/promises';
import pino from 'pino';
import { afterEach, describe, expect, it } from 'vitest';
import { WebSocketServer } from 'ws';
import type { Config } from './config.js';
import { Link } from './link.js';

const rejection = 'HTTP/1.1 502 Bad Gateway\r\nConnection: close\r\n\r\n';

async function listen(server: Server): Promise<number> {
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  return (server.address() as AddressInfo).port;
}

describe('Link', () => {
  let server: Server;
  let link: Link;

  afterEach(async () => {
    link.stop();
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  it('keeps retrying after the host rejects the upgrade, as nginx does during a restart', async () => {
    const sockets = new WebSocketServer({ noServer: true });
    let attempts = 0;
    server = createServer();
    server.on('upgrade', (request, socket, head) => {
      attempts++;
      if (attempts < 3) {
        socket.write(rejection);
        socket.destroy();
        return;
      }
      sockets.handleUpgrade(request, socket, head, (accepted) => {
        accepted.send(JSON.stringify({ type: 'resync', id: 'r1', payload: {} }));
      });
    });
    const port = await listen(server);
    link = new Link(
      { hostUrl: `http://127.0.0.1:${port}`, token: 'secret-token-1234' } as Config,
      pino({ level: 'silent' }),
    );
    const connected = new Promise<void>((resolve) => link.once('connected', resolve));
    const message = new Promise((resolve) => link.once('message', resolve));
    link.start();
    await connected;
    expect(attempts).toBe(3);
    expect(link.connected).toBe(true);
    await expect(message).resolves.toMatchObject({ type: 'resync' });
  }, 15_000);

  it('does not reconnect once stopped', async () => {
    let attempts = 0;
    let firstAttempt!: () => void;
    const attempted = new Promise<void>((resolve) => {
      firstAttempt = resolve;
    });
    server = createServer();
    server.on('upgrade', (_request, socket) => {
      attempts++;
      socket.write(rejection);
      socket.destroy();
      firstAttempt();
    });
    const port = await listen(server);
    link = new Link(
      { hostUrl: `http://127.0.0.1:${port}`, token: 'secret-token-1234' } as Config,
      pino({ level: 'silent' }),
    );
    link.start();
    await attempted;
    link.stop();
    await sleep(1_500);
    expect(attempts).toBe(1);
    expect(link.connected).toBe(false);
  });
});
