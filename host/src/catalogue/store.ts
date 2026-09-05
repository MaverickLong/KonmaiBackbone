import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { mkdir, readdir, realpath, rename, rm, stat } from 'node:fs/promises';
import path from 'node:path';
import { pipeline } from 'node:stream/promises';
import { filePath, releasePath, type FileLocator, type ReleaseLocator } from 'konmai-shared';

export class Store {
  readonly stagingDirectory: string;
  readonly storeDirectory: string;
  readonly iconsDirectory: string;

  constructor(storageDirectory: string) {
    this.stagingDirectory = path.join(storageDirectory, 'staging');
    this.storeDirectory = path.join(storageDirectory, 'store');
    this.iconsDirectory = path.join(storageDirectory, 'icons');
  }

  async prepare(): Promise<void> {
    await Promise.all(
      [this.stagingDirectory, this.storeDirectory, this.iconsDirectory].map((directory) =>
        mkdir(directory, { recursive: true }),
      ),
    );
  }

  storedFilePath(locator: FileLocator): string {
    return path.join(this.storeDirectory, filePath(locator));
  }

  storedReleasePath(locator: ReleaseLocator): string {
    return path.join(this.storeDirectory, releasePath(locator));
  }

  // The downloader hands over absolute paths; anything outside staging is refused so a
  // compromised or buggy downloader cannot make the host publish arbitrary files.
  async resolveStagedFile(candidate: string): Promise<string> {
    const stagingRoot = await realpath(this.stagingDirectory);
    const resolved = await realpath(candidate);
    if (!resolved.startsWith(stagingRoot + path.sep)) {
      throw new Error(`file is outside the staging directory: ${candidate}`);
    }
    const info = await stat(resolved);
    if (!info.isFile()) {
      throw new Error(`not a regular file: ${candidate}`);
    }
    return resolved;
  }

  async moveIntoStore(stagedPath: string, locator: FileLocator): Promise<void> {
    const destination = this.storedFilePath(locator);
    await mkdir(path.dirname(destination), { recursive: true });
    await rename(stagedPath, destination);
  }

  async deleteRelease(locator: ReleaseLocator): Promise<void> {
    await rm(this.storedReleasePath(locator), { recursive: true, force: true });
    await removeEmptyParents(this.storedReleasePath(locator), this.storeDirectory);
  }

  async deleteStagedRelease(locator: ReleaseLocator): Promise<void> {
    await rm(path.join(this.stagingDirectory, releasePath(locator)), {
      recursive: true,
      force: true,
    });
  }

  async listStoredReleases(): Promise<ReleaseLocator[]> {
    const releases: ReleaseLocator[] = [];
    for (const packageName of await listDirectories(this.storeDirectory)) {
      for (const variant of await listDirectories(path.join(this.storeDirectory, packageName))) {
        for (const version of await listDirectories(
          path.join(this.storeDirectory, packageName, variant),
        )) {
          releases.push({ packageName, variant, version });
        }
      }
    }
    return releases;
  }
}

export async function hashFile(filePathToHash: string): Promise<string> {
  const hash = createHash('sha256');
  await pipeline(createReadStream(filePathToHash), hash);
  return hash.digest('hex');
}

async function listDirectories(directory: string): Promise<string[]> {
  try {
    const entries = await readdir(directory, { withFileTypes: true });
    return entries.filter((entry) => entry.isDirectory()).map((entry) => entry.name);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return [];
    }
    throw error;
  }
}

async function removeEmptyParents(start: string, stopAt: string): Promise<void> {
  let current = path.dirname(start);
  while (current.startsWith(stopAt + path.sep)) {
    const entries = await readdir(current).catch(() => null);
    if (entries === null || entries.length > 0) {
      return;
    }
    await rm(current, { recursive: true, force: true });
    current = path.dirname(current);
  }
}
