import { Node } from '../db/entities.js';
import type { EntityManager } from '../db/orm.js';
import { periodUsage, quotaView } from '../nodes/quota.js';

export interface RoutableNode {
  id: number;
  domain: string;
  countries: string[];
  catchAll: boolean;
  weight: number;
}

const cacheMilliseconds = 30_000;

// Nodes that may receive redirects right now: enabled, probed healthy, and not exhausted as the
// dashboard's quota view counts it. The quota part needs traffic sums, so the answer is cached
// briefly instead of computed per request.
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
    const routable: RoutableNode[] = [];
    for (const node of nodes) {
      const usage = await periodUsage(em, node, new Date(now));
      const quota = quotaView({
        quotaBytes: node.monthlyQuotaBytes,
        ...usage,
        safetyFraction: this.safetyFraction,
        now: new Date(now),
      });
      if (!quota.exhausted) {
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
