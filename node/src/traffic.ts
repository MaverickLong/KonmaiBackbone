import { createSocket, type Socket } from 'node:dgram';
import type { MikroORM } from '@mikro-orm/sqlite';
import type {
  AddressBucket as ReportedAddress,
  TrafficBucket as ReportedBucket,
} from 'konmai-shared';
import { z } from 'zod';
import type { Config } from './config.js';
import { AddressBucket, TrafficBucket } from './db/entities.js';
import type { Link } from './link.js';
import type { Logger } from './logger.js';

const flushIntervalMilliseconds = 30_000;
const retentionMilliseconds = 48 * 3_600_000;
// Keeps a single report frame reasonably small when a bot network spreads over many addresses;
// the rest goes out with the next report.
const addressBatchSize = 5_000;
const unacknowledgedReportLimit = 20;

// Every response nginx logs for the node's server block counts: the provider meters all of it,
// whatever the path, its encoding (e.g. %2F) or the status.
const accessLogLine = z.object({
  bytes: z.number().int().nonnegative(),
  ip: z.string().min(1).max(64).optional(),
});

export interface AccessLine {
  bytes: number;
  address: string | null;
}

interface Delta {
  egressBytes: number;
  ingressBytes: number;
  requests: number;
}

interface AddressDelta {
  day: string;
  address: string;
  egressBytes: number;
  requests: number;
}

interface SentReport {
  buckets: ReportedBucket[];
  addresses: ReportedAddress[];
}

export function hourStart(now: Date): Date {
  const start = new Date(now);
  start.setUTCMinutes(0, 0, 0);
  return start;
}

// nginx sends syslog datagrams like `<190>Sep  6 01:00:00 host konmai: {json}`; only the JSON
// part matters.
export function parseAccessLine(datagram: string): AccessLine | null {
  const start = datagram.indexOf('{');
  if (start === -1) {
    return null;
  }
  try {
    const parsed = accessLogLine.safeParse(JSON.parse(datagram.slice(start)));
    return parsed.success ? { bytes: parsed.data.bytes, address: parsed.data.ip ?? null } : null;
  } catch {
    return null;
  }
}

export class TrafficMeter {
  private readonly pending = new Map<string, Delta>();
  private readonly pendingAddresses = new Map<string, AddressDelta>();
  // Reports waiting for the host's acknowledgement, by message id.
  private readonly sent = new Map<string, SentReport>();
  private droppedLines = 0;
  private socket: Socket | null = null;
  private flushTimer: NodeJS.Timeout | null = null;
  private reportTimer: NodeJS.Timeout | null = null;

  constructor(
    private readonly config: Config,
    private readonly orm: MikroORM,
    private readonly link: Link,
    private readonly logger: Logger,
  ) {}

  start(): void {
    if (this.config.syslog !== null) {
      this.socket = createSocket('udp4');
      this.socket.on('message', (message) => this.ingest(message.toString()));
      this.socket.on('error', (error) => this.logger.error({ error }, 'syslog socket error'));
      this.socket.bind(this.config.syslog.port, this.config.syslog.host, () => {
        this.logger.info(this.config.syslog, 'listening for nginx access log');
      });
    }
    this.flushTimer = setInterval(() => void this.flush(), flushIntervalMilliseconds);
    this.reportTimer = setInterval(
      () => void this.report(),
      this.config.trafficReportMinutes * 60_000,
    );
    this.link.on('disconnected', () => this.sent.clear());
  }

  async stop(): Promise<void> {
    if (this.flushTimer !== null) {
      clearInterval(this.flushTimer);
    }
    if (this.reportTimer !== null) {
      clearInterval(this.reportTimer);
    }
    this.socket?.close();
    await this.flush();
  }

  addIngress(bytes: number): void {
    if (bytes > 0) {
      this.delta(new Date()).ingressBytes += bytes;
    }
  }

  ingest(datagram: string, now = new Date()): void {
    const line = parseAccessLine(datagram);
    if (line === null) {
      this.droppedLines++;
      return;
    }
    const delta = this.delta(now);
    delta.egressBytes += line.bytes;
    delta.requests += 1;
    if (line.address !== null) {
      const day = now.toISOString().slice(0, 10);
      const key = `${day}|${line.address}`;
      const addressDelta = this.pendingAddresses.get(key) ?? {
        day,
        address: line.address,
        egressBytes: 0,
        requests: 0,
      };
      addressDelta.egressBytes += line.bytes;
      addressDelta.requests += 1;
      this.pendingAddresses.set(key, addressDelta);
    }
  }

