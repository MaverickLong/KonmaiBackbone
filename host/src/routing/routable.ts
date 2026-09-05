import { Node, Traffic } from '../db/entities.js';
import type { EntityManager } from '../db/orm.js';
import { billingPeriod } from '../nodes/quota.js';

export interface RoutableNode {
  id: number;
  domain: string;
  countries: string[];
  catchAll: boolean;
  weight: number;
}

const cacheMilliseconds = 30_000;

// Nodes that may receive redirects right now: enabled, probed healthy, and under quota. The
// quota part needs traffic sums, so the answer is cached briefly instead of computed per request.
export class RoutableNodes {
  private cached: { at: number; nodes: RoutableNode[] } | null = null;

  constructor(
    private readonly em: () => EntityManager,
    private readonly safetyFraction: number,
  ) {}

  invalidate(): void {
    this.cached = null;
  }

  async list(): Promise<RoutableNode[]> {
    const now = Date.now();
    if (this.cached !== null && now - this.cached.at < cacheMilliseconds) {
      return this.cached.nodes;
    }
    const em = this.em();
    const nodes = await em.find(Node, { enabled: true, status: 'online' });
    const periods = new Map(
      nodes.map((node) => [
        node.id,
        billingPeriod(node.quotaResetDay, node.timezone, new Date(now)),
      ]),
    );
    const earliest = [...periods.values()].reduce(
      (min, period) => (period.start < min ? period.start : min),
      new Date(now),
    );
    const traffic = await em.find(Traffic, {
      node: { $in: nodes.map((node) => node.id) },
      hourStart: { $gte: earliest },
    });
    const routable: RoutableNode[] = [];
    for (const node of nodes) {
      const period = periods.get(node.id)!;
      let used = traffic
        .filter(
          (bucket) =>
            bucket.node.id === node.id &&
            bucket.hourStart >= period.start &&
            bucket.hourStart < period.end,
        )
        .reduce((sum, bucket) => sum + bucket.egressBytes + bucket.ingressBytes, 0);
      if (node.usageAdjustmentPeriodStart?.getTime() === period.start.getTime()) {
        used += node.usageAdjustmentBytes;
      }
      if (used < node.monthlyQuotaBytes * this.safetyFraction) {
        routable.push({
          id: node.id,
          domain: node.domain,
          countries: node.countries,
          catchAll: node.catchAll,
          weight: node.weight,
        });
      }
    }
    this.cached = { at: now, nodes: routable };
    return routable;
  }
}
