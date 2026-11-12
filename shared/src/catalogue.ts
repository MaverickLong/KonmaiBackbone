import { z } from 'zod';

export const packageNamePattern = /^[A-Za-z0-9_][A-Za-z0-9_.-]{0,127}$/;
export const slugPattern = /^[a-z0-9][a-z0-9-]{0,63}$/;
export const versionPattern = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;
// Any single path segment nginx can serve: no separators, no control characters, not hidden,
// and not the in-progress suffix used by nodes.
export const fileNamePattern = /^(?!\.)(?!.*\.part$)[^/\\\x00-\x1f]{1,200}$/;

export const packageName = z.string().regex(packageNamePattern, 'invalid package name');
export const slug = z.string().regex(slugPattern, 'invalid slug');
export const version = z.string().regex(versionPattern, 'invalid version');
export const fileName = z.string().regex(fileNamePattern, 'invalid file name');
export const sha256 = z.string().regex(/^[a-f0-9]{64}$/, 'invalid sha256');
export const countryCode = z.string().regex(/^[A-Z]{2}$/, 'invalid country code');

export const fileKinds = ['apk', 'apks', 'obb-main', 'obb-patch', 'other'] as const;
export const fileKind = z.enum(fileKinds);
export type FileKind = z.infer<typeof fileKind>;

export const releaseStates = ['ingesting', 'active', 'retained', 'deleting'] as const;
export const releaseState = z.enum(releaseStates);
export type ReleaseState = z.infer<typeof releaseState>;

// The host only understands `type`; every other field belongs to the downloader, which owns the
// semantics of each source. The dashboard renders the known fields and keeps unknown ones.
export const sourceTypes = ['googleplay', 'github', 'arcaea', 'manual'] as const;
export const sourceType = z.enum(sourceTypes);
export type SourceType = z.infer<typeof sourceType>;

// `device` and `account` (an email) pin what the downloader reads Play with; it saves both once
// a pair works, and tries everything that is not pinned in turn.
export const googlePlaySource = z.looseObject({
  type: z.literal('googleplay'),
  packageName: packageName.optional(),
  devices: z.array(z.string().min(1)).min(1).optional(),
  device: z.string().min(1).optional(),
  account: z.string().min(1).optional(),
  locale: z.string().min(1).optional(),
  timezone: z.string().min(1).optional(),
  expansionFiles: z.boolean().optional(),
});

export const gitHubSource = z.looseObject({
  type: z.literal('github'),
  repository: z.string().regex(/^[\w.-]+\/[\w.-]+$/, 'expected owner/name'),
  assetPattern: z.string().min(1),
  includePrereleases: z.boolean().optional(),
});

export const arcaeaSource = z.looseObject({ type: z.literal('arcaea') });
export const manualSource = z.looseObject({ type: z.literal('manual') });

export const source = z.discriminatedUnion('type', [
  googlePlaySource,
  gitHubSource,
  arcaeaSource,
  manualSource,
]);
export type Source = z.infer<typeof source>;

export interface ReleaseLocator {
  packageName: string;
  variant: string;
  version: string;
}

export interface FileLocator extends ReleaseLocator {
  fileName: string;
}

export function releasePath(locator: ReleaseLocator): string {
  return `${locator.packageName}/${locator.variant}/${locator.version}`;
}

export function filePath(locator: FileLocator): string {
  return `${releasePath(locator)}/${locator.fileName}`;
}

export function fileUrlPath(locator: FileLocator): string {
  return `${locator.packageName}/${locator.variant}/${locator.version}/${encodeURIComponent(locator.fileName)}`;
}

// Display names sort by their letters alone: case, accents, digits, spaces and punctuation are
// ignored, so "osu!droid" lands next to "OverRapid" instead of after every capitalised name.
export function nameSortKey(name: string): string {
  return name
    .normalize('NFKD')
    .toLowerCase()
    .replace(/[^\p{L}]/gu, '');
}

export function compareNames(first: string, second: string): number {
  const firstKey = nameSortKey(first);
  const secondKey = nameSortKey(second);
  if (firstKey !== secondKey) {
    return firstKey < secondKey ? -1 : 1;
  }
  return first < second ? -1 : first > second ? 1 : 0;
}

export function fileKey(locator: FileLocator): string {
  return filePath(locator);
}
