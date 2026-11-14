import { getItem } from '$lib/server/items';
import { transferStock } from '$lib/server/stock';
import { dataResponse, readJson, wrapApi } from '$lib/server/http';

export const POST = wrapApi(async ({ params, request }) => {
  transferStock(params.id!, await readJson(request));
  return dataResponse(getItem(params.id!));
});
