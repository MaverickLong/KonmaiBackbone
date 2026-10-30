import { describe, expect, it } from 'vitest';
import type { Variant } from '../db/entities.js';
import { isCheckDue, nextCheckAt } from './checks.js';

function variant(fields: Partial<Variant>): Variant {
  return {
    checkIntervalMinutes: 30,
    checkRequestedAt: null,
    lastCheckedAt: null,
    ...fields,
  } as Variant;
}

describe('check schedule', () => {
  const now = new Date('2026-10-30T12:00:00Z');

  it('checks a variant that was never checked', () => {
    expect(isCheckDue(variant({}), now)).toBe(true);
    expect(nextCheckAt(variant({}))).toBeNull();
  });

  it('waits for the interval after the last check', () => {
    const checked = variant({ lastCheckedAt: new Date('2026-10-30T11:45:00Z') });
    expect(nextCheckAt(checked)?.toISOString()).toBe('2026-10-30T12:15:00.000Z');
    expect(isCheckDue(checked, now)).toBe(false);
    expect(isCheckDue(checked, new Date('2026-10-30T12:15:00Z'))).toBe(true);
  });

  it('checks right away when a check was requested', () => {
    const requested = variant({
      lastCheckedAt: new Date('2026-10-30T11:59:00Z'),
      checkRequestedAt: new Date('2026-10-30T11:59:30Z'),
    });
    expect(isCheckDue(requested, now)).toBe(true);
  });
});
