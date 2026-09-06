import { createHash } from 'node:crypto';
import { Router } from 'express';
import type { PublicAppView } from 'konmai-shared';
import { App, Release, ReleaseFile, Variant } from '../db/entities.js';
import type { EntityManager } from '../db/orm.js';
import { downloadUrl, iconUrl } from '../urls.js';
import type { Context } from './context.js';

export async function publicCatalogue(
  em: EntityManager,
  publicUrl: string,
): Promise<PublicAppView[]> {
  const releases = await em.find(
    Release,
    { state: 'active', variant: { enabled: true } },
    {
      populate: ['variant', 'variant.app'],
      orderBy: { variant: { app: { displayName: 'asc' }, slug: 'asc' } },
    },
  );
  const files = await em.find(
    ReleaseFile,
    { release: { $in: releases.map((release) => release.id) } },
    { orderBy: { fileName: 'asc' } },
  );
  const apps = new Map<string, PublicAppView>();
  for (const release of releases) {
    const variant: Variant = release.variant;
    const app: App = variant.app;
    const entry = apps.get(app.packageName) ?? {
      packageName: app.packageName,
      displayName: app.displayName,
      iconUrl: iconUrl(publicUrl, app.iconFileName ?? null),
      variants: [],
    };
    entry.variants.push({
      slug: variant.slug,
      name: variant.name,
      sourceType: variant.source.type,
      release: {
        version: release.version,
        versionCode: release.versionCode ?? null,
        publishedAt: (release.activatedAt ?? release.createdAt).toISOString(),
        files: files
          .filter((file) => file.release.id === release.id)
          .map((file) => ({
            fileName: file.fileName,
            kind: file.kind,
            sizeBytes: file.sizeBytes,
            sha256: file.sha256,
            url: downloadUrl(
              publicUrl,
              {
                packageName: app.packageName,
                variant: variant.slug,
                version: release.version,
                fileName: file.fileName,
              },
              true,
            ),
          })),
      },
    });
    apps.set(app.packageName, entry);
  }
  return [...apps.values()];
}

export function catalogueRouter(context: Context): Router {
  const router = Router();
  router.get('/apps', async (request, response) => {
    const catalogue = await publicCatalogue(context.orm.em, context.config.publicUrl);
    const body = JSON.stringify(catalogue);
    const etag = `"${createHash('sha1').update(body).digest('hex')}"`;
    response.setHeader('access-control-allow-origin', '*');
    response.setHeader('cache-control', 'public, max-age=60');
    response.setHeader('etag', etag);
    if (request.header('if-none-match') === etag) {
      response.status(304).end();
      return;
    }
    response.type('application/json').send(body);
  });
  return router;
}
