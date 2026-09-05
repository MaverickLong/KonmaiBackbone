import { describe, expect, it } from 'vitest';
import { fileName, fileUrlPath, source, version } from './catalogue.js';

describe('catalogue schemas', () => {
  it('accepts plain file names and rejects path tricks', () => {
    expect(fileName.safeParse('com.example_1.2.3.apk').success).toBe(true);
    expect(fileName.safeParse('main.100.com.example.obb').success).toBe(true);
    expect(fileName.safeParse('../secret').success).toBe(false);
    expect(fileName.safeParse('a/b').success).toBe(false);
    expect(fileName.safeParse('.hidden').success).toBe(false);
    expect(fileName.safeParse('x.part').success).toBe(false);
  });

  it('accepts typical versions', () => {
    for (const value of ['4.1.9', '4.1.9c', 'v2.0.0-beta.1', '2022', '1.0.1.2-1034']) {
      expect(version.safeParse(value).success).toBe(true);
    }
    expect(version.safeParse('../1').success).toBe(false);
    expect(version.safeParse('').success).toBe(false);
  });

  it('keeps unknown source fields for the downloader', () => {
    const parsed = source.parse({ type: 'googleplay', futureOption: 1 });
    expect(parsed).toEqual({ type: 'googleplay', futureOption: 1 });
    expect(source.safeParse({ type: 'unknown' }).success).toBe(false);
  });

  it('encodes file names in URL paths', () => {
    expect(
      fileUrlPath({ packageName: 'a.b', variant: 'gp', version: '1', fileName: 'x y#.apk' }),
    ).toBe('a.b/gp/1/x%20y%23.apk');
  });
});
