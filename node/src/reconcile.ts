import { createHash } from 'node:crypto';
import {
  fileKey,
  fileUrlPath,
  releasePath,
  type FileLocator,
  type InventoryFile,
  type Manifest,
  type ManifestRelease,
  type ManifestVariant,
  type ReleaseLocator,
} from 'konmai-shared';
import type { MikroORM } from '@mikro-orm/sqlite';
import type { Config } from './config.js';
import { LocalFile, LocalRelease } from './db/entities.js';
import { downloadWithRetries } from './fetch.js';
import type { Link } from './link.js';
import type { Logger } from './logger.js';
import type { Storage } from './storage.js';
import type { TrafficMeter } from './traffic.js';

export interface PlannedActions {
  prune: FileLocator[];
  fetch: { release: ReleaseLocator; files: ManifestRelease['files'] }[];
}

// Pure planning step: given the desired state and what is held, decide what to delete and which
// releases to try fetching (newest active release per variant that is not complete yet).
export function plan(manifest: Manifest, held: Map<string, InventoryFile>): PlannedActions {
  const wanted = new Map<string, { locator: FileLocator; sha256: string; sizeBytes: number }>();
  for (const variant of manifest.variants) {
    for (const release of variant.releases) {
      for (const file of release.files) {
        const locator = {
          packageName: variant.packageName,
          variant: variant.variant,
          version: release.version,
          fileName: file.fileName,
        };
        wanted.set(fileKey(locator), { locator, sha256: file.sha256, sizeBytes: file.sizeBytes });
      }
    }
  }
  const prune: FileLocator[] = [];
  for (const [key, file] of held) {
    const expected = wanted.get(key);
    if (
      expected === undefined ||
      expected.sha256 !== file.sha256 ||
      expected.sizeBytes !== file.sizeBytes
    ) {
      prune.push(file);
    }
  }
  const pruned = new Set(prune.map(fileKey));
  const fetch: PlannedActions['fetch'] = [];
  for (const variant of manifest.variants) {
    const active = variant.releases.find((release) => release.state === 'active');
    if (active === undefined) {
      continue;
    }
    const locator = {
      packageName: variant.packageName,
      variant: variant.variant,
      version: active.version,
    };
    const missing = active.files.filter((file) => {
      const key = fileKey({ ...locator, fileName: file.fileName });
      return !held.has(key) || pruned.has(key);
    });
    if (missing.length > 0) {
      fetch.push({ release: locator, files: missing });
    }
  }
  return { prune, fetch };
}

function manifestReleasePaths(manifest: Manifest): Set<string> {
  const paths = new Set<string>();
  for (const variant of manifest.variants) {
    for (const release of variant.releases) {
      paths.add(
        releasePath({
          packageName: variant.packageName,
          variant: variant.variant,
          version: release.version,
        }),
      );
    }
  }
  return paths;
}

export function manifestFingerprint(manifest: Manifest): string {
  return createHash('sha256')
    .update(JSON.stringify({ variants: manifest.variants, settings: manifest.settings }))
    .digest('hex');
}

export class Reconciler {
  private latest: Manifest | null = null;
  private lastReconciled: string | null = null;
  private running = false;
  private rerun = false;

  constructor(
    private readonly config: Config,
    private readonly orm: MikroORM,
    private readonly storage: Storage,
    private readonly link: Link,
    private readonly traffic: TrafficMeter,
    private readonly logger: Logger,
  ) {}

  receive(manifest: Manifest, force = false): void {
    this.latest = manifest;
    const fingerprint = manifestFingerprint(manifest);
    if (!force && fingerprint === this.lastReconciled && !this.running) {
      this.logger.debug('manifest unchanged, nothing to reconcile');
      return;
    }
    void this.run();
  }

  async inventory(): Promise<InventoryFile[]> {
    const em = this.orm.em.fork();
    const files = await em.find(LocalFile, {});
    const present: InventoryFile[] = [];
    for (const file of files) {
      const size = await this.storage.fileSize(file);
      if (size === file.sizeBytes) {
        present.push({
          packageName: file.packageName,
          variant: file.variant,
          version: file.version,
          fileName: file.fileName,
          sizeBytes: file.sizeBytes,
          sha256: file.sha256,
        });
      } else {
        this.logger.warn(
          { ...file, actualSize: size },
          'file missing or resized on disk, forgetting it',
        );
        em.remove(file);
      }
    }
    await em.flush();
    return present;
  }

  async sendInventory(): Promise<void> {
    this.link.send({ type: 'inventory', payload: { files: await this.inventory() } });
    this.link.send({ type: 'storage', payload: await this.storage.report() });
  }

  async run(): Promise<void> {
    if (this.running) {
      this.rerun = true;
      return;
    }
    this.running = true;
    try {
      do {
        this.rerun = false;
        const manifest = this.latest;
        if (manifest === null) {
          return;
        }
        const fingerprint = manifestFingerprint(manifest);
        await this.reconcile(manifest);
        this.lastReconciled = fingerprint;
        await this.sendInventory();
      } while (this.rerun);
    } catch (error) {
      this.logger.error({ error }, 'reconcile failed');
    } finally {
      this.running = false;
    }
  }

