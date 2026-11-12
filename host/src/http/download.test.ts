import { mkdtemp, rm } from 'node:fs/promises';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { RequestContext } from '@mikro-orm/core';
import type { MikroORM } from '@mikro-orm/sqlite';
import express from 'express';
import type { PublicAppView } from 'konmai-shared';
import pino from 'pino';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Store } from '../catalogue/store.js';
import type { Config } from '../config.js';
import { App, Download, Holding, Node, Release, ReleaseFile, Variant } from '../db/entities.js';
import { openDatabase } from '../db/orm.js';
import type { GeoIp } from '../routing/geoip.js';
import type { RoutableNode, RoutableNodes } from '../routing/routable.js';
import { catalogueRouter } from './catalogue.js';
import type { Context } from './context.js';
import { downloadRouter } from './download.js';

describe('downloads without a host fallback', () => {
  let directory: string;
  let orm: MikroORM;
  let server: Server;
  let origin: string;
  let routable: RoutableNode[];
  let nodeId: number;
  let fileId: number;
  const filePath = '/d/com.example/gp/latest/example.apk';

  beforeEach(async () => {
    directory = await mkdtemp(path.join(tmpdir(), 'konmai-download-'));
    orm = await openDatabase(path.join(directory, 'host.sqlite'));
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
      version: '1.0',
      versionCode: null,
      state: 'active',
      sizeBytes: 3,
      activatedAt: new Date(),
    });
    const file = em.create(ReleaseFile, {
      release,
      fileName: 'example.apk',
      kind: 'apk',
      sizeBytes: 3,
      sha256: 'a'.repeat(64),
    });
    const node = em.create(Node, {
      name: 'tokyo',
      domain: 'tokyo.example.com',
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
      deletedAt: null,
    });
    await em.flush();
    nodeId = node.id;
    fileId = file.id;
    routable = [
      { id: node.id, domain: node.domain, countries: ['JP'], catchAll: false, weight: 100 },
    ];

    const context: Context = {
      config: { publicUrl: 'https://cdn.example.com' } as Config,
      orm,
      store: new Store(directory),
      logger: pino({ level: 'silent' }),
    };
    const dependencies = {
      geoip: { country: () => null } as unknown as GeoIp,
      routable: { list: () => Promise.resolve(routable) } as unknown as RoutableNodes,
    };
    const application = express();
    application.use((_request, _response, next) => RequestContext.create(orm.em, next));
    application.use('/d', downloadRouter(context, dependencies));
    application.use('/api/public', catalogueRouter(context, dependencies));
    server = createServer(application);
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });

  afterEach(async () => {
    await new Promise((resolve) => server.close(resolve));
    await orm.close();
    await rm(directory, { recursive: true, force: true });
  });

  async function hold(): Promise<void> {
    const em = orm.em.fork();
    em.create(Holding, {
      node: nodeId,
      file: fileId,
      sha256: 'a'.repeat(64),
      sizeBytes: 3,
      state: 'present',
      reportedAt: new Date(),
    });
    await em.flush();
  }

  async function catalogueFile(): Promise<PublicAppView['variants'][0]['release']['files'][0]> {
    const apps = (await (await fetch(`${origin}/api/public/apps`)).json()) as PublicAppView[];
    return apps[0]!.variants[0]!.release.files[0]!;
  }

  it('asks the user to come back while no node holds the file', async () => {
    const response = await fetch(origin + filePath, { redirect: 'manual' });
    expect(response.status).toBe(503);
    expect(response.headers.get('retry-after')).toBe('60');
    expect(await response.text()).toContain('try again');
    expect((await catalogueFile()).available).toBe(false);
    expect(await orm.em.fork().count(Download, {})).toBe(0);
  });

  it('redirects to a node that holds the file and records the download', async () => {
    await hold();
    const response = await fetch(origin + filePath, { redirect: 'manual' });
    expect(response.status).toBe(302);
    expect(response.headers.get('location')).toBe(
      'https://tokyo.example.com/files/com.example/gp/1.0/example.apk',
    );
    expect((await catalogueFile()).available).toBe(true);
    await vi.waitFor(async () => {
      const downloads = await orm.em.fork().find(Download, {});
      expect(downloads.map((download) => download.node?.id)).toEqual([nodeId]);
    });
  });

  it('does not fall back to the host when the only holder cannot take traffic', async () => {
    await hold();
    routable = [];
    const response = await fetch(origin + filePath, { redirect: 'manual' });
    expect(response.status).toBe(503);
    expect((await catalogueFile()).available).toBe(false);
  });
});
