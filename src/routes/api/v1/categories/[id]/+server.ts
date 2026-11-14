import { deleteCategory, getCategory, updateCategory } from '$lib/server/categories';
import { dataResponse, readJson, wrapApi } from '$lib/server/http';

export const GET = wrapApi(({ params }) => dataResponse(getCategory(params.id!)));

export const PATCH = wrapApi(async ({ params, request }) =>
  dataResponse(updateCategory(params.id!, await readJson(request)))
);

export const PUT = PATCH;

export const DELETE = wrapApi(({ params }) => {
  deleteCategory(params.id!);
  return new Response(null, { status: 204 });
});
