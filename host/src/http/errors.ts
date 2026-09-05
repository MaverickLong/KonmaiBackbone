import type { ErrorRequestHandler } from 'express';
import type { ErrorCode, ErrorResponse } from 'konmai-shared';
import type { ZodType } from 'zod';
import type { Logger } from '../logger.js';

export class HttpError extends Error {
  constructor(
    readonly status: number,
    readonly code: ErrorCode,
    message: string,
    readonly details?: unknown,
  ) {
    super(message);
  }
}

export function notFound(what: string): HttpError {
  return new HttpError(404, 'NOT_FOUND', `${what} not found`);
}

export function conflict(message: string): HttpError {
  return new HttpError(409, 'CONFLICT', message);
}

export function unauthorized(message = 'authentication required'): HttpError {
  return new HttpError(401, 'UNAUTHORIZED', message);
}

export function parse<T>(schema: ZodType<T>, value: unknown): T {
  const result = schema.safeParse(value);
  if (!result.success) {
    throw new HttpError(400, 'VALIDATION', 'invalid request', result.error.issues);
  }
  return result.data;
}

export function errorHandler(logger: Logger): ErrorRequestHandler {
  return (error: unknown, request, response, _next) => {
    if (error instanceof HttpError) {
      const body: ErrorResponse = {
        error: { code: error.code, message: error.message, details: error.details },
      };
      response.status(error.status).json(body);
      return;
    }
    if (isBodyParseError(error)) {
      const body: ErrorResponse = { error: { code: 'VALIDATION', message: 'malformed body' } };
      response.status(400).json(body);
      return;
    }
    logger.error({ error, requestId: response.getHeader('x-request-id') }, 'unhandled error');
    const body: ErrorResponse = { error: { code: 'INTERNAL', message: 'internal error' } };
    response.status(500).json(body);
  };
}

function isBodyParseError(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'type' in error &&
    typeof error.type === 'string' &&
    error.type.startsWith('entity.')
  );
}
