import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { downloadFile, downloadWithRetries, FetchError } from './fetch.js';

const content = Buffer.alloc(256 * 1024, 7);
const expected = {
  sizeBytes: content.length,
  sha256: createHash('sha256').update(content).digest('hex'),
};

let server: Server;
let baseUrl: string;
let directory: string;

beforeAll(async () => {
  server = createServer((request, response) => {
    response.end(request.url === '/oversized' ? Buffer.concat([content, content]) : content);
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  directory = await mkdtemp(path.join(tmpdir(), 'konmai-fetch-'));
});

afterAll(async () => {
  server.close();
  await rm(directory, { recursive: true, force: true });
});

describe('downloadFile', () => {
  it('stores a file whose size and hash match', async () => {
    const destination = path.join(directory, 'ok.apk');
    await downloadFile(`${baseUrl}/file`, 'token', destination, expected, false, 0);
    expect(await readFile(destination)).toEqual(content);
  });

  it('stops before eating into the free-space reserve and removes the partial file', async () => {
    const destination = path.join(directory, 'full.apk');
    const attempt = downloadFile(
      `${baseUrl}/file`,
      'token',
      destination,
      expected,
      false,
      Number.MAX_SAFE_INTEGER,
    );
    await expect(attempt).rejects.toMatchObject({ kind: 'space' });
    expect(existsSync(destination)).toBe(false);
    expect(existsSync(`${destination}.part`)).toBe(false);
  });

  it('refuses a response larger than the manifest says', async () => {
    const destination = path.join(directory, 'big.apk');
    const attempt = downloadFile(`${baseUrl}/oversized`, 'token', destination, expected, false, 0);
    await expect(attempt).rejects.toBeInstanceOf(FetchError);
    await expect(attempt).rejects.toMatchObject({ kind: 'hash' });
    expect(existsSync(`${destination}.part`)).toBe(false);
  });
});

describe('downloadWithRetries', () => {
  it('does not retry when the disk is full', async () => {
    const outcome = await downloadWithRetries(
      `${baseUrl}/file`,
      'token',
      path.join(directory, 'retry.apk'),
      expected,
      Number.MAX_SAFE_INTEGER,
    );
    expect(outcome).toMatchObject({ ok: false, attempts: 1, failure: 'space' });
  });
});
