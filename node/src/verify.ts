import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { setTimeout as sleep } from 'node:timers/promises';
import type { MikroORM } from '@mikro-orm/sqlite';
import { Cron } from 'croner';
import { LocalFile } from './db/entities.js';
import type { Logger } from './logger.js';
import type { Reconciler } from './reconcile.js';
import type { Storage } from './storage.js';

// Roughly 50 MB/s: 1 MiB chunks with a 20 ms pause between them.
const chunkBytes = 1_048_576;
const pauseMilliseconds = 20;

export async function hashThrottled(filePath: string): Promise<string> {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(filePath, { highWaterMark: chunkBytes })) {
    hash.update(chunk as Buffer);
    await sleep(pauseMilliseconds);
  }
  return hash.digest('hex');
}

export class DeepVerifier {
  private job: Cron | null = null;
  private running = false;

  constructor(
    private readonly orm: MikroORM,
    private readonly storage: Storage,
    private readonly reconciler: Reconciler,
    private readonly logger: Logger,
  ) {}

  schedule(cronExpression: string): void {
    if (this.job?.getPattern() === cronExpression) {
      return;
    }
    this.job?.stop();
    try {
      this.job = new Cron(cronExpression, () => void this.run());
      this.logger.info({ cronExpression }, 'deep verification scheduled');
    } catch (error) {
      this.logger.error({ error, cronExpression }, 'invalid deep verification schedule');
    }
  }

  stop(): void {
    this.job?.stop();
  }

  async run(): Promise<void> {
    if (this.running) {
      return;
    }
    this.running = true;
    let mismatches = 0;
    try {
      const em = this.orm.em.fork();
      for (const file of await em.find(LocalFile, {})) {
        const actual = await hashThrottled(this.storage.filePath(file)).catch(() => null);
        if (actual === file.sha256) {
          file.verifiedAt = new Date();
          continue;
        }
        mismatches++;
        this.logger.warn({ ...file, actual }, 'deep verification mismatch, deleting file');
        await this.storage.deleteFile(file);
        em.remove(file);
      }
      await em.flush();
      this.logger.info({ mismatches }, 'deep verification finished');
      if (mismatches > 0) {
        await this.reconciler.run();
      }
    } catch (error) {
      this.logger.error({ error }, 'deep verification failed');
    } finally {
      this.running = false;
    }
  }
}
