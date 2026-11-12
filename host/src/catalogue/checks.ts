import type { CheckResult } from 'konmai-shared';
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

// Applies what the downloader reported. Returns whether the operator should be e-mailed: only when
// a failure the downloader cannot get past begins, not again while it keeps failing.
export function recordCheckResult(variant: Variant, result: CheckResult, now: Date): boolean {
  const failingBefore = variant.lastCheckStatus === 'failed';
  variant.lastCheckedAt = now;
  variant.lastCheckStatus = result.status;
  variant.lastCheckError = result.status === 'failed' ? (result.error ?? 'unknown error') : null;
  variant.checkRequestedAt = null;
  if (result.compatibility !== undefined && variant.source.type === 'googleplay') {
    variant.source = { ...variant.source, ...result.compatibility };
  }
  return result.status === 'failed' && result.alert && !failingBefore;
}
