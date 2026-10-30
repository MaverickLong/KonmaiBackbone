import type { Variant } from '../db/entities.js';

export function nextCheckAt(variant: Variant): Date | null {
  if (variant.lastCheckedAt === null || variant.lastCheckedAt === undefined) {
    return null;
  }
  return new Date(variant.lastCheckedAt.getTime() + variant.checkIntervalMinutes * 60_000);
}

// A variant is due when someone asked for a check, when it was never checked, or when its
// interval has passed since the last check.
export function isCheckDue(variant: Variant, now: Date): boolean {
  if (variant.checkRequestedAt !== null && variant.checkRequestedAt !== undefined) {
    return true;
  }
  const next = nextCheckAt(variant);
  return next === null || next.getTime() <= now.getTime();
}
