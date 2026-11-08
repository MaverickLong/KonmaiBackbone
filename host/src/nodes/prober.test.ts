import { describe, expect, it } from 'vitest';
import { nextHealth, probeOnce } from './prober.js';

describe('nextHealth', () => {
  it('brings a new node online without an event', () => {
    expect(nextHealth('unknown', true)).toEqual({ status: 'online', event: null });
    expect(nextHealth('online', true)).toEqual({ status: 'online', event: null });
  });

  it('reports a failure once and a recovery once', () => {
    expect(nextHealth('unknown', false)).toEqual({ status: 'faulty', event: 'became_faulty' });
    expect(nextHealth('online', false)).toEqual({ status: 'faulty', event: 'became_faulty' });
    expect(nextHealth('faulty', false)).toEqual({ status: 'faulty', event: null });
    expect(nextHealth('faulty', true)).toEqual({ status: 'online', event: 'recovered' });
  });
});

describe('probeOnce', () => {
  it('accepts a health file that names the node', async () => {
    const fetchImplementation = async () => new Response('7 0.1.0\n', { status: 206 });
    expect(await probeOnce('node.example', 7, fetchImplementation as typeof fetch)).toEqual({
      healthy: true,
      reason: null,
    });
  });

  it('tries three times and keeps the last reason', async () => {
    let calls = 0;
    const fetchImplementation = async () => {
      calls++;
      return new Response('9 0.1.0', { status: 200 });
    };
    expect(await probeOnce('node.example', 7, fetchImplementation as typeof fetch)).toEqual({
      healthy: false,
      reason: 'health file reports "9 0.1.0", expected node 7',
    });
    expect(calls).toBe(3);
  });
});
