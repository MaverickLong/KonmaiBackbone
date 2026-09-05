import { randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';
import type { RequestHandler } from 'express';
import { SignJWT, jwtVerify } from 'jose';
import type { LoginView, SessionView } from 'konmai-shared';
import type { Config } from '../config.js';
import { unauthorized } from './errors.js';

const scryptKeyLength = 64;

export function hashPassword(password: string): string {
  const salt = randomBytes(16);
  const hash = scryptSync(password, salt, scryptKeyLength);
  return `scrypt$${salt.toString('base64')}$${hash.toString('base64')}`;
}

export function verifyPassword(password: string, stored: string): boolean {
  const [scheme, saltEncoded, hashEncoded] = stored.split('$');
  if (scheme !== 'scrypt' || saltEncoded === undefined || hashEncoded === undefined) {
    return false;
  }
  const expected = Buffer.from(hashEncoded, 'base64');
  const actual = scryptSync(password, Buffer.from(saltEncoded, 'base64'), expected.length);
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}

export function bearerToken(header: string | undefined): string | null {
  if (header === undefined) {
    return null;
  }
  const [scheme, token] = header.split(' ', 2);
  return scheme?.toLowerCase() === 'bearer' && token ? token.trim() : null;
}

const subject = 'admin';

export async function issueSession(config: Config['admin']): Promise<LoginView> {
  const expiresAt = new Date(Date.now() + config.tokenLifetimeHours * 3_600_000);
  const token = await new SignJWT({})
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject(subject)
    .setIssuedAt()
    .setExpirationTime(expiresAt)
    .sign(new TextEncoder().encode(config.jwtSecret));
  return { token, subject, expiresAt: expiresAt.toISOString() };
}

export async function verifySession(
  config: Config['admin'],
  token: string,
): Promise<SessionView | null> {
  try {
    const { payload } = await jwtVerify(token, new TextEncoder().encode(config.jwtSecret), {
      algorithms: ['HS256'],
      subject,
    });
    return {
      subject: payload.sub ?? subject,
      expiresAt: new Date((payload.exp ?? 0) * 1000).toISOString(),
    };
  } catch {
    return null;
  }
}

declare module 'express-serve-static-core' {
  interface Request {
    session?: SessionView;
  }
}

// The only authorization scheme today is "one admin"; every admin route goes through this
// middleware so a multi-user scheme later only has to replace it.
export function requireAdmin(config: Config['admin']): RequestHandler {
  return async (request, _response, next) => {
    const token = bearerToken(request.header('authorization'));
    const session = token === null ? null : await verifySession(config, token);
    if (session === null) {
      next(unauthorized());
      return;
    }
    request.session = session;
    next();
  };
}

export function requireToken(expected: string): RequestHandler {
  const expectedBuffer = Buffer.from(expected);
  return (request, _response, next) => {
    const token = bearerToken(request.header('authorization'));
    const actual = token === null ? Buffer.alloc(0) : Buffer.from(token);
    const matches =
      actual.length === expectedBuffer.length && timingSafeEqual(actual, expectedBuffer);
    next(matches ? undefined : unauthorized());
  };
}
