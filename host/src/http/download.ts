import { Router } from 'express';
import {
  fileName as fileNameSchema,
  fileUrlPath,
  packageName as packageNameSchema,
  slug,
  version as versionSchema,
} from 'konmai-shared';
import { z } from 'zod';
import { Download, Holding, Release, ReleaseFile, Variant } from '../db/entities.js';
import type { GeoIp } from '../routing/geoip.js';
import type { RoutableNodes } from '../routing/routable.js';
import { selectNode } from '../routing/selector.js';
import { nodeFileUrl } from '../urls.js';
import type { Context } from './context.js';
import { notFound, parse } from './errors.js';

const parameters = z.object({
  packageName: packageNameSchema,
  variant: slug,
  version: z.union([z.literal('latest'), versionSchema]),
  fileName: fileNameSchema,
});

export interface DownloadDependencies {
  geoip: GeoIp;
  routable: RoutableNodes;
}

export function downloadRouter(context: Context, dependencies: DownloadDependencies): Router {
  const router = Router();

  router.get('/:packageName/:variant/:version/:fileName', async (request, response) => {
    const em = context.orm.em;
    const params = parse(parameters, request.params);
    const variant = await em.findOne(Variant, {
      app: params.packageName,
      slug: params.variant,
      enabled: true,
    });
    if (variant === null) {
      throw notFound('file');
    }
    const release = await em.findOne(
      Release,
      params.version === 'latest'
        ? { variant, state: 'active' }
        : { variant, version: params.version, state: { $in: ['active', 'retained'] } },
    );
    if (release === null) {
      throw notFound('file');
    }
    const file = await em.findOne(ReleaseFile, { release, fileName: params.fileName });
    if (file === null) {
      throw notFound('file');
    }
    const locator = {
      packageName: params.packageName,
      variant: params.variant,
      version: release.version,
      fileName: file.fileName,
    };

    const country = dependencies.geoip.country(request.ip ?? '');
    const holders = new Set(
      (await em.find(Holding, { file, state: 'present' })).map((holding) => holding.node.id),
    );
    const candidates = (await dependencies.routable.list()).filter((node) => holders.has(node.id));
    const chosen = selectNode(candidates, country);

    response.setHeader('cache-control', 'no-store');
    if (chosen !== null) {
      response.redirect(302, nodeFileUrl(chosen.domain, locator));
    } else if (context.config.behindNginx) {
      response.setHeader('x-accel-redirect', `/internal/store/${fileUrlPath(locator)}`);
      response.status(200).end();
    } else {
      response.sendFile(context.store.storedFilePath(locator), { dotfiles: 'deny' });
    }

    const record = context.orm.em.fork();
    record.create(Download, { file, node: chosen?.id ?? null, country, at: new Date() });
    record
      .flush()
      .catch((error: unknown) => context.logger.error({ error }, 'recording download failed'));
  });

  return router;
}
