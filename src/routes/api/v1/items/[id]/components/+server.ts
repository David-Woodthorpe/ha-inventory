import { getItem } from '$lib/server/items';
import { getHostComponents, signOutComponent } from '$lib/server/stock';
import { dataResponse, readJson, wrapApi } from '$lib/server/http';

export const GET = wrapApi(({ params }) => dataResponse(getHostComponents(params.id!)));

export const POST = wrapApi(async ({ params, request }) => {
  const body = await readJson(request);
  const payload =
    body && typeof body === 'object' && !Array.isArray(body)
      ? { ...(body as Record<string, unknown>), host_item_id: params.id }
      : body;
  const allocation = signOutComponent(payload);
  return dataResponse({ allocation, item: getItem(params.id!) }, 201);
});
