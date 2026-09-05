import { defineEntity, p, type InferEntity } from '@mikro-orm/core';

export const LocalFile = defineEntity({
  name: 'LocalFile',
  properties: {
    packageName: p.string().primary(),
    variant: p.string().primary(),
    version: p.string().primary(),
    fileName: p.string().primary(),
    sizeBytes: p.integer(),
    sha256: p.string(),
    downloadedAt: p.datetime(),
    verifiedAt: p.datetime(),
  },
});
export type LocalFile = InferEntity<typeof LocalFile>;

export const LocalRelease = defineEntity({
  name: 'LocalRelease',
  properties: {
    packageName: p.string().primary(),
    variant: p.string().primary(),
    version: p.string().primary(),
    completedAt: p.datetime(),
  },
});
export type LocalRelease = InferEntity<typeof LocalRelease>;

export const TrafficBucket = defineEntity({
  name: 'TrafficBucket',
  properties: {
    hourStart: p.datetime().primary(),
    egressBytes: p.integer(),
    ingressBytes: p.integer(),
    requests: p.integer(),
    acknowledged: p.boolean().default(false),
  },
});
export type TrafficBucket = InferEntity<typeof TrafficBucket>;

export const entities = [LocalFile, LocalRelease, TrafficBucket];
