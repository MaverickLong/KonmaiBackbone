import { mkdir, readdir, rm, stat, statfs, writeFile } from 'node:fs/promises';
import path from 'node:path';
import {
  filePath,
  releasePath,
  type FileLocator,
  type ReleaseLocator,
  type StorageReport,
} from 'konmai-shared';
import type { Config } from './config.js';

export const partSuffix = '.part';

export class Storage {
  constructor(private readonly config: Config) {}

  get directory(): string {
    return this.config.storageDirectory;
  }

  async prepare(nodeId: number, agentVersion: string): Promise<void> {
    await mkdir(this.directory, { recursive: true });
    await writeFile(path.join(this.directory, 'health'), `${nodeId} ${agentVersion}\n`);
  }

  filePath(locator: FileLocator): string {
    return path.join(this.directory, filePath(locator));
  }

  releasePath(locator: ReleaseLocator): string {
    return path.join(this.directory, releasePath(locator));
  }

  async fileSize(locator: FileLocator): Promise<number | null> {
    try {
      const info = await stat(this.filePath(locator));
      return info.isFile() ? info.size : null;
    } catch {
      return null;
    }
  }

  async deleteFile(locator: FileLocator): Promise<void> {
    await rm(this.filePath(locator), { force: true });
    await rm(this.filePath(locator) + partSuffix, { force: true });
    await this.removeEmptyParents(path.dirname(this.filePath(locator)));
  }

  async deleteRelease(locator: ReleaseLocator): Promise<void> {
    await rm(this.releasePath(locator), { recursive: true, force: true });
    await this.removeEmptyParents(path.dirname(this.releasePath(locator)));
  }

  // Walks the storage directory so partially downloaded files count as used space too.
  async usedBytes(): Promise<number> {
    let total = 0;
    const walk = async (directory: string): Promise<void> => {
      for (const entry of await readdir(directory, { withFileTypes: true })) {
        const entryPath = path.join(directory, entry.name);
        if (entry.isDirectory()) {
          await walk(entryPath);
        } else if (entry.isFile()) {
          total += (await stat(entryPath)).size;
        }
      }
    };
    await walk(this.directory);
    return total;
  }

  async report(): Promise<StorageReport> {
    const [disk, usedByStoreBytes] = await Promise.all([statfs(this.directory), this.usedBytes()]);
    return {
      totalBytes: Number(disk.blocks) * Number(disk.bsize),
      freeBytes: Number(disk.bavail) * Number(disk.bsize),
      usedByStoreBytes,
    };
  }

  // Bytes that may still be written before hitting the disk, the configured cap, or the reserve.
  async availableBytes(): Promise<number> {
    const report = await this.report();
    const byDisk = report.freeBytes - this.config.minFreeBytes;
    const byCap =
      this.config.maxStorageBytes === null
        ? Number.POSITIVE_INFINITY
        : this.config.maxStorageBytes - report.usedByStoreBytes;
    return Math.max(0, Math.min(byDisk, byCap));
  }

  private async removeEmptyParents(start: string): Promise<void> {
    let current = start;
    while (current.startsWith(this.directory + path.sep)) {
      const entries = await readdir(current).catch(() => null);
      if (entries === null || entries.length > 0) {
        return;
      }
      await rm(current, { recursive: true, force: true });
      current = path.dirname(current);
    }
  }
}
