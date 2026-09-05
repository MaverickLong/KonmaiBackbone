import { rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { Router } from 'express';
import {
  appCreate,
  appUpdate,
  packageName as packageNameSchema,
  variantCreate,
} from 'konmai-shared';
import multer from 'multer';
import { App, Release, Variant } from '../../db/entities.js';
import type { EntityManager } from '../../db/orm.js';
import { appView, variantView } from '../../views.js';
import type { Context } from '../context.js';
import { conflict, HttpError, notFound, parse } from '../errors.js';

const iconExtensions: Record<string, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/webp': 'webp',
};

export async function loadApp(em: EntityManager, packageName: string): Promise<App> {
  const app = await em.findOne(App, { packageName: parse(packageNameSchema, packageName) });
  if (app === null) {
    throw notFound('app');
  }
  return app;
}

export async function activeReleasesByVariant(
  em: EntityManager,
  variantIds: number[],
): Promise<Map<number, Release>> {
  const releases = await em.find(Release, { variant: { $in: variantIds }, state: 'active' });
  return new Map(releases.map((release) => [release.variant.id, release]));
}

export async function appViews(context: Context, em: EntityManager, apps: App[]) {
  const variants = await em.find(
    Variant,
    { app: { $in: apps.map((app) => app.packageName) } },
    { populate: ['app'], orderBy: { slug: 'asc' } },
  );
  const active = await activeReleasesByVariant(
    em,
    variants.map((variant) => variant.id),
  );
  return apps.map((app) =>
    appView(
      context.config.publicUrl,
      app,
      variants
        .filter((variant) => variant.app.packageName === app.packageName)
        .map((variant) => variantView(variant, active.get(variant.id) ?? null)),
    ),
  );
}

export function appsRouter(context: Context): Router {
  const router = Router();
  const em = () => context.orm.em;
  const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 1_048_576 } });

  router.get('/', async (_request, response) => {
    const apps = await em().find(App, {}, { orderBy: { displayName: 'asc' } });
    response.json(await appViews(context, em(), apps));
  });

  router.post('/', async (request, response) => {
    const body = parse(appCreate, request.body);
    if ((await em().count(App, { packageName: body.packageName })) > 0) {
      throw conflict('an app with this package name already exists');
    }
    const app = em().create(App, { ...body, iconFileName: null });
    await em().flush();
    response.status(201).json((await appViews(context, em(), [app]))[0]);
  });

  router.get('/:packageName', async (request, response) => {
    const app = await loadApp(em(), request.params.packageName);
    response.json((await appViews(context, em(), [app]))[0]);
  });

  router.patch('/:packageName', async (request, response) => {
    const app = await loadApp(em(), request.params.packageName);
    const body = parse(appUpdate, request.body);
    app.displayName = body.displayName;
    await em().flush();
    response.json((await appViews(context, em(), [app]))[0]);
  });

  router.delete('/:packageName', async (request, response) => {
    const app = await loadApp(em(), request.params.packageName);
    if ((await em().count(Variant, { app })) > 0) {
      throw conflict('delete the variants of this app first');
    }
    await removeIcon(context, app);
    em().remove(app);
    await em().flush();
    response.status(204).end();
  });

  router.put('/:packageName/icon', upload.single('icon'), async (request, response) => {
    const app = await loadApp(em(), String(request.params['packageName']));
    const file = request.file;
    if (file === undefined) {
      throw new HttpError(400, 'VALIDATION', 'multipart field "icon" is required');
    }
    const extension = iconExtensions[file.mimetype];
    if (extension === undefined) {
      throw new HttpError(400, 'VALIDATION', 'icon must be png, jpeg or webp');
    }
    await removeIcon(context, app);
    const iconFileName = `${app.packageName}.${extension}`;
    await writeFile(path.join(context.store.iconsDirectory, iconFileName), file.buffer);
    app.iconFileName = iconFileName;
    await em().flush();
    response.json((await appViews(context, em(), [app]))[0]);
  });

  router.delete('/:packageName/icon', async (request, response) => {
    const app = await loadApp(em(), request.params.packageName);
    await removeIcon(context, app);
    await em().flush();
    response.status(204).end();
  });

  router.post('/:packageName/variants', async (request, response) => {
    const app = await loadApp(em(), request.params.packageName);
    const body = parse(variantCreate, request.body);
    if ((await em().count(Variant, { app, slug: body.slug })) > 0) {
      throw conflict('a variant with this slug already exists for this app');
    }
    const variant = em().create(Variant, {
      app,
      slug: body.slug,
      name: body.name,
      source: body.source,
      enabled: body.enabled,
      checkRequestedAt: new Date(),
      lastCheckedAt: null,
      lastCheckStatus: null,
      lastCheckError: null,
    });
    await em().flush();
    response.status(201).json(variantView(variant, null));
  });

  return router;
}

async function removeIcon(context: Context, app: App): Promise<void> {
  if (app.iconFileName) {
    await rm(path.join(context.store.iconsDirectory, app.iconFileName), { force: true });
    app.iconFileName = null;
  }
}
