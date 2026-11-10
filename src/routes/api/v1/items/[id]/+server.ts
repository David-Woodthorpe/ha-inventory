import { deleteItem, getItem, updateItem } from '$lib/server/items';
import { dataResponse, readJson, wrapApi } from '$lib/server/http';

export const GET = wrapApi(({ params }) => dataResponse(getItem(params.id!)));

export const PATCH = wrapApi(async ({ params, request }) =>
  dataResponse(updateItem(params.id!, await readJson(request)))
);

export const PUT = PATCH;

export const DELETE = wrapApi(({ params }) => {
  deleteItem(params.id!);
  return new Response(null, { status: 204 });
});
