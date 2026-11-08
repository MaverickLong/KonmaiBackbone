import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { MikroORM } from '@mikro-orm/sqlite';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  App,
  Download,
  DownloadSummary,
  Node,
  Release,
  ReleaseFile,
  Variant,
} from '../db/entities.js';
import { openDatabase } from '../db/orm.js';
import { rollUpDownloads } from './jobs.js';

describe('rollUpDownloads', () => {
  let directory: string;
  let orm: MikroORM;

  beforeEach(async () => {
    directory = await mkdtemp(path.join(tmpdir(), 'konmai-rollup-'));
    orm = await openDatabase(path.join(directory, 'host.sqlite'));
  });

  afterEach(async () => {
    await orm.close();
    await rm(directory, { recursive: true, force: true });
  });

  it('summarises completed days, keeps recent rows raw and drops rows past retention', async () => {
    const em = orm.em.fork();
    const app = em.create(App, {
      packageName: 'com.example',
      displayName: 'Example',
      iconFileName: null,
    });
    const variant = em.create(Variant, {
      app,
      slug: 'gp',
      name: 'Google Play',
      source: { type: 'manual' },
      checkRequestedAt: null,
      lastCheckedAt: null,
      lastCheckStatus: null,
      lastCheckError: null,
    });
    const release = em.create(Release, {
      variant,
      version: '1',
      versionCode: null,
      state: 'active',
      sizeBytes: 1,
      activatedAt: null,
    });
    const file = em.create(ReleaseFile, {
      release,
      fileName: 'a.apk',
      kind: 'apk',
      sizeBytes: 1,
      sha256: 'a'.repeat(64),
    });
    const node = em.create(Node, {
      name: 'node',
      domain: 'node.example.com',
      countries: ['JP'],
      allowedVariants: [],
      monthlyQuotaBytes: 1_000,
      quotaResetDay: 1,
      status: 'online',
      agentVersion: null,
      lastHealthyAt: null,
      lastFailureAt: null,
      lastFailureReason: null,
      usageAdjustmentPeriodStart: null,
      tokenHash: 'hash',
      storageTotalBytes: null,
      storageFreeBytes: null,
    });
    const at = (iso: string) => new Date(iso);
    em.create(Download, { file, node, country: 'JP', at: at('2026-08-01T10:00:00Z') });
    em.create(Download, { file, node, country: 'JP', at: at('2026-08-01T11:00:00Z') });
    em.create(Download, { file, node: null, country: null, at: at('2026-11-08T23:59:59Z') });
    em.create(Download, { file, node, country: 'JP', at: at('2026-11-09T01:00:00Z') });
    await em.flush();
    const now = at('2026-11-09T12:00:00Z');

    expect(await rollUpDownloads(orm.em.fork(), now)).toBe(2);
    const summaries = await orm.em.fork().find(DownloadSummary, {}, { orderBy: { day: 'asc' } });
    expect(
      summaries.map((summary) => [summary.day, summary.nodeId, summary.country, summary.count]),
    ).toEqual([
      ['2026-08-01', node.id, 'JP', 2],
      ['2026-11-08', 0, '??', 1],
    ]);
    const raw = await orm.em.fork().find(Download, {}, { orderBy: { at: 'asc' } });
    expect(raw.map((download) => download.at.toISOString())).toEqual([
      '2026-11-08T23:59:59.000Z',
      '2026-11-09T01:00:00.000Z',
    ]);

    // Running again only touches the days still held raw and leaves older summaries alone.
    expect(await rollUpDownloads(orm.em.fork(), now)).toBe(1);
    expect(await orm.em.fork().count(DownloadSummary, {})).toBe(2);
  });
});
