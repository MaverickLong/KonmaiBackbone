import { Router, type RequestHandler } from 'express';
import {
  fileName as fileNameSchema,
  packageName as packageNameSchema,
  slug,
  version,
} from 'konmai-shared';
import { z } from 'zod';
import { Node } from '../db/entities.js';
import { hashToken } from './admin/nodes.js';
import { bearerToken } from './auth.js';
import type { Context } from './context.js';
import { notFound, parse, unauthorized } from './errors.js';

const storeParameters = z.object({
  packageName: packageNameSchema,
  variant: slug,
  version,
  fileName: fileNameSchema,
});

function requireNodeToken(context: Context): RequestHandler {
  return async (request, _response, next) => {
    const token = bearerToken(request.header('authorization'));
    const node =
      token === null
        ? null
        : await context.orm.em.findOne(Node, { tokenHash: hashToken(token), enabled: true });
    next(node === null ? unauthorized() : undefined);
  };
}

// `GET /api/internal/node-auth` backs nginx's `auth_request` for `/store/`; the `/store/` route
// itself only serves files when the host runs without nginx (development).
export function nodeAuthRouter(context: Context): Router {
  const router = Router();
  router.get('/', requireNodeToken(context), (_request, response) => {
    response.status(204).end();
  });
  return router;
}

export function storeRouter(context: Context): Router {
  const router = Router();
  router.get(
    '/:packageName/:variant/:version/:fileName',
    requireNodeToken(context),
    (request, response) => {
      const locator = parse(storeParameters, request.params);
      const filePath = context.store.storedFilePath(locator);
      response.sendFile(filePath, { dotfiles: 'deny' }, (error) => {
        if (error) {
          response.headersSent ? response.end() : response.status(404).json(notFound('file'));
        }
      });
    },
  );
  router.use((_request, _response, next) => next(notFound('file')));
  return router;
}
