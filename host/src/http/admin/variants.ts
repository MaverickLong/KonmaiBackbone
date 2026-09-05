import { Router } from 'express';
import { variantUpdate, type VariantDetailView } from 'konmai-shared';
import { z } from 'zod';
import { catalogueEvents, removeRelease } from '../../catalogue/lifecycle.js';
import { Holding, Release, ReleaseFile, Variant } from '../../db/entities.js';
import type { EntityManager } from '../../db/orm.js';
import { releaseView, variantView } from '../../views.js';
import type { Context } from '../context.js';
import { conflict, notFound, parse } from '../errors.js';

const idParameter = z.coerce.number().int().positive();

export async function loadVariant(em: EntityManager, id: string): Promise<Variant> {
  const variant = await em.findOne(Variant, { id: parse(idParameter, id) }, { populate: ['app'] });
  if (variant === null) {
    throw notFound('variant');
  }
  return variant;
}

export async function variantDetail(
  context: Context,
  em: EntityManager,
  variant: Variant,
): Promise<VariantDetailView> {
  const releases = await em.find(
    Release,
    { variant },
    { populate: ['variant', 'variant.app'], orderBy: { createdAt: 'desc', id: 'desc' } },
  );
  const files = await em.find(ReleaseFile, {
    release: { $in: releases.map((release) => release.id) },
  });
  const holdings = await em.find(Holding, {
    file: { $in: files.map((file) => file.id) },
    state: 'present',
  });
  const holdersByFile = new Map<number, number[]>();
  for (const holding of holdings) {
    const holders = holdersByFile.get(holding.file.id) ?? [];
    holders.push(holding.node.id);
    holdersByFile.set(holding.file.id, holders);
  }
  const active = releases.find((release) => release.state === 'active') ?? null;
  return {
    ...variantView(variant, active),
    releases: releases.map((release) =>
      releaseView(
        context.config.publicUrl,
        release,
        files.filter((file) => file.release.id === release.id),
        holdersByFile,
      ),
    ),
  };
}

export function variantsRouter(context: Context): Router {
  const router = Router();
  const em = () => context.orm.em;

  router.post('/check-all', async (_request, response) => {
    const count = await em().nativeUpdate(
      Variant,
      { enabled: true },
      { checkRequestedAt: new Date() },
    );
    response.json({ requested: count });
  });

  router.get('/:id', async (request, response) => {
    const variant = await loadVariant(em(), request.params.id);
    response.json(await variantDetail(context, em(), variant));
  });

  router.patch('/:id', async (request, response) => {
    const variant = await loadVariant(em(), request.params.id);
    const body = parse(variantUpdate, request.body);
    if (body.name !== undefined) {
      variant.name = body.name;
    }
    if (body.source !== undefined) {
      variant.source = body.source;
      variant.checkRequestedAt = new Date();
    }
    if (body.enabled !== undefined) {
      variant.enabled = body.enabled;
    }
    await em().flush();
    catalogueEvents.emit('changed');
    response.json(await variantDetail(context, em(), variant));
  });

  router.delete('/:id', async (request, response) => {
    const variant = await loadVariant(em(), request.params.id);
    if ((await em().count(Release, { variant })) > 0) {
      throw conflict('delete the releases of this variant first');
    }
    em().remove(variant);
    await em().flush();
    catalogueEvents.emit('changed');
    response.status(204).end();
  });

  router.post('/:id/check', async (request, response) => {
    const variant = await loadVariant(em(), request.params.id);
    variant.checkRequestedAt = new Date();
    await em().flush();
    response.json(variantView(variant, null));
  });

  router.delete('/:id/releases/:version', async (request, response) => {
    const variant = await loadVariant(em(), request.params.id);
    const release = await em().findOne(
      Release,
      { variant, version: request.params.version },
      { populate: ['variant', 'variant.app'] },
    );
    if (release === null) {
      throw notFound('release');
    }
    await removeRelease(em(), context.store, context.logger, release);
    response.status(204).end();
  });

  return router;
}
