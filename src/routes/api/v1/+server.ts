import { appVersion } from '$lib/server/config';
import { jsonResponse, wrapApi } from '$lib/server/http';

export const GET = wrapApi(() =>
  jsonResponse({
    name: 'Inventory API',
    version: appVersion,
    description:
      'REST API for a self-hosted inventory of electronics parts, tools and supplies. All responses are JSON and all IDs are UUIDs.',
    base_url: '/api/v1',
    docs: '/api',
    openapi: '/api/v1/openapi.json',
    llms_txt: '/llms.txt',
    endpoints: [
      'GET /api/v1/health',
      'GET /api/v1/meta',
      'GET /api/v1/items',
      'POST /api/v1/items',
      'POST /api/v1/items/bulk',
      'GET /api/v1/items/{id}',
      'PATCH /api/v1/items/{id}',
      'DELETE /api/v1/items/{id}',
      'POST /api/v1/items/{id}/stock',
      'GET /api/v1/items/{id}/movements',
      'GET /api/v1/locations',
      'POST /api/v1/locations',
      'GET /api/v1/locations/{id}',
      'PATCH /api/v1/locations/{id}',
      'DELETE /api/v1/locations/{id}',
      'GET /api/v1/attachments',
      'POST /api/v1/attachments',
      'GET /api/v1/attachments/{id}',
      'DELETE /api/v1/attachments/{id}',
      'GET /api/v1/attachments/{id}/file',
      'GET /api/v1/search?q=',
      'GET /api/v1/export'
    ]
  })
);
