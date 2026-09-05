import type { Manifest, ManifestVariant } from 'konmai-shared';
import type { Config } from '../config.js';
import { Holding, Node, Release, ReleaseFile } from '../db/entities.js';
import type { EntityManager } from '../db/orm.js';

interface CatalogueSnapshot {
  variants: ManifestVariant[];
  variantIds: number[];
  completeHolders: Map<number, number>;
}

// Loads every servable release once so the same snapshot can be filtered per node.
export async function catalogueSnapshot(em: EntityManager): Promise<CatalogueSnapshot> {
  const releases = await em.find(
    Release,
    { state: { $in: ['active', 'retained'] }, variant: { enabled: true } },
    { populate: ['variant', 'variant.app'], orderBy: { variant: 'asc', createdAt: 'desc' } },
  );
  const files = await em.find(ReleaseFile, {
    release: { $in: releases.map((release) => release.id) },
  });
  const holdings = await em.find(Holding, {
    file: { $in: files.map((file) => file.id) },
    state: 'present',
  });

  const filesByRelease = new Map<number, ReleaseFile[]>();
  for (const file of files) {
    const list = filesByRelease.get(file.release.id) ?? [];
    list.push(file);
    filesByRelease.set(file.release.id, list);
  }
  const holdersByFile = new Map<number, Set<number>>();
  for (const holding of holdings) {
    const set = holdersByFile.get(holding.file.id) ?? new Set<number>();
    set.add(holding.node.id);
    holdersByFile.set(holding.file.id, set);
  }

  const byVariant = new Map<number, ManifestVariant>();
  const completeHolders = new Map<number, number>();
  for (const release of releases) {
    const variant = release.variant;
    const entry = byVariant.get(variant.id) ?? {
      packageName: variant.app.packageName,
      variant: variant.slug,
      releases: [],
    };
    const releaseFiles = filesByRelease.get(release.id) ?? [];
    entry.releases.push({
      version: release.version,
      state: release.state === 'active' ? 'active' : 'retained',
      files: releaseFiles.map((file) => ({
        fileName: file.fileName,
        sizeBytes: file.sizeBytes,
        sha256: file.sha256,
      })),
    });
    byVariant.set(variant.id, entry);
    if (release.state === 'active') {
      completeHolders.set(variant.id, countCompleteHolders(releaseFiles, holdersByFile));
    }
  }
  return {
    variants: [...byVariant.values()],
    variantIds: [...byVariant.keys()],
    completeHolders,
  };
}

function countCompleteHolders(
  files: ReleaseFile[],
  holdersByFile: Map<number, Set<number>>,
): number {
  if (files.length === 0) {
    return 0;
  }
  const [first, ...rest] = files;
  let holders = [...(holdersByFile.get(first!.id) ?? [])];
  for (const file of rest) {
    const set = holdersByFile.get(file.id) ?? new Set<number>();
    holders = holders.filter((nodeId) => set.has(nodeId));
  }
  return holders.length;
}

export function manifestFor(
  config: Config,
  node: Node,
  snapshot: CatalogueSnapshot,
  now = new Date(),
): Manifest {
  const allowed = new Set(node.allowedVariants);
  const ordered = snapshot.variantIds
    .map((id, index) => ({ id, variant: snapshot.variants[index]! }))
    .filter(({ id }) => node.variantSelection === 'all' || allowed.has(id))
    .sort(
      (a, b) =>
        (snapshot.completeHolders.get(a.id) ?? 0) - (snapshot.completeHolders.get(b.id) ?? 0),
    )
    .map(({ variant }) => variant);
  return {
    generatedAt: now.toISOString(),
    variants: ordered,
    settings: { deepVerifyCron: config.deepVerifyCron, maxStorageBytes: null },
  };
}
