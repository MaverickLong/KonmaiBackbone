import { Cron } from 'croner';
import { deleteMarkedReleases } from '../catalogue/lifecycle.js';
import { Download, DownloadSummary, Release, Traffic } from '../db/entities.js';
import type { EntityManager } from '../db/orm.js';
import type { Context } from '../http/context.js';
import { rawDownloadRetentionDays } from '../http/admin/stats.js';

const dayMilliseconds = 86_400_000;
const trafficRetentionDays = 400;
const ingestTimeoutMilliseconds = 3_600_000;

// Collapses raw download rows of completed days into `DownloadSummary` and drops raw rows older
// than the retention window. Re-running is safe: every day in range is recomputed from scratch.
export async function rollUpDownloads(em: EntityManager, now = new Date()): Promise<number> {
  const todayStart = new Date(`${now.toISOString().slice(0, 10)}T00:00:00Z`);
  const cutoff = new Date(now.getTime() - rawDownloadRetentionDays * dayMilliseconds);
  const downloads = await em.find(
    Download,
    { at: { $lt: todayStart } },
    { populate: ['file', 'file.release'] },
  );
  const counts = new Map<
    string,
    { day: string; variant: number; nodeId: number; country: string; count: number }
  >();
  for (const download of downloads) {
    const row = {
      day: download.at.toISOString().slice(0, 10),
      variant: download.file.release.variant.id,
      nodeId: download.node?.id ?? 0,
      country: download.country ?? '??',
    };
    const key = `${row.day}|${row.variant}|${row.nodeId}|${row.country}`;
    const existing = counts.get(key);
    if (existing === undefined) {
      counts.set(key, { ...row, count: 1 });
    } else {
      existing.count++;
    }
  }
  if (counts.size > 0) {
    await em.upsertMany(DownloadSummary, [...counts.values()]);
  }
  await em.nativeDelete(Download, { at: { $lt: cutoff } });
  await em.nativeDelete(Traffic, {
    hourStart: { $lt: new Date(now.getTime() - trafficRetentionDays * dayMilliseconds) },
  });
  return counts.size;
}

// Removes releases whose ingest never finished and store directories no release refers to.
export async function sweepOrphans(context: Context, em: EntityManager): Promise<void> {
  const stuck = await em.find(Release, {
    state: 'ingesting',
    createdAt: { $lt: new Date(Date.now() - ingestTimeoutMilliseconds) },
  });
  for (const release of stuck) {
    release.state = 'deleting';
  }
  await em.flush();
  await deleteMarkedReleases(em, context.store, context.logger);

  const known = new Set(
    (await em.find(Release, {}, { populate: ['variant', 'variant.app'] })).map(
      (release) => `${release.variant.app.packageName}/${release.variant.slug}/${release.version}`,
    ),
  );
  for (const locator of await context.store.listStoredReleases()) {
    const key = `${locator.packageName}/${locator.variant}/${locator.version}`;
    if (!known.has(key)) {
      context.logger.warn(locator, 'deleting orphaned release directory');
      await context.store.deleteRelease(locator);
    }
  }
}

export class Jobs {
  private readonly jobs: Cron[] = [];

  constructor(private readonly context: Context) {}

  start(): void {
    this.jobs.push(
      new Cron(
        '10 0 * * *',
        { timezone: 'UTC' },
        () => void this.run('roll-up', (em) => rollUpDownloads(em)),
      ),
      new Cron(
        '30 0 * * *',
        { timezone: 'UTC' },
        () => void this.run('orphan sweep', (em) => sweepOrphans(this.context, em)),
      ),
    );
  }

  stop(): void {
    for (const job of this.jobs) {
      job.stop();
    }
  }

  private async run(name: string, work: (em: EntityManager) => Promise<unknown>): Promise<void> {
    const em = this.context.orm.em.fork();
    try {
      const result = await work(em);
      this.context.logger.info({ job: name, result }, 'job finished');
    } catch (error) {
      this.context.logger.error({ job: name, error }, 'job failed');
    }
  }
}
