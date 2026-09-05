import type { Alerts } from '../alerts/email.js';
import { HealthEvent, Node } from '../db/entities.js';
import type { EntityManager } from '../db/orm.js';
import type { Context } from '../http/context.js';

const attempts = 3;
const timeoutMilliseconds = 10_000;
const emailCoalesceMilliseconds = 120_000;
const staleAgentMilliseconds = 24 * 3_600_000;

export interface ProbeResult {
  healthy: boolean;
  reason: string | null;
}

export async function probeOnce(
  domain: string,
  nodeId: number,
  fetchImplementation = fetch,
): Promise<ProbeResult> {
  let reason = 'unknown';
  for (let attempt = 0; attempt < attempts; attempt++) {
    try {
      const response = await fetchImplementation(`https://${domain}/files/health`, {
        signal: AbortSignal.timeout(timeoutMilliseconds),
        headers: { range: 'bytes=0-63' },
        redirect: 'manual',
      });
      const body = (await response.text()).trim();
      if (response.status !== 200 && response.status !== 206) {
        reason = `HTTP ${response.status}`;
      } else if (body.split(/\s+/)[0] !== String(nodeId)) {
        reason = `health file reports "${body.slice(0, 40)}", expected node ${nodeId}`;
      } else {
        return { healthy: true, reason: null };
      }
    } catch (error) {
      reason =
        error instanceof Error
          ? error.cause instanceof Error
            ? error.cause.message
            : error.message
          : String(error);
    }
  }
  return { healthy: false, reason };
}

export class Prober {
  private timer: NodeJS.Timeout | null = null;
  private readonly lastEmailAt = new Map<number, number>();
  private readonly lastStaleWarningAt = new Map<number, number>();
  private running = false;

  constructor(
    private readonly context: Context,
    private readonly alerts: Alerts,
    private readonly agentConnected: (nodeId: number) => boolean,
  ) {}

  start(): void {
    const interval = this.context.config.probeIntervalMinutes * 60_000;
    this.timer = setInterval(() => void this.probeAll(), interval);
    setTimeout(() => void this.probeAll(), 5_000);
  }

  stop(): void {
    if (this.timer !== null) {
      clearInterval(this.timer);
    }
  }

  async probeAll(): Promise<void> {
    if (this.running) {
      return;
    }
    this.running = true;
    try {
      const em = this.context.orm.em.fork();
      const nodes = await em.find(Node, { enabled: true });
      await Promise.all(nodes.map((node) => this.probe(node.id)));
      await this.warnStaleAgents(em, nodes);
    } catch (error) {
      this.context.logger.error({ error }, 'probe cycle failed');
    } finally {
      this.running = false;
    }
  }

  async probe(nodeId: number): Promise<void> {
    const em = this.context.orm.em.fork();
    const node = await em.findOne(Node, { id: nodeId });
    if (node === null) {
      return;
    }
    const result = await probeOnce(node.domain, node.id);
    const now = new Date();
    if (result.healthy) {
      node.lastHealthyAt = now;
      if (node.status === 'faulty') {
        node.status = 'online';
        await this.transition(
          em,
          node,
          'recovered',
          `node ${node.name} (${node.domain}) is serving again`,
        );
      } else if (node.status === 'unknown') {
        node.status = 'online';
      }
    } else {
      node.lastFailureAt = now;
      node.lastFailureReason = result.reason;
      if (node.status !== 'faulty') {
        node.status = 'faulty';
        await this.transition(
          em,
          node,
          'became_faulty',
          `node ${node.name} (${node.domain}) failed ${attempts} probes: ${result.reason}`,
        );
      }
    }
    await em.flush();
  }

  private async transition(
    em: EntityManager,
    node: Node,
    kind: 'became_faulty' | 'recovered',
    detail: string,
  ): Promise<void> {
    const now = Date.now();
    const recentEmail = now - (this.lastEmailAt.get(node.id) ?? 0) < emailCoalesceMilliseconds;
    let emailSent = false;
    this.context.logger.warn({ nodeId: node.id, kind }, detail);
    if (!recentEmail) {
      const subject =
        kind === 'recovered' ? `node ${node.name} recovered` : `node ${node.name} is DOWN`;
      emailSent = await this.alerts.send(subject, detail);
      this.lastEmailAt.set(node.id, now);
    }
    em.create(HealthEvent, { node, at: new Date(now), kind, detail, emailSent });
  }

  private async warnStaleAgents(em: EntityManager, nodes: Node[]): Promise<void> {
    const now = Date.now();
    for (const node of nodes) {
      if (
        this.agentConnected(node.id) ||
        now - (this.lastStaleWarningAt.get(node.id) ?? 0) < staleAgentMilliseconds
      ) {
        continue;
      }
      const lastConnected = await em.findOne(
        HealthEvent,
        { node, kind: 'agent_connected' },
        { orderBy: { at: 'desc' } },
      );
      const since = lastConnected?.at ?? node.createdAt;
      if (now - since.getTime() < staleAgentMilliseconds) {
        continue;
      }
      this.lastStaleWarningAt.set(node.id, now);
      await this.alerts.send(
        `node ${node.name} agent disconnected for over 24 h`,
        `the agent of ${node.name} (${node.domain}) has not been connected since ${since.toISOString()}; nginx may still be serving but inventory is stale`,
      );
    }
  }
}
