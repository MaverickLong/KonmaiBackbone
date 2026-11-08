import { describe, expect, it } from 'vitest';
import type { Release } from '../db/entities.js';
import { moveRelease } from './lifecycle.js';

function release(state: Release['state'], activatedAt: Date | null = null): Release {
  return { id: 1, state, activatedAt } as Release;
}

describe('moveRelease', () => {
  it('walks a release from ingesting to removal', () => {
    const subject = release('ingesting');
    moveRelease(subject, 'active');
    expect(subject.state).toBe('active');
    expect(subject.activatedAt).toBeInstanceOf(Date);
    moveRelease(subject, 'retained');
    moveRelease(subject, 'deleting');
    expect(subject.state).toBe('deleting');
  });

  it('keeps the first activation time when a retained release becomes active again', () => {
    const activatedAt = new Date('2026-01-01T00:00:00Z');
    const subject = release('retained', activatedAt);
    moveRelease(subject, 'active');
    expect(subject.activatedAt).toBe(activatedAt);
  });

  it('lets an unfinished ingest be deleted', () => {
    const subject = release('ingesting');
    moveRelease(subject, 'deleting');
    expect(subject.state).toBe('deleting');
    expect(subject.activatedAt).toBeNull();
  });

  it('refuses to skip a step or revive a deleted release', () => {
    expect(() => moveRelease(release('ingesting'), 'retained')).toThrow(
      'cannot move from ingesting to retained',
    );
    expect(() => moveRelease(release('active'), 'active')).toThrow();
    expect(() => moveRelease(release('deleting'), 'active')).toThrow();
  });
});
