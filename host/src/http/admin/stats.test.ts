import { describe, expect, it } from 'vitest';
import type { DownloaderState } from '../../db/entities.js';
import { downloaderView } from './stats.js';

const now = new Date('2026-11-09T00:00:00Z');

function state(lastSeenAt: Date | null): DownloaderState {
  return {
    id: 1,
    lastSeenAt,
    phase: 'downloading',
    currentVariantId: 3,
    passStartedAt: null,
    passFinishedAt: null,
    passSummary: null,
  } as DownloaderState;
}

describe('downloaderView', () => {
  it('shows the reported phase while heartbeats keep coming', () => {
    expect(downloaderView(state(new Date(now.getTime() - 60_000)), now).phase).toBe('downloading');
  });

  it('shows offline once heartbeats stop, whatever the last phase was', () => {
    expect(downloaderView(state(new Date(now.getTime() - 11 * 60_000)), now).phase).toBe('offline');
    expect(downloaderView(state(null), now).phase).toBe('offline');
  });
});
