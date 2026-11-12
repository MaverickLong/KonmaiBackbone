import { createHash } from 'node:crypto';
import { Router } from 'express';
import { compareNames, type PublicAppView } from 'konmai-shared';
import { App, Holding, Release, ReleaseFile, Variant } from '../db/entities.js';
import type { EntityManager } from '../db/orm.js';
import type { RoutableNodes } from '../routing/routable.js';
import { downloadUrl, iconUrl } from '../urls.js';
import type { Context } from './context.js';

// `routableNodeIds` are the nodes downloads may be redirected to right now; a file none of them
// holds cannot be downloaded yet.
export async function publicCatalogue(
  em: EntityManager,
  publicUrl: string,
  routableNodeIds: ReadonlySet<number>,
): Promise<PublicAppView[]> {
  const releases = await em.find(
    Release,
    { state: 'active', variant: { enabled: true } },
    {
      populate: ['variant', 'variant.app'],
      orderBy: { variant: { slug: 'asc' } },
    },
  );
  const files = await em.find(
    ReleaseFile,
    { release: { $in: releases.map((release) => release.id) } },
    { orderBy: { fileName: 'asc' } },
  );
  const holdings = await em.find(Holding, {
    file: { $in: files.map((file) => file.id) },
    state: 'present',
  });
  const downloadable = new Set(
    holdings
      .filter((holding) => routableNodeIds.has(holding.node.id))
      .map((holding) => holding.file.id),
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
            available: downloadable.has(file.id),
          })),
      },
    });
    apps.set(app.packageName, entry);
  }
  return [...apps.values()].sort((first, second) =>
    compareNames(first.displayName, second.displayName),
  );
}

export interface CatalogueDependencies {
  routable: RoutableNodes;
}

export function catalogueRouter(context: Context, dependencies: CatalogueDependencies): Router {
  const router = Router();
  router.get('/apps', async (request, response) => {
    const routable = await dependencies.routable.list();
    const catalogue = await publicCatalogue(
      context.orm.em,
      context.config.publicUrl,
      new Set(routable.map((node) => node.id)),
    );
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
