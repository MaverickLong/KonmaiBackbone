import { Router } from 'express';
import { checkResult, downloaderHeartbeat, ingestRelease } from 'konmai-shared';
import { publishRelease } from '../catalogue/lifecycle.js';
import { DownloaderState, Release, Variant } from '../db/entities.js';
import type { EntityManager } from '../db/orm.js';
import { requireToken } from './auth.js';
import type { Context } from './context.js';
import { parse } from './errors.js';
import { loadVariant } from './admin/variants.js';

export async function downloaderState(em: EntityManager): Promise<DownloaderState> {
  const existing = await em.findOne(DownloaderState, { id: 1 });
  if (existing !== null) {
    return existing;
  }
  const created = em.create(DownloaderState, {
    id: 1,
    lastSeenAt: null,
    phase: 'idle',
    currentVariantId: null,
    passStartedAt: null,
    passFinishedAt: null,
    passSummary: null,
  });
  await em.flush();
  return created;
}

export function ingestRouter(context: Context): Router {
  const router = Router();
  const em = () => context.orm.em;
  router.use(requireToken(context.config.ingestToken));

  router.get('/variants', async (_request, response) => {
    const variants = await em().find(
      Variant,
      { enabled: true },
      { populate: ['app'], orderBy: { id: 'asc' } },
    );
    const active = await em().find(Release, {
      variant: { $in: variants.map((variant) => variant.id) },
      state: 'active',
    });
    const activeByVariant = new Map(active.map((release) => [release.variant.id, release]));
    response.json(
      variants.map((variant) => {
        const release = activeByVariant.get(variant.id);
        return {
          id: variant.id,
          packageName: variant.app.packageName,
          slug: variant.slug,
          name: variant.name,
          source: variant.source,
          activeRelease:
            release === undefined
              ? null
              : { version: release.version, versionCode: release.versionCode ?? null },
          checkRequested:
            variant.checkRequestedAt !== null && variant.checkRequestedAt !== undefined,
        };
      }),
    );
  });

  router.post('/releases', async (request, response) => {
    const body = parse(ingestRelease, request.body);
    const release = await publishRelease(em(), context.store, context.logger, body);
    response.status(201).json({
      id: release.id,
      version: release.version,
      versionCode: release.versionCode ?? null,
      state: release.state,
      sizeBytes: release.sizeBytes,
    });
  });

  router.post('/variants/:id/check-result', async (request, response) => {
    const variant = await loadVariant(em(), request.params.id);
    const body = parse(checkResult, request.body);
    variant.lastCheckedAt = new Date();
    variant.lastCheckStatus = body.status;
    variant.lastCheckError = body.status === 'failed' ? (body.error ?? 'unknown error') : null;
    variant.checkRequestedAt = null;
    await em().flush();
    response.status(204).end();
  });

  router.post('/heartbeat', async (request, response) => {
    const body = parse(downloaderHeartbeat, request.body);
    const state = await downloaderState(em());
    state.lastSeenAt = new Date();
    state.phase = body.phase;
    state.currentVariantId = body.variantId;
    if (body.passStartedAt !== null) {
      state.passStartedAt = new Date(body.passStartedAt);
    }
    if (body.passFinishedAt !== null) {
      state.passFinishedAt = new Date(body.passFinishedAt);
    }
    if (body.passSummary !== null) {
      state.passSummary = body.passSummary;
    }
    await em().flush();
    response.status(204).end();
  });

  return router;
}
