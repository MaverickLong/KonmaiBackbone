import { EventEmitter } from 'node:events';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { MikroORM } from '@mikro-orm/sqlite';
import type { NodeMessage } from 'konmai-shared';
import pino from 'pino';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { Config } from './config.js';
import { AddressBucket } from './db/entities.js';
import { openDatabase } from './db/orm.js';
import type { Link } from './link.js';
import { hourStart, parseAccessLine, TrafficMeter } from './traffic.js';

function line(fields: Record<string, unknown>): string {
  return `<190>Oct 30 01:00:00 node1 konmai: ${JSON.stringify({ t: 'x', rt: 0.1, ...fields })}`;
}

describe('parseAccessLine', () => {
  it('extracts bytes and the client address from a syslog datagram', () => {
    expect(
      parseAccessLine(line({ uri: '/files/a.apk', status: 206, bytes: 4096, ip: '203.0.113.9' })),
    ).toEqual({ bytes: 4096, address: '203.0.113.9' });
  });

  it('accepts lines from older log formats without an address', () => {
    expect(parseAccessLine(line({ uri: '/x', status: 200, bytes: 10 }))).toEqual({
      bytes: 10,
      address: null,
    });
  });

  it('rejects malformed lines', () => {
    expect(parseAccessLine('garbage')).toBeNull();
    expect(parseAccessLine('<1>x {"bytes":"many"}')).toBeNull();
  });
});

describe('hourStart', () => {
  it('truncates to the hour in UTC', () => {
    expect(hourStart(new Date('2026-09-06T01:59:59.999Z')).toISOString()).toBe(
      '2026-09-06T01:00:00.000Z',
    );
  });
});

class FakeLink extends EventEmitter {
  connected = true;
  messages: (Omit<NodeMessage, 'id'> & { id: string })[] = [];
  send(message: Omit<NodeMessage, 'id'>): string {
    const id = `report-${this.messages.length + 1}`;
    this.messages.push({ ...message, id } as Omit<NodeMessage, 'id'> & { id: string });
    return id;
  }
}

describe('TrafficMeter', () => {
  let directory: string;
  let orm: MikroORM;
  let link: FakeLink;
  let meter: TrafficMeter;
  const now = new Date('2026-10-30T03:15:00Z');

  beforeEach(async () => {
    directory = await mkdtemp(path.join(tmpdir(), 'konmai-traffic-'));
    orm = await openDatabase(path.join(directory, 'node.sqlite'));
    link = new FakeLink();
    meter = new TrafficMeter(
      { syslog: null, trafficReportMinutes: 5 } as Config,
      orm,
      link as unknown as Link,
      pino({ level: 'silent' }),
    );
  });

  afterEach(async () => {
    await orm.close();
    await rm(directory, { recursive: true, force: true });
  });

  function lastReport() {
    const message = link.messages.at(-1)!;
    if (message.type !== 'traffic') {
      throw new Error('expected a traffic report');
    }
    return { id: message.id, payload: message.payload };
  }

  it('counts every response, whatever its path or status', async () => {
    meter.ingest(
      line({ uri: '/files%2Fapp%2Fgp%2F1%2Fa.apk', status: 200, bytes: 1000, ip: '198.51.100.7' }),
      now,
    );
    meter.ingest(line({ uri: '/nope', status: 404, bytes: 150, ip: '198.51.100.7' }), now);
    meter.ingest(line({ uri: '/files/a.apk', status: 206, bytes: 500 }), now);
    meter.ingest('not json at all', now);
    await meter.report();

    const { payload } = lastReport();
    expect(payload.buckets).toEqual([
      { hourStart: '2026-10-30T03:00:00.000Z', egressBytes: 1650, ingressBytes: 0, requests: 3 },
    ]);
    expect(payload.addresses).toEqual([
      { day: '2026-10-30', address: '198.51.100.7', egressBytes: 1150, requests: 2 },
    ]);
  });

  it('re-sends an address whose traffic grew before the acknowledgement arrived', async () => {
    meter.ingest(line({ status: 200, bytes: 100, ip: '192.0.2.1' }), now);
    meter.ingest(line({ status: 200, bytes: 100, ip: '192.0.2.2' }), now);
    await meter.report();
    const first = lastReport();

    meter.ingest(line({ status: 200, bytes: 50, ip: '192.0.2.2' }), now);
    await meter.flush();
    await meter.acknowledge(first.id);

    const pending = await orm.em.fork().find(AddressBucket, { acknowledged: false });
    expect(pending.map((bucket) => [bucket.address, bucket.egressBytes])).toEqual([
      ['192.0.2.2', 150],
    ]);

    await meter.report();
    expect(lastReport().payload.addresses).toEqual([
      { day: '2026-10-30', address: '192.0.2.2', egressBytes: 150, requests: 2 },
    ]);
    await meter.acknowledge(lastReport().id);
    await meter.report();
    expect(link.messages).toHaveLength(2);
  });
});
