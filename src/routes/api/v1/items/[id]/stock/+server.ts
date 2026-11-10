import { adjustStock } from '$lib/server/items';
import { dataResponse, readJson, wrapApi } from '$lib/server/http';

export const POST = wrapApi(async ({ params, request }) =>
  dataResponse(adjustStock(params.id!, await readJson(request)))
);
