import type { QuotaView } from 'konmai-shared';

export interface BillingPeriod {
  start: Date;
  end: Date;
}

interface WallClock {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
}

function wallClock(instant: Date, timezone: string): WallClock {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    hourCycle: 'h23',
    year: 'numeric',
    month: 'numeric',
    day: 'numeric',
    hour: 'numeric',
    minute: 'numeric',
    second: 'numeric',
  }).formatToParts(instant);
  const value = (type: string): number =>
    Number(parts.find((part) => part.type === type)?.value ?? '0');
  return {
    year: value('year'),
    month: value('month'),
    day: value('day'),
    hour: value('hour'),
    minute: value('minute'),
    second: value('second'),
  };
}

// Converts a wall-clock midnight in `timezone` to an instant by measuring the zone offset at
// that instant (twice, so a DST change on the boundary resolves correctly).
export function zonedMidnight(year: number, month: number, day: number, timezone: string): Date {
  let guess = Date.UTC(year, month - 1, day);
  for (let pass = 0; pass < 2; pass++) {
    const local = wallClock(new Date(guess), timezone);
    const asUtc = Date.UTC(
      local.year,
      local.month - 1,
      local.day,
      local.hour,
      local.minute,
      local.second,
    );
    guess -= asUtc - Date.UTC(year, month - 1, day);
  }
  return new Date(guess);
}

function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

function resetInstant(year: number, month: number, resetDay: number, timezone: string): Date {
  return zonedMidnight(year, month, Math.min(resetDay, daysInMonth(year, month)), timezone);
}

export function billingPeriod(resetDay: number, timezone: string, now: Date): BillingPeriod {
  const local = wallClock(now, timezone);
  const thisMonth = resetInstant(local.year, local.month, resetDay, timezone);
  if (thisMonth.getTime() <= now.getTime()) {
    const nextMonth =
      local.month === 12
        ? { year: local.year + 1, month: 1 }
        : { year: local.year, month: local.month + 1 };
    return {
      start: thisMonth,
      end: resetInstant(nextMonth.year, nextMonth.month, resetDay, timezone),
    };
  }
  const previous =
    local.month === 1
      ? { year: local.year - 1, month: 12 }
      : { year: local.year, month: local.month - 1 };
  return { start: resetInstant(previous.year, previous.month, resetDay, timezone), end: thisMonth };
}

export interface QuotaInput {
  quotaBytes: number;
  egressBytes: number;
  ingressBytes: number;
  adjustmentBytes: number;
  safetyFraction: number;
  period: BillingPeriod;
  now: Date;
}

export function quotaView(input: QuotaInput): QuotaView {
  const usedBytes = Math.max(0, input.egressBytes + input.ingressBytes + input.adjustmentBytes);
  const elapsed = input.now.getTime() - input.period.start.getTime();
  const length = input.period.end.getTime() - input.period.start.getTime();
  const elapsedFraction = Math.min(1, Math.max(elapsed / length, 1 / length));
  const projectedPeriodBytes = Math.round(usedBytes / elapsedFraction);
  const exhausted = usedBytes >= input.quotaBytes * input.safetyFraction;
  let projectedExhaustionAt: string | null = null;
  if (!exhausted && projectedPeriodBytes > input.quotaBytes && usedBytes > 0) {
    const rate = usedBytes / Math.max(elapsed, 1);
    projectedExhaustionAt = new Date(
      input.period.start.getTime() + input.quotaBytes / rate,
    ).toISOString();
  } else if (exhausted) {
    projectedExhaustionAt = input.now.toISOString();
  }
  return {
    periodStart: input.period.start.toISOString(),
    periodEnd: input.period.end.toISOString(),
    quotaBytes: input.quotaBytes,
    usedBytes,
    egressBytes: input.egressBytes,
    ingressBytes: input.ingressBytes,
    adjustmentBytes: input.adjustmentBytes,
    remainingBytes: Math.max(0, input.quotaBytes - usedBytes),
    exhausted,
    projectedPeriodBytes,
    projectedExhaustionAt,
  };
}
