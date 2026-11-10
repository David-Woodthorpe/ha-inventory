import type { RequestEvent } from '@sveltejs/kit';
import { z } from 'zod';
import { ApiError } from './errors';

export function jsonResponse(data: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(data, null, 2), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
      ...headers
    }
  });
}

export function dataResponse(data: unknown, status = 200): Response {
  return jsonResponse({ data }, status);
}

export function listResponse(data: unknown[], pagination: Record<string, unknown>): Response {
  return jsonResponse({ data, pagination });
}

export function errorResponse(error: unknown): Response {
  if (error instanceof ApiError) {
    return jsonResponse(
      { error: { code: error.code, message: error.message, ...(error.details ? { details: error.details } : {}) } },
      error.status
    );
  }
  if (error instanceof z.ZodError) {
    return jsonResponse(
      {
        error: {
          code: 'validation_error',
          message: 'Some fields are invalid',
          details: error.issues.map((issue) => ({
            field: issue.path.join('.') || '(body)',
            message: issue.message
          }))
        }
      },
      400
    );
  }
  console.error('[api] unhandled error', error);
  return jsonResponse({ error: { code: 'internal_error', message: 'An unexpected error occurred' } }, 500);
}

type ApiHandler = (event: RequestEvent) => Response | Promise<Response>;

export function wrapApi(handler: ApiHandler): (event: RequestEvent) => Promise<Response> {
  return async (event) => {
    try {
      return await handler(event);
    } catch (error) {
      return errorResponse(error);
    }
  };
}

export function queryInt(value: string | null, fallback: number, min: number, max: number): number {
  if (value === null || value === '') return fallback;
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(max, Math.max(min, Math.trunc(parsed)));
}

export function queryBool(value: string | null, fallback = false): boolean {
  if (value === null) return fallback;
  return ['1', 'true', 'yes', 'on'].includes(value.toLowerCase());
}

export async function readJson(request: Request): Promise<unknown> {
  try {
    return await request.json();
  } catch {
    throw new ApiError(400, 'invalid_json', 'Request body must be valid JSON');
  }
}
