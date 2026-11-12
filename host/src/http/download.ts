import { Router } from 'express';
import {
  fileName as fileNameSchema,
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

// How long a client is told to wait when no node can serve a file yet; nodes usually have a new
// release within a minute or two.
const retryAfterSeconds = 60;
const notDistributedMessage = [
  'This file is still being copied to the download servers. Please try again in a minute or two.',
  '文件正在同步到下载节点，请一两分钟后再试。',
  '',
].join('\n');

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
    if (chosen === null) {
      // The host never serves users itself: when a release has just come in, its bandwidth is
      // what the nodes fetch the release with, and a rush of users would starve them.
      response.setHeader('retry-after', String(retryAfterSeconds));
      response.status(503).type('text/plain').send(notDistributedMessage);
      return;
    }
    response.redirect(302, nodeFileUrl(chosen.domain, locator));

    const record = context.orm.em.fork();
    record.create(Download, { file, node: chosen.id, country, at: new Date() });
    record
      .flush()
      .catch((error: unknown) => context.logger.error({ error }, 'recording download failed'));
  });

  return router;
}
