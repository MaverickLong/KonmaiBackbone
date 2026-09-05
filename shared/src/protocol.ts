import { z } from 'zod';
import { fileName, packageName, releaseState, sha256, slug, version } from './catalogue.js';

export const protocolVersion = 1;
export const protocolHeader = 'x-konmai-protocol';

const storageReport = z.object({
  totalBytes: z.number().int().nonnegative(),
  freeBytes: z.number().int().nonnegative(),
  usedByStoreBytes: z.number().int().nonnegative(),
});
export type StorageReport = z.infer<typeof storageReport>;

const inventoryFile = z.object({
  packageName,
  variant: slug,
  version,
  fileName,
  sizeBytes: z.number().int().nonnegative(),
  sha256,
});
export type InventoryFile = z.infer<typeof inventoryFile>;

const trafficBucket = z.object({
  hourStart: z.iso.datetime(),
  egressBytes: z.number().int().nonnegative(),
  ingressBytes: z.number().int().nonnegative(),
  requests: z.number().int().nonnegative(),
});
export type TrafficBucket = z.infer<typeof trafficBucket>;

export const syncOutcomes = [
  'fetched',
  'skipped_no_space',
  'failed_hash',
  'failed_network',
  'deleted',
] as const;
export const syncOutcome = z.enum(syncOutcomes);
export type SyncOutcome = z.infer<typeof syncOutcome>;

export const nodeMessage = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('hello'),
    id: z.string(),
    payload: z.object({ agentVersion: z.string(), storage: storageReport }),
  }),
  z.object({
    type: z.literal('inventory'),
    id: z.string(),
    payload: z.object({ files: z.array(inventoryFile) }),
  }),
  z.object({ type: z.literal('storage'), id: z.string(), payload: storageReport }),
  z.object({
    type: z.literal('traffic'),
    id: z.string(),
    payload: z.object({ buckets: z.array(trafficBucket) }),
  }),
  z.object({
    type: z.literal('syncResult'),
    id: z.string(),
    payload: z.object({
      packageName,
      variant: slug,
      version,
      outcome: syncOutcome,
      attempts: z.number().int().nonnegative(),
      detail: z.string().optional(),
    }),
  }),
  z.object({
    type: z.literal('log'),
    id: z.string(),
    payload: z.object({ level: z.enum(['info', 'warn', 'error']), message: z.string() }),
  }),
]);
export type NodeMessage = z.infer<typeof nodeMessage>;

const manifestFile = z.object({ fileName, sizeBytes: z.number().int().nonnegative(), sha256 });
const manifestRelease = z.object({
  version,
  state: releaseState.extract(['active', 'retained']),
  files: z.array(manifestFile),
});
const manifestVariant = z.object({
  packageName,
  variant: slug,
  releases: z.array(manifestRelease),
});
export const manifest = z.object({
  generatedAt: z.iso.datetime(),
  variants: z.array(manifestVariant),
  settings: z.object({
    deepVerifyCron: z.string(),
    maxStorageBytes: z.number().int().positive().nullable(),
  }),
});
export type Manifest = z.infer<typeof manifest>;
export type ManifestVariant = z.infer<typeof manifestVariant>;
export type ManifestRelease = z.infer<typeof manifestRelease>;
export type ManifestFile = z.infer<typeof manifestFile>;

export const hostMessage = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('manifest'),
    id: z.string(),
    replyTo: z.string().optional(),
    payload: manifest,
  }),
  z.object({ type: z.literal('resync'), id: z.string(), payload: z.object({}) }),
  z.object({
    type: z.literal('ack'),
    id: z.string(),
    replyTo: z.string().optional(),
    payload: z.object({ hourStarts: z.array(z.iso.datetime()) }),
  }),
  z.object({
    type: z.literal('error'),
    id: z.string(),
    payload: z.object({ code: z.string(), message: z.string() }),
  }),
]);
export type HostMessage = z.infer<typeof hostMessage>;