  private async reconcile(manifest: Manifest): Promise<void> {
    const held = new Map((await this.inventory()).map((file) => [fileKey(file), file]));
    const actions = plan(manifest, held);
    this.logger.info({ prune: actions.prune.length, fetch: actions.fetch.length }, 'reconciling');

    const prunedReleases = new Map<string, ReleaseLocator>();
    for (const locator of actions.prune) {
      await this.forgetFile(locator);
      prunedReleases.set(releasePath(locator), locator);
    }
    const wantedReleases = manifestReleasePaths(manifest);
    for (const [key, locator] of prunedReleases) {
      if (!wantedReleases.has(key)) {
        this.link.send({
          type: 'syncResult',
          payload: { ...locator, outcome: 'deleted', attempts: 0 },
        });
      }
    }
    await this.pruneReleasesNotInManifest(wantedReleases);

    for (const job of actions.fetch) {
      await this.fetchRelease(manifest, job.release, job.files);
    }
  }

  private async fetchRelease(
    manifest: Manifest,
    release: ReleaseLocator,
    files: ManifestRelease['files'],
  ): Promise<void> {
    const variant = manifest.variants.find(
      (candidate) =>
        candidate.packageName === release.packageName && candidate.variant === release.variant,
    )!;
    const required = await this.requiredBytes(release, files);
    if (required > (await this.storage.availableBytes())) {
      await this.freeRetained(variant);
      if (required > (await this.storage.availableBytes())) {
        this.logger.warn({ ...release, required }, 'not enough space, skipping');
        this.link.send({
          type: 'syncResult',
          payload: {
            ...release,
            outcome: 'skipped_no_space',
            attempts: 0,
            detail: `needs ${required} bytes`,
          },
        });
        return;
      }
    }

    let attempts = 0;
    for (const file of files) {
      const locator = { ...release, fileName: file.fileName };
      const url = `${this.config.hostUrl}/store/${fileUrlPath(locator)}`;
      const outcome = await downloadWithRetries(
        url,
        this.config.token,
        this.storage.filePath(locator),
        file,
      );
      attempts = Math.max(attempts, outcome.attempts);
      this.traffic.addIngress(outcome.bytesDownloaded);
      if (!outcome.ok) {
        this.logger.warn({ ...locator, detail: outcome.detail }, 'download failed');
        await this.storage.deleteRelease(release);
        await this.forgetRelease(release);
        this.link.send({
          type: 'syncResult',
          payload: {
            ...release,
            outcome: outcome.failure === 'hash' ? 'failed_hash' : 'failed_network',
            attempts: outcome.attempts,
            detail: outcome.detail ?? undefined,
          },
        });
        return;
      }
      const em = this.orm.em.fork();
      await em.upsert(LocalFile, {
        ...locator,
        sizeBytes: file.sizeBytes,
        sha256: file.sha256,
        downloadedAt: new Date(),
        verifiedAt: new Date(),
      });
      this.logger.info(locator, 'file downloaded');
    }
    const em = this.orm.em.fork();
    await em.upsert(LocalRelease, { ...release, completedAt: new Date() });
    this.link.send({ type: 'syncResult', payload: { ...release, outcome: 'fetched', attempts } });
    await this.pruneOlderReleases(variant);
  }

  private async requiredBytes(
    release: ReleaseLocator,
    files: ManifestRelease['files'],
  ): Promise<number> {
    let total = 0;
    for (const file of files) {
      const existing = await this.storage.fileSize({ ...release, fileName: file.fileName });
      total += Math.max(0, file.sizeBytes - (existing ?? 0));
    }
    return total;
  }

  // A retained release will never be routed to this node again, so it is the first thing to give
  // up when the newer release does not fit.
  private async freeRetained(variant: ManifestVariant): Promise<void> {
    for (const release of variant.releases.filter((candidate) => candidate.state === 'retained')) {
      const locator = {
        packageName: variant.packageName,
        variant: variant.variant,
        version: release.version,
      };
      this.logger.info(locator, 'deleting retained release to make room');
      await this.deleteRelease(locator);
    }
  }

  private async pruneOlderReleases(variant: ManifestVariant): Promise<void> {
    const keep = new Set(variant.releases.map((release) => release.version));
    const em = this.orm.em.fork();
    const local = await em.find(LocalRelease, {
      packageName: variant.packageName,
      variant: variant.variant,
    });
    for (const release of local) {
      if (!keep.has(release.version)) {
        await this.deleteRelease(release);
      }
    }
  }

  private async pruneReleasesNotInManifest(wanted: Set<string>): Promise<void> {
    const em = this.orm.em.fork();
    for (const release of await em.find(LocalRelease, {})) {
      if (!wanted.has(releasePath(release))) {
        await this.deleteRelease(release);
      }
    }
  }

  private async deleteRelease(locator: ReleaseLocator): Promise<void> {
    await this.storage.deleteRelease(locator);
    await this.forgetRelease(locator);
    this.link.send({
      type: 'syncResult',
      payload: { ...locator, outcome: 'deleted', attempts: 0 },
    });
  }

  private async forgetRelease(locator: ReleaseLocator): Promise<void> {
    const em = this.orm.em.fork();
    const where = {
      packageName: locator.packageName,
      variant: locator.variant,
      version: locator.version,
    };
    await em.nativeDelete(LocalFile, where);
    await em.nativeDelete(LocalRelease, where);
  }

  private async forgetFile(locator: FileLocator): Promise<void> {
    this.logger.info(locator, 'deleting file not wanted by host');
    await this.storage.deleteFile(locator);
    const em = this.orm.em.fork();
    await em.nativeDelete(LocalFile, locator);
    await em.nativeDelete(LocalRelease, {
      packageName: locator.packageName,
      variant: locator.variant,
      version: locator.version,
    });
  }
}
