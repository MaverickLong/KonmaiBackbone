import type { ErrorResponse } from 'konmai-shared';

const tokenKey = 'konmai.token';

export const session = {
  token(): string | null {
    try {
      return localStorage.getItem(tokenKey);
    } catch {
      return null;
    }
  },
  store(token: string): void {
    localStorage.setItem(tokenKey, token);
  },
  clear(): void {
    localStorage.removeItem(tokenKey);
  },
};

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly details?: unknown,
  ) {
    super(message);
  }
}

interface RequestOptions {
  method?: string;
  body?: unknown;
  form?: FormData;
  query?: Record<string, string | number | undefined>;
}

export async function api<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const url = new URL(path, window.location.origin);
  for (const [key, value] of Object.entries(options.query ?? {})) {
    if (value !== undefined) {
      url.searchParams.set(key, String(value));
    }
  }
  const headers: Record<string, string> = {};
  const token = session.token();
  if (token !== null) {
    headers['authorization'] = `Bearer ${token}`;
  }
  if (options.body !== undefined) {
    headers['content-type'] = 'application/json';
  }
  const response = await fetch(url, {
    method: options.method ?? (options.body !== undefined || options.form ? 'POST' : 'GET'),
    headers,
    body: options.form ?? (options.body === undefined ? undefined : JSON.stringify(options.body)),
  });
  if (response.status === 204) {
    return undefined as T;
  }
  const payload: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    const error = (payload as ErrorResponse | null)?.error;
    if (response.status === 401 && !path.endsWith('/session')) {
      session.clear();
      window.location.assign('/login');
    }
    throw new ApiError(
      response.status,
      error?.code ?? 'INTERNAL',
      error?.message ?? `request failed with ${response.status}`,
      error?.details,
    );
  }
  return payload as T;
}
