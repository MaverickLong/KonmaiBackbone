import { describe, expect, it } from 'vitest';
import { networkOf } from './network.js';

describe('networkOf', () => {
  it('groups IPv4 addresses by /24', () => {
    expect(networkOf('203.0.113.77')).toBe('203.0.113.0/24');
  });

  it('groups IPv6 addresses by /48 whatever their notation', () => {
    expect(networkOf('2001:db8:abcd:12::1')).toBe('2001:db8:abcd::/48');
    expect(networkOf('2001:0DB8:ABCD:0012:0000:0000:0000:0001')).toBe('2001:db8:abcd::/48');
    expect(networkOf('2001:db8::1')).toBe('2001:db8:0::/48');
    expect(networkOf('fe80::1%eth0')).toBe('fe80:0:0::/48');
  });

  it('treats IPv4-mapped IPv6 addresses as IPv4', () => {
    expect(networkOf('::ffff:198.51.100.23')).toBe('198.51.100.0/24');
    expect(networkOf('::ffff:c633:6417')).toBe('198.51.100.0/24');
  });

  it('keeps anything else as is', () => {
    expect(networkOf('unix:')).toBe('unix:');
  });
});
