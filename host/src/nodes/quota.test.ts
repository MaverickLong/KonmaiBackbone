import { describe, expect, it } from 'vitest';
import { billingPeriod, quotaView, zonedMidnight } from './quota.js';

describe('billingPeriod', () => {
  it('clamps the reset day to the month length', () => {
    const period = billingPeriod(31, 'UTC', new Date('2026-02-10T12:00:00Z'));
    expect(period.start.toISOString()).toBe('2026-01-31T00:00:00.000Z');
    expect(period.end.toISOString()).toBe('2026-02-28T00:00:00.000Z');
  });

  it('starts the period in the previous month before the reset day', () => {
    const period = billingPeriod(15, 'UTC', new Date('2026-03-10T00:00:00Z'));
    expect(period.start.toISOString()).toBe('2026-02-15T00:00:00.000Z');
    expect(period.end.toISOString()).toBe('2026-03-15T00:00:00.000Z');
  });

  it('starts the period on the reset day itself', () => {
    const period = billingPeriod(1, 'UTC', new Date('2026-03-01T00:00:00Z'));
    expect(period.start.toISOString()).toBe('2026-03-01T00:00:00.000Z');
    expect(period.end.toISOString()).toBe('2026-04-01T00:00:00.000Z');
  });

  it('uses the node timezone for midnight', () => {
    expect(zonedMidnight(2026, 3, 1, 'Asia/Tokyo').toISOString()).toBe('2026-02-28T15:00:00.000Z');
    const period = billingPeriod(1, 'Asia/Tokyo', new Date('2026-02-28T20:00:00Z'));
    expect(period.start.toISOString()).toBe('2026-02-28T15:00:00.000Z');
  });

  it('handles daylight saving boundaries', () => {
    expect(zonedMidnight(2026, 3, 29, 'Europe/Berlin').toISOString()).toBe(
      '2026-03-28T23:00:00.000Z',
    );
    expect(zonedMidnight(2026, 3, 30, 'Europe/Berlin').toISOString()).toBe(
      '2026-03-29T22:00:00.000Z',
    );
  });
});

describe('quotaView', () => {
  const period = { start: new Date('2026-03-01T00:00:00Z'), end: new Date('2026-04-01T00:00:00Z') };

  it('projects usage linearly and flags exhaustion', () => {
    const view = quotaView({
      quotaBytes: 1000,
      egressBytes: 400,
      ingressBytes: 100,
      adjustmentBytes: 0,
      safetyFraction: 0.97,
      period,
      now: new Date('2026-03-16T12:00:00Z'),
    });
    expect(view.usedBytes).toBe(500);
    expect(view.remainingBytes).toBe(500);
    expect(view.projectedPeriodBytes).toBe(1000);
    expect(view.exhausted).toBe(false);
    expect(view.projectedExhaustionAt).toBeNull();
  });

  it('predicts the exhaustion date when the pace is too high', () => {
    const view = quotaView({
      quotaBytes: 1000,
      egressBytes: 800,
      ingressBytes: 0,
      adjustmentBytes: 0,
      safetyFraction: 0.97,
      period,
      now: new Date('2026-03-11T00:00:00Z'),
    });
    expect(view.projectedExhaustionAt).toBe('2026-03-13T12:00:00.000Z');
    const exhausted = quotaView({
      ...view,
      adjustmentBytes: 200,
      safetyFraction: 0.97,
      period,
      now: new Date('2026-03-11T00:00:00Z'),
    });
    expect(exhausted.exhausted).toBe(true);
  });
});
