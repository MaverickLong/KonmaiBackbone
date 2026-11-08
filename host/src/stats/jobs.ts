import { Cron } from 'croner';
import { deleteMarkedReleases, expireRetained, moveRelease } from '../catalogue/lifecycle.js';
import { AddressTraffic, Download, Release, Traffic } from '../db/entities.js';
import type { EntityManager } from '../db/orm.js';
import type { Context } from '../http/context.js';
import { loadSettings } from '../settings.js';
import { addressRetentionDays, dayOf, rawDownloadCutoff } from '../http/admin/stats.js';

const dayMilliseconds = 86_400_000;
const trafficRetentionDays = 400;
const ingestTimeoutMilliseconds = 3_600_000;

// Collapses raw download rows of completed days into `DownloadSummary` and drops raw rows older
// than the retention window. Re-running is safe: every day still held raw is recomputed from
// scratch. Returns the number of summary rows written.
export async function rollUpDownloads(em: EntityManager, now = new Date()): Promise<number> {
  const todayStart = new Date(`${dayOf(now)}T00:00:00Z`);
  // `??` travels as a parameter because the query layer would read it as a placeholder.
  const written = await em.execute<{ affectedRows: number }>(
    `insert into download_summary (day, variant_id, node_id, country, count)
     select date(d.at / 1000, 'unixepoch'), r.variant_id, coalesce(d.node_id, 0),
            coalesce(d.country, ?), count(*)
       from download d
       join release_file f on f.id = d.file_id
       join release r on r.id = f.release_id
      where d.at < ? group by 1, 2, 3, 4
     on conflict (day, variant_id, node_id, country) do update set count = excluded.count`,
    ['??', todayStart],
    'run',
  );
  await em.nativeDelete(Download, { at: { $lt: rawDownloadCutoff(now) } });
  await em.nativeDelete(Traffic, {
    hourStart: { $lt: new Date(now.getTime() - trafficRetentionDays * dayMilliseconds) },
  });
  await em.nativeDelete(AddressTraffic, {
    day: { $lt: dayOf(new Date(now.getTime() - addressRetentionDays * dayMilliseconds)) },
  });
  return written.affectedRows;
}

// Removes releases whose ingest never finished and store directories no release refers to.
export async function sweepOrphans(context: Context, em: EntityManager): Promise<void> {
  const stuck = await em.find(Release, {
    state: 'ingesting',
    createdAt: { $lt: new Date(Date.now() - ingestTimeoutMilliseconds) },
  });
  for (const release of stuck) {
    moveRelease(release, 'deleting');
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
      new Cron(
        '* * * * *',
        { timezone: 'UTC' },
        () =>
          void this.run('retention', async (em) =>
            expireRetained(
              em,
              this.context.store,
              this.context.logger,
              (await loadSettings(em)).retainedGraceMinutes,
            ),
          ),
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
      // The retention sweep runs every minute and usually finds nothing; only work gets a line.
      if (result !== 0) {
        this.context.logger.info({ job: name, result }, 'job finished');
      }
    } catch (error) {
      this.context.logger.error({ job: name, error }, 'job failed');
    }
  }
}
