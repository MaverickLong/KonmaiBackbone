import { randomUUID } from 'node:crypto';
import { RequestContext } from '@mikro-orm/core';
import express, { type Express } from 'express';
import { requireAdmin } from './auth.js';
import type { Context } from './context.js';
import { errorHandler } from './errors.js';
import { ingestRouter } from './ingest.js';
import { nodeAuthRouter, storeRouter } from './nodeAuth.js';
import { appsRouter } from './admin/apps.js';
import { nodesRouter, type NodeActions } from './admin/nodes.js';
import { sessionRouter } from './admin/session.js';
import { variantsRouter } from './admin/variants.js';

export interface AppRouters {
  nodeActions: NodeActions;
}

export function createApp(context: Context, routers: AppRouters): Express {
  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', 'loopback');

  app.use((request, response, next) => {
    const requestId = request.header('x-request-id') ?? randomUUID();
    response.setHeader('x-request-id', requestId);
    next();
  });
  app.use((_request, _response, next) => {
    RequestContext.create(context.orm.em, next);
  });
  app.use(express.json({ limit: '1mb' }));

  app.use('/api/admin/session', sessionRouter(context));
  const admin = express.Router();
  admin.use(requireAdmin(context.config.admin));
  admin.use('/apps', appsRouter(context));
  admin.use('/variants', variantsRouter(context));
  admin.use('/nodes', nodesRouter(context, routers.nodeActions));
  app.use('/api/admin', admin);
  app.use('/api/ingest', ingestRouter(context));
  app.use('/api/internal/node-auth', nodeAuthRouter(context));
  app.use('/store', storeRouter(context));
  app.use('/icons', express.static(context.store.iconsDirectory, { maxAge: '1h' }));

  app.use(errorHandler(context.logger));
  return app;
}
