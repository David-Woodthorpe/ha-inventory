import { bulkCreateItems } from '$lib/server/items';
import { badRequest } from '$lib/server/errors';
import { jsonResponse, readJson, wrapApi } from '$lib/server/http';

export const POST = wrapApi(async ({ request }) => {
  const body = await readJson(request);
  const items = Array.isArray(body)
    ? body
    : body && typeof body === 'object' && Array.isArray((body as { items?: unknown }).items)
      ? (body as { items: unknown[] }).items
      : null;
  if (!items) throw badRequest('Send a JSON array of items, or an object with an "items" array');
  if (items.length === 0) throw badRequest('The items array is empty');
  if (items.length > 500) throw badRequest('A maximum of 500 items can be created per request');

  const result = bulkCreateItems(items);
  return jsonResponse(
    {
      data: {
        created: result.created,
        errors: result.errors,
        created_count: result.created.length,
        error_count: result.errors.length
      }
    },
    result.errors.length ? 207 : 201
  );
});
