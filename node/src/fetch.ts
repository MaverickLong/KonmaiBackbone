import { createHash } from 'node:crypto';
import { createReadStream, createWriteStream } from 'node:fs';
import { mkdir, rename, rm, stat } from 'node:fs/promises';
import path from 'node:path';
import { Readable, Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { setTimeout as sleep } from 'node:timers/promises';
import { partSuffix } from './storage.js';

export interface ExpectedFile {
  sizeBytes: number;
  sha256: string;
}

export interface FetchOutcome {
  ok: boolean;
  attempts: number;
  bytesDownloaded: number;
  failure: 'hash' | 'network' | null;
  detail: string | null;
}

const maxAttempts = 3;
const retryDelaysMilliseconds = [5_000, 30_000];

export class FetchError extends Error {
  constructor(
    readonly kind: 'hash' | 'network',
    message: string,
  ) {
    super(message);
  }
}

async function hashPrefix(
  filePath: string,
  length: number,
): Promise<ReturnType<typeof createHash>> {
  const hash = createHash('sha256');
  await pipeline(createReadStream(filePath, { start: 0, end: length - 1 }), hash);
  return hash;
}

// Downloads to `<destination>.part`, resuming an existing part on the first attempt only, and
// renames into place once size and hash match. Returns the number of bytes transferred.
export async function downloadFile(
  url: string,
  token: string,
  destination: string,
  expected: ExpectedFile,
  resume: boolean,
): Promise<number> {
  const partPath = destination + partSuffix;
  await mkdir(path.dirname(destination), { recursive: true });
  let offset = 0;
  if (resume) {
    offset = await stat(partPath)
      .then((info) => info.size)
      .catch(() => 0);
    if (offset >= expected.sizeBytes) {
      offset = 0;
    }
  }
  if (offset === 0) {
    await rm(partPath, { force: true });
  }
  const hash = offset > 0 ? await hashPrefix(partPath, offset) : createHash('sha256');

  let response: Response;
  try {
    response = await fetch(url, {
      headers: {
        authorization: `Bearer ${token}`,
        ...(offset > 0 ? { range: `bytes=${offset}-` } : {}),
      },
      signal: AbortSignal.timeout(3_600_000),
    });
  } catch (error) {
    throw new FetchError('network', error instanceof Error ? error.message : String(error));
  }
  if (response.status === 200 && offset > 0) {
    // The server ignored the range; start over with a fresh hash.
    offset = 0;
    await rm(partPath, { force: true });
    hash.destroy();
    return downloadFile(url, token, destination, expected, false);
  }
  if ((offset === 0 && response.status !== 200) || (offset > 0 && response.status !== 206)) {
    throw new FetchError('network', `unexpected HTTP ${response.status}`);
  }
  if (response.body === null) {
    throw new FetchError('network', 'empty response body');
  }

  let transferred = 0;
  const counter = new Transform({
    transform(chunk: Buffer, _encoding, callback) {
      transferred += chunk.length;
      hash.update(chunk);
      callback(null, chunk);
    },
  });
  try {
    await pipeline(
      Readable.fromWeb(response.body as import('node:stream/web').ReadableStream),
      counter,
      createWriteStream(partPath, { flags: offset > 0 ? 'a' : 'w' }),
    );
  } catch (error) {
    throw new FetchError('network', error instanceof Error ? error.message : String(error));
  }

  const finalSize = offset + transferred;
  const digest = hash.digest('hex');
  if (finalSize !== expected.sizeBytes || digest !== expected.sha256) {
    await rm(partPath, { force: true });
    throw new FetchError(
      'hash',
      `expected ${expected.sizeBytes} bytes / ${expected.sha256}, got ${finalSize} bytes / ${digest}`,
    );
  }
  await rename(partPath, destination);
  return transferred;
}

export async function downloadWithRetries(
  url: string,
  token: string,
  destination: string,
  expected: ExpectedFile,
): Promise<FetchOutcome> {
  let bytesDownloaded = 0;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      bytesDownloaded += await downloadFile(url, token, destination, expected, attempt === 1);
      return { ok: true, attempts: attempt, bytesDownloaded, failure: null, detail: null };
    } catch (error) {
      const failure = error instanceof FetchError ? error.kind : 'network';
      const detail = error instanceof Error ? error.message : String(error);
      if (attempt === maxAttempts) {
        return { ok: false, attempts: attempt, bytesDownloaded, failure, detail };
      }
      await sleep(retryDelaysMilliseconds[attempt - 1] ?? 30_000);
    }
  }
  return { ok: false, attempts: maxAttempts, bytesDownloaded, failure: 'network', detail: null };
}
