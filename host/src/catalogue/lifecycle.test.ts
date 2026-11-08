import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { MikroORM } from '@mikro-orm/sqlite';
import pino from 'pino';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { App, Release, Variant } from '../db/entities.js';
import { openDatabase } from '../db/orm.js';
import { expireRetained, moveRelease } from './lifecycle.js';
import { Store } from './store.js';

function release(state: Release['state'], activatedAt: Date | null = null): Release {
  return { id: 1, state, activatedAt } as Release;
}

describe('moveRelease', () => {
  it('walks a release from ingesting to removal', () => {
    const subject = release('ingesting');
    moveRelease(subject, 'active');
    expect(subject.state).toBe('active');
    expect(subject.activatedAt).toBeInstanceOf(Date);
    moveRelease(subject, 'retained');
    moveRelease(subject, 'deleting');
    expect(subject.state).toBe('deleting');
  });

  it('keeps the first activation time when a retained release becomes active again', () => {
    const activatedAt = new Date('2026-01-01T00:00:00Z');
    const subject = release('retained', activatedAt);
    moveRelease(subject, 'active');
    expect(subject.activatedAt).toBe(activatedAt);
  });

  it('lets an unfinished ingest be deleted', () => {
    const subject = release('ingesting');
    moveRelease(subject, 'deleting');
    expect(subject.state).toBe('deleting');
    expect(subject.activatedAt).toBeNull();
  });

  it('refuses to skip a step or revive a deleted release', () => {
    expect(() => moveRelease(release('ingesting'), 'retained')).toThrow(
      'cannot move from ingesting to retained',
    );
    expect(() => moveRelease(release('active'), 'active')).toThrow();
    expect(() => moveRelease(release('deleting'), 'active')).toThrow();
  });
});

describe('expireRetained', () => {
  let directory: string;
  let orm: MikroORM;

  beforeEach(async () => {
    directory = await mkdtemp(path.join(tmpdir(), 'konmai-retention-'));
    orm = await openDatabase(path.join(directory, 'host.sqlite'));
  });

  afterEach(async () => {
    await orm.close();
    await rm(directory, { recursive: true, force: true });
  });

  it('deletes the replaced release once its successor has been live for the grace period', async () => {
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
    const fields = { variant, versionCode: null, sizeBytes: 1 };
    em.create(Release, {
      ...fields,
      version: '1',
      state: 'retained',
      activatedAt: new Date('2026-11-09T00:00:00Z'),
    });
    em.create(Release, {
      ...fields,
      version: '2',
      state: 'active',
      activatedAt: new Date('2026-11-09T02:00:00Z'),
    });
    await em.flush();
    const store = new Store(directory);
    const logger = pino({ level: 'silent' });

    expect(await expireRetained(em, store, logger, 60, new Date('2026-11-09T02:30:00Z'))).toBe(0);
    expect(await expireRetained(em, store, logger, 60, new Date('2026-11-09T03:00:00Z'))).toBe(1);
    const remaining = await orm.em.fork().find(Release, {});
    expect(remaining.map((entry) => [entry.version, entry.state])).toEqual([['2', 'active']]);
  });
});
