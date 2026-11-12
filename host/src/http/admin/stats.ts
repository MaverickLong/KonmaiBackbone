import { Router } from 'express';
import {
  addressStatsQuery,
  downloadStatsQuery,
  eventsQuery,
  trafficStatsQuery,
  type AddressStatsRow,
  type AddressStatsView,
  type DownloadStatsRow,
  type DownloaderView,
  type OverviewView,
  type TrafficStatsRow,
} from 'konmai-shared';
import {
  App,
  Download,
  DownloadSummary,
  HealthEvent,
  Node,
  Release,
  SyncEvent,
  Variant,
} from '../../db/entities.js';
import type { EntityManager } from '../../db/orm.js';
import { healthEventView, syncEventView } from '../../views.js';
import type { Context } from '../context.js';
import { parse } from '../errors.js';
import { downloaderState } from '../ingest.js';

const dayMilliseconds = 86_400_000;
export const rawDownloadRetentionDays = 90;
// Client addresses are personal data, so they are kept no longer than needed to spot abuse.
export const addressRetentionDays = 90;

export function dayOf(date: Date): string {
  return date.toISOString().slice(0, 10);
}

// Raw download rows older than this exist only in the daily roll-up. It sits on a UTC midnight so
// that no day is split between the two.
export function rawDownloadCutoff(now: Date): Date {
  const day = dayOf(new Date(now.getTime() - rawDownloadRetentionDays * dayMilliseconds));
  return new Date(`${day}T00:00:00Z`);
}

// A downloader that has not reported for this long is shown as offline instead of the phase its
// last heartbeat carried; one large download can take a few minutes without a heartbeat.
const downloaderOfflineAfterMilliseconds = 10 * 60_000;

export function downloaderView(
  state: Awaited<ReturnType<typeof downloaderState>>,
  now = new Date(),
): DownloaderView {
  const offline =
    !state.lastSeenAt ||
    now.getTime() - state.lastSeenAt.getTime() > downloaderOfflineAfterMilliseconds;
  return {
    lastSeenAt: state.lastSeenAt?.toISOString() ?? null,
    phase: offline ? 'offline' : state.phase,
    currentVariantId: state.currentVariantId ?? null,
    passStartedAt: state.passStartedAt?.toISOString() ?? null,
    passFinishedAt: state.passFinishedAt?.toISOString() ?? null,
    passSummary: state.passSummary ?? null,
    googlePlay: state.googlePlay ?? null,
  };
}

async function countDownloadsSince(em: EntityManager, since: Date): Promise<number> {
  return em.count(Download, { at: { $gte: since } });
}

export interface StatsDependencies {
  connectedNodeIds(): number[];
}

