import { describe, expect, it } from 'vitest';
import { selectNode } from './selector.js';

const nodes = [
  { id: 1, countries: ['JP'], catchAll: false, weight: 100 },
  { id: 2, countries: ['US'], catchAll: true, weight: 100 },
  { id: 3, countries: ['DE'], catchAll: false, weight: 300 },
];

describe('selectNode', () => {
  it('prefers a node serving the client country', () => {
    expect(selectNode(nodes, 'JP')?.id).toBe(1);
  });

  it('falls back to catch-all nodes, then to anyone', () => {
    expect(selectNode(nodes, 'FR')?.id).toBe(2);
    expect(selectNode(nodes, null)?.id).toBe(2);
    const withoutCatchAll = nodes.map((node) => ({ ...node, catchAll: false }));
    expect(selectNode(withoutCatchAll, 'FR', () => 0.999)?.id).toBe(3);
    expect(selectNode([], 'JP')).toBeNull();
  });

  it('weights the random pick', () => {
    const pool = [
      { id: 1, countries: [], catchAll: false, weight: 100 },
      { id: 2, countries: [], catchAll: false, weight: 300 },
    ];
    expect(selectNode(pool, null, () => 0.1)?.id).toBe(1);
    expect(selectNode(pool, null, () => 0.3)?.id).toBe(2);
    expect(selectNode(pool, null, () => 0.99)?.id).toBe(2);
  });
});
