import { isIPv4, isIPv6 } from 'node:net';

function ipv4Network(address: string): string {
  const [first, second, third] = address.split('.');
  return `${first}.${second}.${third}.0/24`;
}

function ipv6Groups(address: string): string[] {
  const [head = '', tail] = address.split('::');
  const toGroups = (part: string): string[] => {
    if (part === '') {
      return [];
    }
    return part.split(':').flatMap((group) => {
      if (!group.includes('.')) {
        return [group];
      }
      // An embedded IPv4 address fills the last two groups.
      const [a = 0, b = 0, c = 0, d = 0] = group.split('.').map(Number);
      return [((a << 8) | b).toString(16), ((c << 8) | d).toString(16)];
    });
  };
  const headGroups = toGroups(head);
  const tailGroups = tail === undefined ? [] : toGroups(tail);
  const missing = 8 - headGroups.length - tailGroups.length;
  return [...headGroups, ...Array<string>(Math.max(0, missing)).fill('0'), ...tailGroups];
}

// The block an address most likely shares with its neighbours: a /24 for IPv4 and a /48 for
// IPv6, the usual allocation sizes for a single customer or a hosting provider's range. Anything
// that is not an IP address is its own network.
export function networkOf(address: string): string {
  const plain = address.split('%')[0]!;
  if (isIPv4(plain)) {
    return ipv4Network(plain);
  }
  if (!isIPv6(plain)) {
    return address;
  }
  const groups = ipv6Groups(plain.toLowerCase());
  const mapped = groups.slice(0, 5).every((group) => Number.parseInt(group, 16) === 0);
  if (mapped && Number.parseInt(groups[5]!, 16) === 0xffff) {
    const high = Number.parseInt(groups[6]!, 16);
    const low = Number.parseInt(groups[7]!, 16);
    return ipv4Network(`${high >> 8}.${high & 0xff}.${low >> 8}.${low & 0xff}`);
  }
  const prefix = groups.slice(0, 3).map((group) => Number.parseInt(group, 16).toString(16));
  return `${prefix.join(':')}::/48`;
}
