import { createHash, randomBytes } from 'node:crypto';
import { Router } from 'express';
import {
  nodeCreate,
  nodeListQuery,
  nodeUpdate,
  type NodeCreatedView,
  type NodeDetailView,
  type NodeView,
} from 'konmai-shared';
import { z } from 'zod';
import { HealthEvent, Holding, Node, SyncEvent } from '../../db/entities.js';
import type { EntityManager } from '../../db/orm.js';
import { billingPeriod, periodUsage, quotaView } from '../../nodes/quota.js';
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
  const node = await em.findOne(Node, { id: parse(idParameter, id), deletedAt: null });
  if (node === null) {
    throw notFound('node');
  }
  return node;
}

export async function nodeViews(
  context: Context,
  em: EntityManager,
  nodes: Node[],
  connected: ReadonlySet<number>,
): Promise<NodeView[]> {
  if (nodes.length === 0) {
    return [];
  }
  const now = new Date();
  const held = new Map(
    (
      await em.execute<{ node_id: number; files: number; bytes: number | null }[]>(
        `select node_id, count(*) as files, sum(size_bytes) as bytes from holding
         where state = 'present' and node_id in (${nodes.map(() => '?').join(', ')})
         group by node_id`,
        nodes.map((node) => node.id),
      )
    ).map((row) => [row.node_id, row]),
  );
  return Promise.all(
    nodes.map(async (node) => {
      const usage = await periodUsage(em, node, now);
      return nodeView(node, {
        agentConnected: connected.has(node.id),
        heldFiles: Number(held.get(node.id)?.files ?? 0),
        heldBytes: Number(held.get(node.id)?.bytes ?? 0),
        quota: quotaView({
          quotaBytes: node.monthlyQuotaBytes,
          ...usage,
          safetyFraction: context.config.quotaSafetyFraction,
          now,
        }),
      });
    }),
  );
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
  settingsChanged(node: Node): void;
}

export interface NodeDependencies {
  nodeActions: NodeActions;
  connectedNodeIds(): number[];
}

export function nodesRouter(context: Context, dependencies: NodeDependencies): Router {
  const router = Router();
  const em = () => context.orm.em;
  const actions = dependencies.nodeActions;
  const views = (nodes: Node[]) =>
    nodeViews(context, em(), nodes, new Set(dependencies.connectedNodeIds()));

  router.get('/', async (request, response) => {
    const query = parse(nodeListQuery, request.query);
    const nodes = await em().find(Node, query.includeDeleted ? {} : { deletedAt: null }, {
      orderBy: { name: 'asc' },
    });
    response.json(await views(nodes));
  });

  router.post('/', async (request, response) => {
    const body = parse(nodeCreate, request.body);
    if ((await em().count(Node, { domain: body.domain, deletedAt: null })) > 0) {
      throw conflict('a node with this domain already exists');
    }
    const token = generateToken();
    const node = em().create(Node, {
      ...body,
      status: 'unknown',
      agentVersion: null,
      lastHealthyAt: null,
      lastFailureAt: null,
      lastFailureReason: null,
      usageAdjustmentPeriodStart: null,
      tokenHash: hashToken(token),
      storageTotalBytes: null,
      storageFreeBytes: null,
      deletedAt: null,
    });
    await em().flush();
    const created: NodeCreatedView = {
      node: (await views([node]))[0]!,
      token,
      config: nodeConfigSnippet(context, node, token),
    };
    response.status(201).json(created);
  });

  router.get('/:id', async (request, response) => {
    const node = await loadNode(em(), request.params.id);
    const [view] = await views([node]);
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
      if ((await em().count(Node, { domain: body.domain, deletedAt: null })) > 0) {
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
    const enabling = body.enabled === true && !node.enabled;
    Object.assign(node, body);
    if (enabling) {
      // Nothing probed the node while it was disabled, so its last status says nothing now.
      node.status = 'unknown';
    }
    if (body.enabled === false) {
      actions.disconnect(node);
    }
    await em().flush();
    actions.settingsChanged(node);
    if (enabling) {
      actions.probe(node).catch((error: unknown) => {
        context.logger.warn({ error, nodeId: node.id }, 'probe after enabling failed');
      });
    }
    response.json((await views([node]))[0]);
  });

  router.delete('/:id', async (request, response) => {
    const node = await loadNode(em(), request.params.id);
    actions.disconnect(node);
    // The row stays so that statistics keep naming the node; everything that could route to it
    // or let its agent back in is taken away.
    node.deletedAt = new Date();
    node.enabled = false;
    node.tokenHash = hashToken(generateToken());
    await em().nativeDelete(Holding, { node });
    await em().flush();
    actions.settingsChanged(node);
    response.status(204).end();
  });

  router.post('/:id/token', async (request, response) => {
    const node = await loadNode(em(), request.params.id);
    const token = generateToken();
    node.tokenHash = hashToken(token);
    await em().flush();
    actions.disconnect(node);
    const created: NodeCreatedView = {
      node: (await views([node]))[0]!,
      token,
      config: nodeConfigSnippet(context, node, token),
    };
    response.json(created);
  });

  router.post('/:id/probe', async (request, response) => {
    const node = await loadNode(em(), request.params.id);
    await actions.probe(node);
    const refreshed = await loadNode(em(), node.id);
    response.json((await views([refreshed]))[0]);
  });

  router.post('/:id/resync', async (request, response) => {
    const node = await loadNode(em(), request.params.id);
    response.json({ delivered: await actions.resync(node) });
  });

  return router;
}
