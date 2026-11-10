import { createItem, listItems } from '$lib/server/items';
import { dataResponse, listResponse, queryBool, queryInt, readJson, wrapApi } from '$lib/server/http';

export const GET = wrapApi(({ url }) => {
  const params = url.searchParams;
  const limit = queryInt(params.get('limit'), 50, 1, 200);
  const offset = queryInt(params.get('offset'), 0, 0, 10_000_000);
  const result = listItems({
    q: params.get('q') ?? undefined,
    category: params.get('category') ?? undefined,
    tag: params.get('tag') ?? undefined,
    location_id: params.get('location_id') ?? undefined,
    include_descendants: queryBool(params.get('include_descendants'), true),
    low_stock: queryBool(params.get('low_stock')),
    include_archived: queryBool(params.get('include_archived')),
    sort: params.get('sort') ?? undefined,
    order: params.get('order') === 'desc' ? 'desc' : 'asc',
    limit,
    offset
  });
  return listResponse(result.items, {
    total: result.total,
    limit,
    offset,
    has_more: offset + result.items.length < result.total
  });
});

export const POST = wrapApi(async ({ request }) => {
  const item = createItem(await readJson(request));
  return dataResponse(item, 201);
});
