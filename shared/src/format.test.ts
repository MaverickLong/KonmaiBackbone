import { describe, expect, it } from 'vitest';
import { formatBytes } from './format.js';

describe('formatBytes', () => {
  it('uses decimal units so a 2000 GB quota reads as 2 TB', () => {
    expect(formatBytes(2_000_000_000_000)).toBe('2.0 TB');
    expect(formatBytes(1_800_000_000_000)).toBe('1.8 TB');
    expect(formatBytes(1_500)).toBe('1.5 kB');
    expect(formatBytes(999)).toBe('999 B');
  });

  it('keeps the sign and handles missing values', () => {
    expect(formatBytes(-2_500_000)).toBe('-2.5 MB');
    expect(formatBytes(null)).toBe('–');
  });
});
