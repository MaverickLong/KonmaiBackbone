import {
  fileKey,
  type InventoryFile,
  type NodeMessage,
  type StorageReport,
  type TrafficBucket,
} from 'konmai-shared';
import { Holding, Node, ReleaseFile, SyncEvent, Traffic } from '../db/entities.js';
import type { EntityManager } from '../db/orm.js';

export async function applyStorage(
  em: EntityManager,
  node: Node,
  storage: StorageReport,
): Promise<void> {
  node.storageTotalBytes = storage.totalBytes;
  node.storageFreeBytes = storage.freeBytes;
  await em.flush();
}

// Rebuilds the node's holdings from a full inventory: reported files that exist in the catalogue
// become `present` (or `mismatch` when size or hash differ), everything else is forgotten.
export async function applyInventory(
  em: EntityManager,
  node: Node,
  files: InventoryFile[],
): Promise<{ present: number; mismatch: number; unknown: number }> {
  const catalogue = await em.find(
    ReleaseFile,
    { release: { state: { $in: ['active', 'retained'] } } },
    { populate: ['release', 'release.variant', 'release.variant.app'] },
  );
  const byKey = new Map(
    catalogue.map((file) => [
      fileKey({
        packageName: file.release.variant.app.packageName,
        variant: file.release.variant.slug,
        version: file.release.version,
        fileName: file.fileName,
      }),
      file,
    ]),
  );
  const now = new Date();
  const counts = { present: 0, mismatch: 0, unknown: 0 };
  const rows: {
    node: number;
    file: number;
    sha256: string;
    sizeBytes: number;
    state: 'present' | 'mismatch';
    reportedAt: Date;
  }[] = [];
  for (const reported of files) {
    const file = byKey.get(fileKey(reported));
    if (file === undefined) {
      counts.unknown++;
      continue;
    }
    const matches = file.sha256 === reported.sha256 && file.sizeBytes === reported.sizeBytes;
    counts[matches ? 'present' : 'mismatch']++;
    rows.push({
      node: node.id,
      file: file.id,
      sha256: reported.sha256,
      sizeBytes: reported.sizeBytes,
      state: matches ? 'present' : 'mismatch',
      reportedAt: now,
    });
  }
  await em.transactional(async (transaction) => {
    await transaction.nativeDelete(Holding, { node: node.id });
    if (rows.length > 0) {
      await transaction.upsertMany(Holding, rows);
    }
  });
  return counts;
}

export async function applyTraffic(
  em: EntityManager,
  node: Node,
  buckets: TrafficBucket[],
): Promise<string[]> {
  if (buckets.length > 0) {
    await em.upsertMany(
      Traffic,
      buckets.map((bucket) => ({
        node: node.id,
        hourStart: new Date(bucket.hourStart),
        egressBytes: bucket.egressBytes,
        ingressBytes: bucket.ingressBytes,
        requests: bucket.requests,
      })),
    );
  }
  return buckets.map((bucket) => bucket.hourStart);
}

export async function applySyncResult(
  em: EntityManager,
  node: Node,
  payload: Extract<NodeMessage, { type: 'syncResult' }>['payload'],
): Promise<void> {
  em.create(SyncEvent, {
    node,
    packageName: payload.packageName,
    variant: payload.variant,
    version: payload.version,
    at: new Date(),
    outcome: payload.outcome,
    attempts: payload.attempts,
    detail: payload.detail ?? null,
  });
  await em.flush();
}
