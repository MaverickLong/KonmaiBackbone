import { Router } from 'express';
import { checkResult, downloaderHeartbeat, googlePlayReport, ingestRelease } from 'konmai-shared';
import type { Alerts } from '../alerts/email.js';
import { isCheckDue, recordCheckResult } from '../catalogue/checks.js';
import { publishRelease } from '../catalogue/lifecycle.js';
import { DownloaderState, Release, Variant } from '../db/entities.js';
import type { EntityManager } from '../db/orm.js';
import { requireToken } from './auth.js';
import type { Context } from './context.js';
import { parse } from './errors.js';
import { loadVariant } from './admin/variants.js';

async function pinnedCombination(
  em: EntityManager,
  device: string | undefined,
  email: string | undefined,
): Promise<string> {
  const accounts = (await downloaderState(em)).googlePlay?.accounts ?? [];
  const alias = accounts.find((account) => account.email === email)?.alias;
  return `device ${device} and account ${alias === undefined ? email : `${alias} (${email})`}`;
}

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
    googlePlay: null,
  });
  await em.flush();
  return created;
}

export interface IngestDependencies {
  alerts: Alerts;
}

export function ingestRouter(context: Context, dependencies: IngestDependencies): Router {
  const router = Router();
  const em = () => context.orm.em;
  router.use(requireToken(context.config.ingestToken));

  router.get('/variants', async (_request, response) => {
    const now = new Date();
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
          checkDue: isCheckDue(variant, now),
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
    const source = variant.source;
    const alert = recordCheckResult(variant, body, new Date());
    await em().flush();
    const pinned =
      alert && source.type === 'googleplay'
        ? await pinnedCombination(em(), source.device, source.account)
        : 'its settings';
    response.status(204).end();
    if (alert) {
      const label = `${variant.app.packageName}/${variant.slug}`;
      // Not awaited: the downloader should not wait for the mail server's retries.
      void dependencies.alerts.send(
        `${label} cannot be checked`,
        [
          `Checking ${variant.app.displayName} · ${variant.name} (${label}) with ${pinned} failed:`,
          '',
          body.error ?? 'unknown error',
          '',
          'The downloader does not try other devices or accounts while both are set. Clear the',
          'device or the account of the variant in the dashboard to let it look for a working',
          'combination again. No further e-mail is sent until a check succeeds.',
        ].join('\n'),
      );
    }
  });

  router.put('/google-play', async (request, response) => {
    const body = parse(googlePlayReport, request.body);
    const state = await downloaderState(em());
    state.googlePlay = { ...body, reportedAt: new Date().toISOString() };
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
