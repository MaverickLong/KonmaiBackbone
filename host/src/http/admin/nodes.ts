import { createHash, randomBytes } from 'node:crypto';
import { Router } from 'express';
import {
  nodeCreate,
  nodeUpdate,
  type NodeCreatedView,
  type NodeDetailView,
  type NodeView,
} from 'konmai-shared';
import { z } from 'zod';
import { HealthEvent, Holding, Node, SyncEvent, Traffic } from '../../db/entities.js';
import type { EntityManager } from '../../db/orm.js';
import { billingPeriod, quotaView } from '../../nodes/quota.js';
import { healthEventView, holdingView, nodeView, syncEventView } from '../../views.js';
import type { Context } from '../context.js';
import { conflict, notFound, parse } from '../errors.js';

const idParameter = z.coerce.number().int().positive();

export function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

function generateToken(): string {
  return randomBytes(32).toString('base64url');
}

export async function loadNode(em: EntityManager, id: string | number): Promise<Node> {
  const node = await em.findOne(Node, { id: parse(idParameter, id) });
  if (node === null) {
    throw notFound('node');
  }
  return node;
}

export async function nodeViews(
  context: Context,
  em: EntityManager,
  nodes: Node[],
): Promise<NodeView[]> {
  const now = new Date();
  const ids = nodes.map((node) => node.id);
  const holdings = await em.find(Holding, { node: { $in: ids }, state: 'present' });
  const earliestStart = nodes
    .map((node) => billingPeriod(node.quotaResetDay, node.timezone, now).start)
    .reduce((earliest, start) => (start < earliest ? start : earliest), now);
  const traffic = await em.find(Traffic, {
    node: { $in: ids },
    hourStart: { $gte: earliestStart },
  });
  return nodes.map((node) => {
    const period = billingPeriod(node.quotaResetDay, node.timezone, now);
    const buckets = traffic.filter(
      (bucket) =>
        bucket.node.id === node.id &&
        bucket.hourStart >= period.start &&
        bucket.hourStart < period.end,
    );
    const held = holdings.filter((holding) => holding.node.id === node.id);
    const adjustmentApplies =
      node.usageAdjustmentPeriodStart !== null &&
      node.usageAdjustmentPeriodStart !== undefined &&
      node.usageAdjustmentPeriodStart.getTime() === period.start.getTime();
    return nodeView(node, {
      heldFiles: held.length,
      heldBytes: held.reduce((sum, holding) => sum + holding.sizeBytes, 0),
      quota: quotaView({
        quotaBytes: node.monthlyQuotaBytes,
        egressBytes: buckets.reduce((sum, bucket) => sum + bucket.egressBytes, 0),
        ingressBytes: buckets.reduce((sum, bucket) => sum + bucket.ingressBytes, 0),
        adjustmentBytes: adjustmentApplies ? node.usageAdjustmentBytes : 0,
        safetyFraction: context.config.quotaSafetyFraction,
        period,
        now,
      }),
    });
  });
}

export function nodeConfigSnippet(
  context: Context,
  node: Node,
  token: string,
): Record<string, unknown> {
  return {
    nodeId: node.id,
    token,
    hostUrl: context.config.publicUrl,
    storageDirectory: '/srv/konmai/files',
    databasePath: '/srv/konmai/node.sqlite',
    maxStorageBytes: null,
    minFreeBytes: 2_147_483_648,
    fetchConcurrency: 1,
    syslog: { host: '127.0.0.1', port: 5140 },
    logLevel: 'info',
  };
}

export interface NodeActions {
  probe(node: Node): Promise<void>;
  resync(node: Node): Promise<boolean>;
  disconnect(node: Node): void;
}

export function nodesRouter(context: Context, actions: NodeActions): Router {
  const router = Router();
  const em = () => context.orm.em;

  router.get('/', async (_request, response) => {
    const nodes = await em().find(Node, {}, { orderBy: { name: 'asc' } });
    response.json(await nodeViews(context, em(), nodes));
  });

  router.post('/', async (request, response) => {
    const body = parse(nodeCreate, request.body);
    if ((await em().count(Node, { domain: body.domain })) > 0) {
      throw conflict('a node with this domain already exists');
    }
    const token = generateToken();
    const node = em().create(Node, {
      ...body,
      status: 'unknown',
      agentConnected: false,
      agentVersion: null,
      lastHealthyAt: null,
      lastFailureAt: null,
      lastFailureReason: null,
      usageAdjustmentPeriodStart: null,
      tokenHash: hashToken(token),
      storageTotalBytes: null,
      storageFreeBytes: null,
    });
    await em().flush();
    const created: NodeCreatedView = {
      node: (await nodeViews(context, em(), [node]))[0]!,
      token,
      config: nodeConfigSnippet(context, node, token),
    };
    response.status(201).json(created);
  });

  router.get('/:id', async (request, response) => {
    const node = await loadNode(em(), request.params.id);
    const [view] = await nodeViews(context, em(), [node]);
    const holdings = await em().find(
      Holding,
      { node },
      { populate: ['file', 'file.release', 'file.release.variant', 'file.release.variant.app'] },
    );
    const healthEvents = await em().find(
      HealthEvent,
      { node },
      { orderBy: { at: 'desc' }, limit: 100 },
    );
    const syncEvents = await em().find(
      SyncEvent,
      { node },
      { orderBy: { at: 'desc' }, limit: 100 },
    );
    const detail: NodeDetailView = {
      ...view!,
      holdings: holdings.map(holdingView),
      healthEvents: healthEvents.map(healthEventView),
      syncEvents: syncEvents.map(syncEventView),
    };
    response.json(detail);
  });

  router.patch('/:id', async (request, response) => {
    const node = await loadNode(em(), request.params.id);
    const body = parse(nodeUpdate, request.body);
    if (body.domain !== undefined && body.domain !== node.domain) {
      if ((await em().count(Node, { domain: body.domain })) > 0) {
        throw conflict('a node with this domain already exists');
      }
    }
    if (body.usageAdjustmentBytes !== undefined) {
      node.usageAdjustmentPeriodStart = billingPeriod(
        body.quotaResetDay ?? node.quotaResetDay,
        body.timezone ?? node.timezone,
        new Date(),
      ).start;
    }
    Object.assign(node, body);
    if (body.enabled === false) {
      actions.disconnect(node);
    }
    await em().flush();
    response.json((await nodeViews(context, em(), [node]))[0]);
  });

  router.delete('/:id', async (request, response) => {
    const node = await loadNode(em(), request.params.id);
    actions.disconnect(node);
    em().remove(node);
    await em().flush();
    response.status(204).end();
  });

  router.post('/:id/token', async (request, response) => {
    const node = await loadNode(em(), request.params.id);
    const token = generateToken();
    node.tokenHash = hashToken(token);
    await em().flush();
    actions.disconnect(node);
    const created: NodeCreatedView = {
      node: (await nodeViews(context, em(), [node]))[0]!,
      token,
      config: nodeConfigSnippet(context, node, token),
    };
    response.json(created);
  });

  router.post('/:id/probe', async (request, response) => {
    const node = await loadNode(em(), request.params.id);
    await actions.probe(node);
    const refreshed = await loadNode(em(), node.id);
    response.json((await nodeViews(context, em(), [refreshed]))[0]);
  });

  router.post('/:id/resync', async (request, response) => {
    const node = await loadNode(em(), request.params.id);
    response.json({ delivered: await actions.resync(node) });
  });

  return router;
}
