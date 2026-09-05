import { describe, expect, it } from 'vitest';
import { hourStart, parseAccessLine } from './traffic.js';

describe('parseAccessLine', () => {
  it('extracts the JSON payload from a syslog datagram', () => {
    const line =
      '<190>Sep  6 01:00:00 node1 konmai: {"t":"2026-09-06T01:00:00+00:00","uri":"/files/a/b/1/x.apk","status":206,"bytes":4096,"rt":0.1}';
    expect(parseAccessLine(line)).toEqual({ uri: '/files/a/b/1/x.apk', status: 206, bytes: 4096 });
  });

  it('rejects malformed lines', () => {
    expect(parseAccessLine('garbage')).toBeNull();
    expect(parseAccessLine('<1>x {"uri":1}')).toBeNull();
  });
});

describe('hourStart', () => {
  it('truncates to the hour in UTC', () => {
    expect(hourStart(new Date('2026-09-06T01:59:59.999Z')).toISOString()).toBe(
      '2026-09-06T01:00:00.000Z',
    );
  });
});
