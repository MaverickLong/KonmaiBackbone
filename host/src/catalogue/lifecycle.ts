import { EventEmitter } from 'node:events';
import type { IngestRelease } from 'konmai-shared';
import type { EntityManager } from '../db/orm.js';
import { Release, ReleaseFile, Variant } from '../db/entities.js';
import { conflict, HttpError, notFound } from '../http/errors.js';
import type { Logger } from '../logger.js';
import { hashFile, type Store } from './store.js';

export const retainedReleases = 2;

// Emits 'changed' whenever the set of servable releases changes; the node gateway listens and
// pushes a fresh manifest to every connected node.
export const catalogueEvents = new EventEmitter<{ changed: [] }>();

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
    for (const previous of releases) {
      previous.state = 'deleting';
    }
    const [previousActive] = releases;
    if (previousActive !== undefined) {
      previousActive.state = 'retained';
    }
    release.state = 'active';
    release.activatedAt = new Date();
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
  release.state = 'deleting';
  await em.flush();
  await deleteMarkedReleases(em, store, logger);
  await promoteRetained(em, release.variant.id);
  catalogueEvents.emit('changed');
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
    newest.state = 'active';
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