export function statsRouter(context: Context, dependencies: StatsDependencies): Router {
  const router = Router();
  const em = () => context.orm.em;

  router.get('/overview', async (_request, response) => {
    const now = new Date();
    // Deleted nodes are loaded too, so what they served is still matched against their countries.
    const everyNode = await em().find(Node, {});
    const nodes = everyNode.filter((node) => !node.deletedAt);
    const connected = new Set(dependencies.connectedNodeIds());
    const weekAgo = new Date(now.getTime() - 7 * dayMilliseconds);
    const recent = await em().execute<
      { node_id: number | null; country: string | null; count: number }[]
    >(
      'select node_id, country, count(*) as count from download where at >= ? group by node_id, country',
      [weekAgo],
    );
    const nodesById = new Map(everyNode.map((node) => [node.id, node]));
    const unserved = new Map<string, number>();
    let last7Days = 0;
    for (const row of recent) {
      const count = Number(row.count);
      const node = row.node_id === null ? undefined : nodesById.get(row.node_id);
      last7Days += count;
      if (row.country !== null && (node === undefined || !node.countries.includes(row.country))) {
        unserved.set(row.country, (unserved.get(row.country) ?? 0) + count);
      }
    }
    const servable = await em().find(Release, { state: { $in: ['active', 'retained'] } });
    const overview: OverviewView = {
      nodes: {
        online: nodes.filter((node) => node.enabled && node.status === 'online').length,
        faulty: nodes.filter((node) => node.enabled && node.status === 'faulty').length,
        unknown: nodes.filter((node) => node.enabled && node.status === 'unknown').length,
        disabled: nodes.filter((node) => !node.enabled).length,
        agentsConnected: nodes.filter((node) => connected.has(node.id)).length,
      },
      apps: await em().count(App, {}),
      variants: await em().count(Variant, { enabled: true }),
      activeReleases: servable.filter((release) => release.state === 'active').length,
      storeBytes: servable.reduce((sum, release) => sum + release.sizeBytes, 0),
      downloads: {
        today: await countDownloadsSince(em(), new Date(`${dayOf(now)}T00:00:00Z`)),
        last7Days,
        last30Days: await countDownloadsSince(em(), new Date(now.getTime() - 30 * dayMilliseconds)),
      },
      unservedCountries: [...unserved.entries()]
        .map(([country, downloads]) => ({ country, downloads }))
        .sort((a, b) => b.downloads - a.downloads)
        .slice(0, 20),
      downloader: downloaderView(await downloaderState(em())),
    };
    response.json(overview);
  });

  router.get('/downloader', async (_request, response) => {
    response.json(downloaderView(await downloaderState(em())));
  });

  router.get('/stats/downloads', async (request, response) => {
    const query = parse(downloadStatsQuery, request.query);
    const to = query.to === undefined ? new Date() : new Date(query.to);
    const from =
      query.from === undefined
        ? new Date(to.getTime() - 30 * dayMilliseconds)
        : new Date(query.from);
    const rawCutoff = rawDownloadCutoff(new Date());
    const counts = new Map<string, number>();
    const add = (key: string, count: number): void => {
      counts.set(key, (counts.get(key) ?? 0) + count);
    };
    if (from < rawCutoff) {
      // Older history only exists in the daily roll-up.
      const summaries = await em().find(DownloadSummary, {
        day: { $gte: dayOf(from), $lt: dayOf(rawCutoff) },
      });
      for (const summary of summaries) {
        add(summaryKey(summary, query.groupBy), summary.count);
      }
    }
    // Raw rows are counted by SQLite; `??` must travel as a parameter because the query layer
    // would read it as a placeholder.
    const keyExpression = {
      day: "date(d.at / 1000, 'unixepoch')",
      variant: 'r.variant_id',
      node: 'coalesce(d.node_id, 0)',
      country: 'coalesce(d.country, ?)',
    }[query.groupBy];
    const joins =
      query.groupBy === 'variant'
        ? 'join release_file f on f.id = d.file_id join release r on r.id = f.release_id'
        : '';
    const counted = await em().execute<{ key: string | number; count: number }[]>(
      `select ${keyExpression} as key, count(*) as count from download d ${joins}
       where d.at >= ? and d.at < ? group by key`,
      [...(query.groupBy === 'country' ? ['??'] : []), from < rawCutoff ? rawCutoff : from, to],
    );
    for (const row of counted) {
      add(query.groupBy === 'node' && row.key === 0 ? 'host' : String(row.key), Number(row.count));
    }
    const rows: DownloadStatsRow[] = [...counts.entries()]
      .map(([key, count]) => ({ key, count }))
      .sort((a, b) => (query.groupBy === 'day' ? a.key.localeCompare(b.key) : b.count - a.count));
    response.json(rows);
  });

  router.get('/stats/addresses', async (request, response) => {
    const query = parse(addressStatsQuery, request.query);
    const to = query.to === undefined ? new Date() : new Date(query.to);
    const from =
      query.from === undefined
        ? new Date(to.getTime() - 30 * dayMilliseconds)
        : new Date(query.from);
    // The column comes from a fixed list, never from the request text.
    const column = query.groupBy === 'network' ? 'network' : 'address';
    const conditions = [
      'day >= ?',
      'day <= ?',
      ...(query.nodeId === undefined ? [] : ['node_id = ?']),
      ...(query.network === undefined ? [] : ['network = ?']),
    ];
    const parameters = [
      dayOf(from),
      dayOf(to),
      ...(query.nodeId === undefined ? [] : [query.nodeId]),
      ...(query.network === undefined ? [] : [query.network]),
    ];
    const where = conditions.join(' and ');
    const rows = await em().execute<
      {
        key: string;
        egress_bytes: number;
        requests: number;
        addresses: number;
        nodes: number;
      }[]
    >(
      `select ${column} as key, sum(egress_bytes) as egress_bytes, sum(requests) as requests,
         count(distinct address) as addresses, count(distinct node_id) as nodes
       from address_traffic where ${where}
       group by ${column} order by sum(egress_bytes) desc limit ?`,
      [...parameters, query.limit],
    );
    const [totals] = await em().execute<
      { egress_bytes: number | null; requests: number | null; distinct_keys: number }[]
    >(
      `select sum(egress_bytes) as egress_bytes, sum(requests) as requests,
         count(distinct ${column}) as distinct_keys
       from address_traffic where ${where}`,
      parameters,
    );
    const view: AddressStatsView = {
      egressBytes: Number(totals?.egress_bytes ?? 0),
      requests: Number(totals?.requests ?? 0),
      distinctKeys: Number(totals?.distinct_keys ?? 0),
      rows: rows.map((row): AddressStatsRow => ({
        key: row.key,
        egressBytes: Number(row.egress_bytes),
        requests: Number(row.requests),
        addresses: Number(row.addresses),
        nodes: Number(row.nodes),
      })),
    };
    response.json(view);
  });

  router.get('/stats/traffic', async (request, response) => {
    const query = parse(trafficStatsQuery, request.query);
    const to = query.to === undefined ? new Date() : new Date(query.to);
    const from =
      query.from === undefined
        ? new Date(to.getTime() - 30 * dayMilliseconds)
        : new Date(query.from);
    const bucket =
      query.resolution === 'day' ? "date(hour_start / 1000, 'unixepoch')" : 'hour_start';
    const rows = await em().execute<
      {
        node_id: number;
        bucket: string | number;
        egress: number;
        ingress: number;
        requests: number;
      }[]
    >(
      `select node_id, ${bucket} as bucket, sum(egress_bytes) as egress,
         sum(ingress_bytes) as ingress, sum(requests) as requests
       from traffic
       where hour_start >= ? and hour_start < ? ${query.nodeId === undefined ? '' : 'and node_id = ?'}
       group by node_id, bucket order by bucket, node_id`,
      [from, to, ...(query.nodeId === undefined ? [] : [query.nodeId])],
    );
    response.json(
      rows.map((row): TrafficStatsRow => ({
        nodeId: row.node_id,
        start:
          query.resolution === 'day'
            ? `${row.bucket}T00:00:00.000Z`
            : new Date(Number(row.bucket)).toISOString(),
        egressBytes: Number(row.egress),
        ingressBytes: Number(row.ingress),
        requests: Number(row.requests),
      })),
    );
  });

  router.get('/events', async (request, response) => {
    const query = parse(eventsQuery, request.query);
    const where = {
      ...(query.nodeId === undefined ? {} : { node: query.nodeId }),
      ...(query.before === undefined ? {} : { at: { $lt: new Date(query.before) } }),
    };
    const options = { orderBy: { at: 'desc' as const }, limit: query.limit };
    const health =
      query.kind === 'sync'
        ? []
        : (await em().find(HealthEvent, where, options)).map(healthEventView);
    const sync =
      query.kind === 'health'
        ? []
        : (await em().find(SyncEvent, where, options)).map(syncEventView);
    response.json({ health, sync });
  });

  return router;
}

function summaryKey(
  summary: DownloadSummary,
  groupBy: 'day' | 'variant' | 'node' | 'country',
): string {
  switch (groupBy) {
    case 'day':
      return summary.day;
    case 'variant':
      return String(summary.variant.id);
    case 'node':
      return summary.nodeId === 0 ? 'host' : String(summary.nodeId);
    case 'country':
      return summary.country;
  }
}
