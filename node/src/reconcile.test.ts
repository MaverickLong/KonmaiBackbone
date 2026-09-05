import { describe, expect, it } from 'vitest';
import { fileKey, type InventoryFile, type Manifest } from 'konmai-shared';
import { plan } from './reconcile.js';

const manifest: Manifest = {
  generatedAt: '2026-09-06T00:00:00Z',
  settings: { deepVerifyCron: '0 4 * * 0', maxStorageBytes: null },
  variants: [
    {
      packageName: 'com.example',
      variant: 'gp',
      releases: [
        {
          version: '2',
          state: 'active',
          files: [{ fileName: 'a.apk', sizeBytes: 10, sha256: 'a2' }],
        },
        {
          version: '1',
          state: 'retained',
          files: [{ fileName: 'a.apk', sizeBytes: 10, sha256: 'a1' }],
        },
      ],
    },
  ],
};

function held(files: InventoryFile[]): Map<string, InventoryFile> {
  return new Map(files.map((file) => [fileKey(file), file]));
}

describe('plan', () => {
  it('fetches the active release when nothing is held', () => {
    const actions = plan(manifest, held([]));
    expect(actions.prune).toEqual([]);
    expect(actions.fetch).toEqual([
      {
        release: { packageName: 'com.example', variant: 'gp', version: '2' },
        files: [{ fileName: 'a.apk', sizeBytes: 10, sha256: 'a2' }],
      },
    ]);
  });

  it('keeps a retained release and never fetches it', () => {
    const actions = plan(
      manifest,
      held([
        {
          packageName: 'com.example',
          variant: 'gp',
          version: '1',
          fileName: 'a.apk',
          sizeBytes: 10,
          sha256: 'a1',
        },
        {
          packageName: 'com.example',
          variant: 'gp',
          version: '2',
          fileName: 'a.apk',
          sizeBytes: 10,
          sha256: 'a2',
        },
      ]),
    );
    expect(actions).toEqual({ prune: [], fetch: [] });
  });

  it('prunes files that are stale or corrupt and refetches corrupt active files', () => {
    const actions = plan(
      manifest,
      held([
        {
          packageName: 'com.example',
          variant: 'gp',
          version: '0',
          fileName: 'a.apk',
          sizeBytes: 10,
          sha256: 'a0',
        },
        {
          packageName: 'com.example',
          variant: 'gp',
          version: '2',
          fileName: 'a.apk',
          sizeBytes: 10,
          sha256: 'wrong',
        },
      ]),
    );
    expect(actions.prune.map((file) => file.version)).toEqual(['0', '2']);
    expect(actions.fetch).toHaveLength(1);
    expect(actions.fetch[0]!.files).toEqual([{ fileName: 'a.apk', sizeBytes: 10, sha256: 'a2' }]);
  });
});
