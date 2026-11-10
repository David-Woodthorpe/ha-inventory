export class ApiError extends Error {
  status: number;
  code: string;
  details?: unknown;

  constructor(status: number, code: string, message: string, details?: unknown) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

export function notFound(what = 'Resource', id?: string): ApiError {
  return new ApiError(404, 'not_found', `${what} not found${id ? `: ${id}` : ''}`);
}

export function badRequest(message: string, details?: unknown): ApiError {
  return new ApiError(400, 'invalid_request', message, details);
}

export function conflict(message: string, details?: unknown): ApiError {
  return new ApiError(409, 'conflict', message, details);
}
