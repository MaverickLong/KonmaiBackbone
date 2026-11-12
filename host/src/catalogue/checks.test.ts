import { describe, expect, it } from 'vitest';
import type { Variant } from '../db/entities.js';
import { isCheckDue, nextCheckAt, recordCheckResult } from './checks.js';

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

describe('check results', () => {
  const now = new Date('2026-11-09T12:00:00Z');
  const playVariant = (fields: Partial<Variant> = {}) =>
    variant({
      source: { type: 'googleplay', device: 'walleye' },
      lastCheckStatus: 'up_to_date',
      checkRequestedAt: now,
      ...fields,
    });

  it('saves the device and account the check worked with', () => {
    const checked = playVariant();
    const alert = recordCheckResult(
      checked,
      {
        status: 'up_to_date',
        alert: false,
        compatibility: { device: 'crackling', account: 'a@gmail.com' },
      },
      now,
    );
    expect(alert).toBe(false);
    expect(checked.source).toEqual({
      type: 'googleplay',
      device: 'crackling',
      account: 'a@gmail.com',
    });
    expect(checked.checkRequestedAt).toBeNull();
    expect(checked.lastCheckedAt).toBe(now);
  });

  it('leaves other sources alone', () => {
    const checked = variant({ source: { type: 'arcaea' } });
    recordCheckResult(
      checked,
      {
        status: 'updated',
        alert: false,
        compatibility: { device: 'walleye', account: 'a@gmail.com' },
      },
      now,
    );
    expect(checked.source).toEqual({ type: 'arcaea' });
  });

  it('alerts once when a failure that needs the operator begins', () => {
    const checked = playVariant();
    const failure = {
      status: 'failed',
      alert: true,
      error: 'walleye/main: item not found',
    } as const;
    expect(recordCheckResult(checked, failure, now)).toBe(true);
    expect(checked.lastCheckError).toBe('walleye/main: item not found');
    expect(recordCheckResult(checked, failure, now)).toBe(false);
    recordCheckResult(checked, { status: 'up_to_date', alert: false }, now);
    expect(checked.lastCheckError).toBeNull();
    expect(recordCheckResult(checked, failure, now)).toBe(true);
    expect(recordCheckResult(playVariant(), { ...failure, alert: false }, now)).toBe(false);
  });
});
