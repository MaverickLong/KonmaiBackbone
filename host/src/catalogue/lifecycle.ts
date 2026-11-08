import { EventEmitter } from 'node:events';
import type { IngestRelease, ReleaseState } from 'konmai-shared';
import type { EntityManager } from '../db/orm.js';
import { Release, ReleaseFile, Variant } from '../db/entities.js';
import { conflict, HttpError, notFound } from '../http/errors.js';
import type { Logger } from '../logger.js';
import { hashFile, type Store } from './store.js';

// Emits 'changed' whenever the set of servable releases changes; the node gateway listens and
// pushes a fresh manifest to every connected node.
export const catalogueEvents = new EventEmitter<{ changed: [] }>();

// Every state change of a release goes through here, so the whole lifecycle reads in one place:
// ingesting → active → retained → deleting → removed, retained → active when the newer release
// is removed by hand, and ingesting → deleting when an ingest never finished.
const nextStates: Record<ReleaseState, readonly ReleaseState[]> = {
  ingesting: ['active', 'deleting'],
  active: ['retained', 'deleting'],
  retained: ['active', 'deleting'],
  deleting: [],
};

export function moveRelease(release: Release, next: ReleaseState): void {
  if (!nextStates[release.state].includes(next)) {
    throw new Error(`release ${release.id} cannot move from ${release.state} to ${next}`);
  }
  release.state = next;
  if (next === 'active' && !release.activatedAt) {
    release.activatedAt = new Date();
  }
}

export async function publishRelease(
  em: EntityManager,
  store: Store,
  logger: Logger,
  payload: IngestRelease,
): Promise<Release> {
  const variant = await em.findOne(
    Variant,
    { app: payload.packageName, slug: payload.variant },
    { populate: ['app'] },
  );
  if (variant === null) {
    throw notFound('variant');
  }
  const existing = await em.findOne(Release, { variant, version: payload.version });
  if (existing !== null) {
    throw conflict(`release ${payload.version} already exists for this variant`);
  }
  const uniqueNames = new Set(payload.files.map((file) => file.fileName));
  if (uniqueNames.size !== payload.files.length) {
    throw new HttpError(400, 'VALIDATION', 'duplicate file names in release');
  }

  const stagedPaths: string[] = [];
  for (const file of payload.files) {
    let stagedPath: string;
    try {
      stagedPath = await store.resolveStagedFile(file.path);
    } catch (error) {
      throw new HttpError(400, 'VALIDATION', (error as Error).message);
    }
    const actualHash = await hashFile(stagedPath);
    if (actualHash !== file.sha256) {
      throw new HttpError(400, 'VALIDATION', `hash mismatch for ${file.fileName}`, {
        expected: file.sha256,
        actual: actualHash,
      });
    }
    stagedPaths.push(stagedPath);
  }

  const locator = {
    packageName: payload.packageName,
    variant: payload.variant,
    version: payload.version,
  };
  const release = em.create(Release, {
    variant,
    version: payload.version,
    versionCode: payload.versionCode,
    state: 'ingesting',
    sizeBytes: payload.files.reduce((sum, file) => sum + file.sizeBytes, 0),
  });
  for (const file of payload.files) {
    em.create(ReleaseFile, {
      release,
      fileName: file.fileName,
      kind: file.kind,
      sizeBytes: file.sizeBytes,
      sha256: file.sha256,
    });
  }
  await em.flush();

  try {
    for (const [index, file] of payload.files.entries()) {
      await store.moveIntoStore(stagedPaths[index]!, { ...locator, fileName: file.fileName });
    }
  } catch (error) {
    await store.deleteRelease(locator);
    em.remove(release);
    await em.flush();
    throw error;
  }
  await store.deleteStagedRelease(locator);

  await em.transactional(async (transaction) => {
    const releases = await transaction.find(
      Release,
      { variant, state: { $in: ['active', 'retained'] } },
      { orderBy: { createdAt: 'desc', id: 'desc' } },
    );
    const [previousActive, ...older] = releases;
    for (const previous of older) {
      moveRelease(previous, 'deleting');
    }
    if (previousActive?.state === 'active') {
      moveRelease(previousActive, 'retained');
    }
    moveRelease(release, 'active');
  });

  await deleteMarkedReleases(em, store, logger);
  logger.info(
    { packageName: payload.packageName, variant: payload.variant, version: payload.version },
    'release published',
  );
  catalogueEvents.emit('changed');
  return release;
}

export async function removeRelease(
  em: EntityManager,
  store: Store,
  logger: Logger,
  release: Release,
): Promise<void> {
  if (release.state !== 'deleting') {
    moveRelease(release, 'deleting');
  }
  await em.flush();
  await deleteMarkedReleases(em, store, logger);
  await promoteRetained(em, release.variant.id);
  catalogueEvents.emit('changed');
}

// The release a new version replaced stays servable for a grace period so that downloads in
// progress can finish, then it goes the way of everything older. Nodes delete their copy as soon
// as the next manifest no longer lists it.
export async function expireRetained(
  em: EntityManager,
  store: Store,
  logger: Logger,
  graceMinutes: number,
  now = new Date(),
): Promise<number> {
  const retained = await em.find(Release, { state: 'retained' });
  let expired = 0;
  for (const release of retained) {
    const active = await em.findOne(Release, { variant: release.variant, state: 'active' });
    if (active === null) {
      continue;
    }
    const replacedAt = active.activatedAt ?? active.createdAt;
    if (now.getTime() - replacedAt.getTime() >= graceMinutes * 60_000) {
      moveRelease(release, 'deleting');
      expired++;
    }
  }
  if (expired === 0) {
    return 0;
  }
  await em.flush();
  await deleteMarkedReleases(em, store, logger);
  catalogueEvents.emit('changed');
  return expired;
}

async function promoteRetained(em: EntityManager, variantId: number): Promise<void> {
  const active = await em.count(Release, { variant: variantId, state: 'active' });
  if (active > 0) {
    return;
  }
  const newest = await em.findOne(
    Release,
    { variant: variantId, state: 'retained' },
    { orderBy: { createdAt: 'desc', id: 'desc' } },
  );
  if (newest !== null) {
    moveRelease(newest, 'active');
    await em.flush();
  }
}

export async function deleteMarkedReleases(
  em: EntityManager,
  store: Store,
  logger: Logger,
): Promise<void> {
  const marked = await em.find(
    Release,
    { state: 'deleting' },
    { populate: ['variant', 'variant.app'] },
  );
  for (const release of marked) {
    const locator = {
      packageName: release.variant.app.packageName,
      variant: release.variant.slug,
      version: release.version,
    };
    await store.deleteRelease(locator);
    em.remove(release);
    logger.info(locator, 'release deleted');
  }
  await em.flush();
}