  async flush(): Promise<void> {
    if (this.droppedLines > 0) {
      this.logger.warn(
        { lines: this.droppedLines },
        'ignored access log lines that are not konmai_json; check the nginx log_format',
      );
      this.droppedLines = 0;
    }
    const entries = [...this.pending.entries()];
    const addresses = [...this.pendingAddresses.values()];
    this.pending.clear();
    this.pendingAddresses.clear();
    if (entries.length === 0 && addresses.length === 0) {
      return;
    }
    await this.orm.em.fork().transactional(async (em) => {
      for (const [key, delta] of entries) {
        const start = new Date(key);
        const bucket = await em.findOne(TrafficBucket, { hourStart: start });
        if (bucket === null) {
          em.create(TrafficBucket, { hourStart: start, ...delta, acknowledged: false });
        } else {
          bucket.egressBytes += delta.egressBytes;
          bucket.ingressBytes += delta.ingressBytes;
          bucket.requests += delta.requests;
          bucket.acknowledged = false;
        }
      }
      // A bot network can produce thousands of addresses per flush, so they are added up in SQL
      // instead of loading each row.
      for (const delta of addresses) {
        await em.execute(
          `insert into address_bucket (day, address, egress_bytes, requests, acknowledged)
           values (?, ?, ?, ?, 0)
           on conflict (day, address) do update set
             egress_bytes = egress_bytes + excluded.egress_bytes,
             requests = requests + excluded.requests,
             acknowledged = 0`,
          [delta.day, delta.address, delta.egressBytes, delta.requests],
          'run',
        );
      }
    });
  }

  async report(): Promise<void> {
    await this.flush();
    if (!this.link.connected) {
      return;
    }
    const em = this.orm.em.fork();
    const cutoff = new Date(Date.now() - retentionMilliseconds);
    await em.nativeDelete(TrafficBucket, { acknowledged: true, hourStart: { $lt: cutoff } });
    await em.nativeDelete(AddressBucket, {
      acknowledged: true,
      day: { $lt: cutoff.toISOString().slice(0, 10) },
    });
    const buckets = await em.find(TrafficBucket, { acknowledged: false });
    const addresses = await em.find(
      AddressBucket,
      { acknowledged: false },
      { orderBy: { day: 'asc', address: 'asc' }, limit: addressBatchSize },
    );
    if (buckets.length === 0 && addresses.length === 0) {
      return;
    }
    const report: SentReport = {
      buckets: buckets.map((bucket) => ({
        hourStart: bucket.hourStart.toISOString(),
        egressBytes: bucket.egressBytes,
        ingressBytes: bucket.ingressBytes,
        requests: bucket.requests,
      })),
      addresses: addresses.map((bucket) => ({
        day: bucket.day,
        address: bucket.address,
        egressBytes: bucket.egressBytes,
        requests: bucket.requests,
      })),
    };
    const id = this.link.send({ type: 'traffic', payload: report });
    this.sent.set(id, report);
    for (const key of [...this.sent.keys()].slice(0, -unacknowledgedReportLimit)) {
      this.sent.delete(key);
    }
  }

  // Marks rows as delivered only if they did not change after being sent; a row that grew in
  // the meantime stays unacknowledged and goes out again with its new totals.
  async acknowledge(reportId: string | undefined): Promise<void> {
    const report = reportId === undefined ? undefined : this.sent.get(reportId);
    if (report === undefined) {
      return;
    }
    this.sent.delete(reportId!);
    await this.orm.em.fork().transactional(async (em) => {
      for (const bucket of report.buckets) {
        await em.nativeUpdate(
          TrafficBucket,
          {
            hourStart: new Date(bucket.hourStart),
            egressBytes: bucket.egressBytes,
            ingressBytes: bucket.ingressBytes,
            requests: bucket.requests,
          },
          { acknowledged: true },
        );
      }
      for (const bucket of report.addresses) {
        await em.execute(
          `update address_bucket set acknowledged = 1
           where day = ? and address = ? and egress_bytes = ? and requests = ?`,
          [bucket.day, bucket.address, bucket.egressBytes, bucket.requests],
          'run',
        );
      }
    });
  }

  private delta(now: Date): Delta {
    const key = hourStart(now).toISOString();
    let delta = this.pending.get(key);
    if (delta === undefined) {
      delta = { egressBytes: 0, ingressBytes: 0, requests: 0 };
      this.pending.set(key, delta);
    }
    return delta;
  }
}
