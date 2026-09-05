import { Router } from 'express';
import {
  downloadStatsQuery,
  eventsQuery,
  trafficStatsQuery,
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
  Traffic,
  Variant,
} from '../../db/entities.js';
import type { EntityManager } from '../../db/orm.js';
import { healthEventView, syncEventView } from '../../views.js';
import type { Context } from '../context.js';
import { parse } from '../errors.js';
import { downloaderState } from '../ingest.js';

const dayMilliseconds = 86_400_000;
export const rawDownloadRetentionDays = 90;

function dayOf(date: Date): string {
  return date.toISOString().slice(0, 10);
}

export function downloaderView(state: Awaited<ReturnType<typeof downloaderState>>): DownloaderView {
  return {
    lastSeenAt: state.lastSeenAt?.toISOString() ?? null,
    phase: state.phase,
    currentVariantId: state.currentVariantId ?? null,
    passStartedAt: state.passStartedAt?.toISOString() ?? null,
    passFinishedAt: state.passFinishedAt?.toISOString() ?? null,
    passSummary: state.passSummary ?? null,
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
    const nodes = await em().find(Node, {});
    const connected = new Set(dependencies.connectedNodeIds());
    const weekAgo = new Date(now.getTime() - 7 * dayMilliseconds);
    const recent = await em().find(Download, { at: { $gte: weekAgo } });
    const nodesById = new Map(nodes.map((node) => [node.id, node]));
    const unserved = new Map<string, number>();
    let servedByHost = 0;
    for (const download of recent) {
      const node =
        download.node === null || download.node === undefined
          ? null
          : nodesById.get(download.node.id);
      if (node === undefined || node === null) {
        servedByHost++;
      }
      if (
        download.country !== null &&
        download.country !== undefined &&
        (node === null || node === undefined || !node.countries.includes(download.country))
      ) {
        unserved.set(download.country, (unserved.get(download.country) ?? 0) + 1);
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
        last7Days: recent.length,
        last30Days: await countDownloadsSince(em(), new Date(now.getTime() - 30 * dayMilliseconds)),
      },
      servedByHostLast7Days: servedByHost,
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
    const rawCutoff = new Date(Date.now() - rawDownloadRetentionDays * dayMilliseconds);
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
    const downloads = await em().find(
      Download,
      {
        at: { $gte: from < rawCutoff ? rawCutoff : from, $lt: to },
      },
      { populate: ['file', 'file.release'] },
    );
    for (const download of downloads) {
      add(downloadKey(download, query.groupBy), 1);
    }
    const rows: DownloadStatsRow[] = [...counts.entries()]
      .map(([key, count]) => ({ key, count }))
      .sort((a, b) => (query.groupBy === 'day' ? a.key.localeCompare(b.key) : b.count - a.count));
    response.json(rows);
  });

  router.get('/stats/traffic', async (request, response) => {
    const query = parse(trafficStatsQuery, request.query);
    const to = query.to === undefined ? new Date() : new Date(query.to);
    const from =
      query.from === undefined
        ? new Date(to.getTime() - 30 * dayMilliseconds)
        : new Date(query.from);
    const buckets = await em().find(Traffic, {
      ...(query.nodeId === undefined ? {} : { node: query.nodeId }),
      hourStart: { $gte: from, $lt: to },
    });
    const rows = new Map<string, TrafficStatsRow>();
    for (const bucket of buckets) {
      const start =
        query.resolution === 'day'
          ? `${dayOf(bucket.hourStart)}T00:00:00.000Z`
          : bucket.hourStart.toISOString();
      const key = `${bucket.node.id}|${start}`;
      const row = rows.get(key) ?? {
        nodeId: bucket.node.id,
        start,
        egressBytes: 0,
        ingressBytes: 0,
        requests: 0,
      };
      row.egressBytes += bucket.egressBytes;
      row.ingressBytes += bucket.ingressBytes;
      row.requests += bucket.requests;
      rows.set(key, row);
    }
    response.json(
      [...rows.values()].sort((a, b) => a.start.localeCompare(b.start) || a.nodeId - b.nodeId),
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

function downloadKey(download: Download, groupBy: 'day' | 'variant' | 'node' | 'country'): string {
  switch (groupBy) {
    case 'day':
      return dayOf(download.at);
    case 'variant':
      return String(download.file.release.variant.id);
    case 'node':
      return download.node === null || download.node === undefined
        ? 'host'
        : String(download.node.id);
    case 'country':
      return download.country ?? '??';
  }
}
