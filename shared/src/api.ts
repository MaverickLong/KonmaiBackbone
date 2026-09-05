import { z } from 'zod';
import {
  countryCode,
  fileKind,
  fileName,
  packageName,
  sha256,
  slug,
  source,
  version,
} from './catalogue.js';

export const errorCodes = ['VALIDATION', 'UNAUTHORIZED', 'NOT_FOUND', 'CONFLICT', 'INTERNAL'] as const;
export type ErrorCode = (typeof errorCodes)[number];

export interface ErrorResponse {
  error: { code: ErrorCode; message: string; details?: unknown };
}

const timezone = z.string().refine((value) => {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: value });
    return true;
  } catch {
    return false;
  }
}, 'unknown timezone');

export const login = z.object({ password: z.string().min(1) });

export const appCreate = z.object({
  packageName,
  displayName: z.string().trim().min(1).max(200),
});
export const appUpdate = z.object({ displayName: z.string().trim().min(1).max(200) });

export const variantCreate = z.object({
  slug,
  name: z.string().trim().min(1).max(200),
  source,
  enabled: z.boolean().default(true),
});
export const variantUpdate = z.object({
  name: z.string().trim().min(1).max(200).optional(),
  source: source.optional(),
  enabled: z.boolean().optional(),
});

export const variantSelections = ['all', 'allowlist'] as const;
export const variantSelection = z.enum(variantSelections);

const nodeFields = {
  name: z.string().trim().min(1).max(100),
  domain: z
    .string()
    .trim()
    .toLowerCase()
    .regex(/^(?=.{1,253}$)([a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/, 'expected a hostname'),
  countries: z.array(countryCode).max(250),
  catchAll: z.boolean(),
  weight: z.number().int().min(1).max(10000),
  enabled: z.boolean(),
  monthlyQuotaBytes: z.number().int().positive(),
  quotaResetDay: z.number().int().min(1).max(31),
  timezone,
  usageAdjustmentBytes: z.number().int(),
  variantSelection,
  allowedVariants: z.array(z.number().int().positive()),
};

export const nodeCreate = z.object({
  ...nodeFields,
  countries: nodeFields.countries.default([]),
  catchAll: nodeFields.catchAll.default(false),
  weight: nodeFields.weight.default(100),
  enabled: nodeFields.enabled.default(true),
  timezone: timezone.default('UTC'),
  usageAdjustmentBytes: nodeFields.usageAdjustmentBytes.default(0),
  variantSelection: nodeFields.variantSelection.default('all'),
  allowedVariants: nodeFields.allowedVariants.default([]),
});
export const nodeUpdate = z.object(nodeFields).partial();

export const ingestFile = z.object({
  path: z.string().min(1),
  fileName,
  kind: fileKind,
  sizeBytes: z.number().int().nonnegative(),
  sha256,
});
export const ingestRelease = z.object({
  packageName,
  variant: slug,
  version,
  versionCode: z.number().int().nullable().default(null),
  files: z.array(ingestFile).min(1),
});
export type IngestRelease = z.infer<typeof ingestRelease>;

export const checkStatuses = ['up_to_date', 'updated', 'failed'] as const;
export const checkStatus = z.enum(checkStatuses);
export const checkResult = z.object({
  status: checkStatus,
  error: z.string().max(4000).optional(),
  remoteVersion: z.string().max(200).optional(),
  remoteVersionCode: z.number().int().optional(),
});

export const downloaderPhases = ['idle', 'checking', 'downloading'] as const;
export const downloaderPhase = z.enum(downloaderPhases);
export const downloaderHeartbeat = z.object({
  phase: downloaderPhase,
  variantId: z.number().int().positive().nullable().default(null),
  passStartedAt: z.iso.datetime().nullable().default(null),
  passFinishedAt: z.iso.datetime().nullable().default(null),
  passSummary: z.string().max(4000).nullable().default(null),
});

export const downloadGroupings = ['day', 'variant', 'node', 'country'] as const;
export const downloadGrouping = z.enum(downloadGroupings);
export const dateRange = z.object({
  from: z.iso.datetime().optional(),
  to: z.iso.datetime().optional(),
});
export const downloadStatsQuery = dateRange.extend({ groupBy: downloadGrouping.default('day') });
export const trafficStatsQuery = dateRange.extend({
  nodeId: z.coerce.number().int().positive().optional(),
  resolution: z.enum(['hour', 'day']).default('day'),
});
export const eventsQuery = z.object({
  kind: z.enum(['health', 'sync']).optional(),
  nodeId: z.coerce.number().int().positive().optional(),
  limit: z.coerce.number().int().min(1).max(500).default(100),
  before: z.iso.datetime().optional(),
});
