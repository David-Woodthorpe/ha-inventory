import { getItemStock } from '$lib/server/stock';
import { adjustStock } from '$lib/server/items';
import { dataResponse, readJson, wrapApi } from '$lib/server/http';

export const GET = wrapApi(({ params }) => dataResponse(getItemStock(params.id!)));

export const POST = wrapApi(async ({ params, request }) =>
  dataResponse(adjustStock(params.id!, await readJson(request)))
);
