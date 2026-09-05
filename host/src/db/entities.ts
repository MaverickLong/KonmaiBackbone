import { defineEntity, p, type InferEntity } from '@mikro-orm/core';
import type { Source } from 'konmai-shared';

export const App = defineEntity({
  name: 'App',
  properties: {
    packageName: p.string().primary(),
    displayName: p.string(),
    iconFileName: p.string().nullable(),
    createdAt: p.datetime().onCreate(() => new Date()),
  },
});
export type App = InferEntity<typeof App>;

export const Variant = defineEntity({
  name: 'Variant',
  properties: {
    id: p.integer().primary().autoincrement(),
    app: () => p.manyToOne(App).deleteRule('cascade'),
    slug: p.string(),
    name: p.string(),
    source: p.json<Source>(),
    enabled: p.boolean().default(true),
    checkRequestedAt: p.datetime().nullable(),
    lastCheckedAt: p.datetime().nullable(),
    lastCheckStatus: p.enum(['up_to_date', 'updated', 'failed']).nullable(),
    lastCheckError: p.text().nullable(),
    createdAt: p.datetime().onCreate(() => new Date()),
  },
  uniques: [{ properties: ['app', 'slug'] }],
});
export type Variant = InferEntity<typeof Variant>;

export const Release = defineEntity({
  name: 'Release',
  properties: {
    id: p.integer().primary().autoincrement(),
    variant: () => p.manyToOne(Variant).deleteRule('cascade'),
    version: p.string(),
    versionCode: p.integer().nullable(),
    state: p.enum(['ingesting', 'active', 'retained', 'deleting']),
    sizeBytes: p.integer(),
    createdAt: p.datetime().onCreate(() => new Date()),
    activatedAt: p.datetime().nullable(),
  },
  uniques: [{ properties: ['variant', 'version'] }],
});
export type Release = InferEntity<typeof Release>;

export const ReleaseFile = defineEntity({
  name: 'ReleaseFile',
  properties: {
    id: p.integer().primary().autoincrement(),
    release: () => p.manyToOne(Release).deleteRule('cascade'),
    fileName: p.string(),
    kind: p.enum(['apk', 'apks', 'obb-main', 'obb-patch', 'other']),
    sizeBytes: p.integer(),
    sha256: p.string(),
  },
  uniques: [{ properties: ['release', 'fileName'] }],
});
export type ReleaseFile = InferEntity<typeof ReleaseFile>;

export const Node = defineEntity({
  name: 'Node',
  properties: {
    id: p.integer().primary().autoincrement(),
    name: p.string(),
    domain: p.string().unique(),
    countries: p.json<string[]>(),
    catchAll: p.boolean().default(false),
    weight: p.integer().default(100),
    enabled: p.boolean().default(true),
    status: p.enum(['online', 'faulty', 'unknown']).default('unknown'),
    agentConnected: p.boolean().default(false),
    agentVersion: p.string().nullable(),
    lastHealthyAt: p.datetime().nullable(),
    lastFailureAt: p.datetime().nullable(),
    lastFailureReason: p.text().nullable(),
    monthlyQuotaBytes: p.integer(),
    quotaResetDay: p.integer(),
    timezone: p.string().default('UTC'),
    usageAdjustmentBytes: p.integer().default(0),
    usageAdjustmentPeriodStart: p.datetime().nullable(),
    variantSelection: p.enum(['all', 'allowlist']).default('all'),
    allowedVariants: p.json<number[]>(),
    tokenHash: p.string(),
    storageTotalBytes: p.integer().nullable(),
    storageFreeBytes: p.integer().nullable(),
    createdAt: p.datetime().onCreate(() => new Date()),
  },
});
export type Node = InferEntity<typeof Node>;

export const Holding = defineEntity({
  name: 'Holding',
  properties: {
    node: () => p.manyToOne(Node).primary().deleteRule('cascade'),
    file: () => p.manyToOne(ReleaseFile).primary().deleteRule('cascade'),
    sha256: p.string(),
    sizeBytes: p.integer(),
    state: p.enum(['present', 'mismatch']),
    reportedAt: p.datetime(),
  },
});
export type Holding = InferEntity<typeof Holding>;

export const Traffic = defineEntity({
  name: 'Traffic',
  properties: {
    node: () => p.manyToOne(Node).primary().deleteRule('cascade'),
    hourStart: p.datetime().primary(),
    egressBytes: p.integer(),
    ingressBytes: p.integer(),
    requests: p.integer(),
  },
});
export type Traffic = InferEntity<typeof Traffic>;

export const HealthEvent = defineEntity({
  name: 'HealthEvent',
  properties: {
    id: p.integer().primary().autoincrement(),
    node: () => p.manyToOne(Node).deleteRule('cascade'),
    at: p.datetime().index(),
    kind: p.enum(['became_faulty', 'recovered', 'agent_connected', 'agent_disconnected']),
    detail: p.text().nullable(),
    emailSent: p.boolean().default(false),
  },
});
export type HealthEvent = InferEntity<typeof HealthEvent>;

export const SyncEvent = defineEntity({
  name: 'SyncEvent',
  properties: {
    id: p.integer().primary().autoincrement(),
    node: () => p.manyToOne(Node).deleteRule('cascade'),
    packageName: p.string(),
    variant: p.string(),
    version: p.string(),
    at: p.datetime().index(),
    outcome: p.enum(['fetched', 'skipped_no_space', 'failed_hash', 'failed_network', 'deleted']),
    attempts: p.integer(),
    detail: p.text().nullable(),
  },
});
export type SyncEvent = InferEntity<typeof SyncEvent>;

export const Download = defineEntity({
  name: 'Download',
  properties: {
    id: p.integer().primary().autoincrement(),
    file: () => p.manyToOne(ReleaseFile).deleteRule('cascade'),
    node: () => p.manyToOne(Node).nullable().deleteRule('set null'),
    country: p.string().nullable(),
    at: p.datetime().index(),
  },
});
export type Download = InferEntity<typeof Download>;

export const DownloadSummary = defineEntity({
  name: 'DownloadSummary',
  properties: {
    day: p.string().primary(),
    variant: () => p.manyToOne(Variant).primary().deleteRule('cascade'),
    nodeId: p.integer().primary(),
    country: p.string().primary(),
    count: p.integer(),
  },
});
export type DownloadSummary = InferEntity<typeof DownloadSummary>;

export const DownloaderState = defineEntity({
  name: 'DownloaderState',
  properties: {
    id: p.integer().primary(),
    lastSeenAt: p.datetime().nullable(),
    phase: p.enum(['idle', 'checking', 'downloading']).default('idle'),
    currentVariantId: p.integer().nullable(),
    passStartedAt: p.datetime().nullable(),
    passFinishedAt: p.datetime().nullable(),
    passSummary: p.text().nullable(),
  },
});
export type DownloaderState = InferEntity<typeof DownloaderState>;

export const entities = [
  App,
  Variant,
  Release,
  ReleaseFile,
  Node,
  Holding,
  Traffic,
  HealthEvent,
  SyncEvent,
  Download,
  DownloadSummary,
  DownloaderState,
];
