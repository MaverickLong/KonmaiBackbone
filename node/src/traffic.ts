import { createSocket, type Socket } from 'node:dgram';
import type { MikroORM } from '@mikro-orm/sqlite';
import type { TrafficBucket as ReportedBucket } from 'konmai-shared';
import { z } from 'zod';
import type { Config } from './config.js';
import { TrafficBucket } from './db/entities.js';
import type { Link } from './link.js';
import type { Logger } from './logger.js';

const flushIntervalMilliseconds = 30_000;
const retentionMilliseconds = 48 * 3_600_000;

const accessLogLine = z.object({
  uri: z.string(),
  status: z.number().int(),
  bytes: z.number().int().nonnegative(),
});

interface Delta {
  egressBytes: number;
  ingressBytes: number;
  requests: number;
}

export function hourStart(now: Date): Date {
  const start = new Date(now);
  start.setUTCMinutes(0, 0, 0);
  return start;
}

// nginx sends syslog datagrams like `<190>Sep  6 01:00:00 host konmai: {json}`; only the JSON
// part matters.
export function parseAccessLine(
  datagram: string,
): { uri: string; status: number; bytes: number } | null {
  const start = datagram.indexOf('{');
  if (start === -1) {
    return null;
  }
  try {
    const parsed = accessLogLine.safeParse(JSON.parse(datagram.slice(start)));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

export class TrafficMeter {
  private readonly pending = new Map<string, Delta>();
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
      this.delta().ingressBytes += bytes;
    }
  }

  ingest(datagram: string): void {
    const line = parseAccessLine(datagram);
    if (
      line === null ||
      !line.uri.startsWith('/files/') ||
      (line.status !== 200 && line.status !== 206)
    ) {
      return;
    }
    const delta = this.delta();
    delta.egressBytes += line.bytes;
    delta.requests += 1;
  }

  async flush(): Promise<void> {
    if (this.pending.size === 0) {
      return;
    }
    const entries = [...this.pending.entries()];
    this.pending.clear();
    const em = this.orm.em.fork();
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
    await em.flush();
  }

  async report(): Promise<void> {
    await this.flush();
    if (!this.link.connected) {
      return;
    }
    const em = this.orm.em.fork();
    await em.nativeDelete(TrafficBucket, {
      acknowledged: true,
      hourStart: { $lt: new Date(Date.now() - retentionMilliseconds) },
    });
    const buckets = await em.find(TrafficBucket, { acknowledged: false });
    if (buckets.length === 0) {
      return;
    }
    const payload: ReportedBucket[] = buckets.map((bucket) => ({
      hourStart: bucket.hourStart.toISOString(),
      egressBytes: bucket.egressBytes,
      ingressBytes: bucket.ingressBytes,
      requests: bucket.requests,
    }));
    this.link.send({ type: 'traffic', payload: { buckets: payload } });
  }

  async acknowledge(hourStarts: string[]): Promise<void> {
    const em = this.orm.em.fork();
    await em.nativeUpdate(
      TrafficBucket,
      { hourStart: { $in: hourStarts.map((value) => new Date(value)) } },
      { acknowledged: true },
    );
  }

  private delta(): Delta {
    const key = hourStart(new Date()).toISOString();
    let delta = this.pending.get(key);
    if (delta === undefined) {
      delta = { egressBytes: 0, ingressBytes: 0, requests: 0 };
      this.pending.set(key, delta);
    }
    return delta;
  }
}
