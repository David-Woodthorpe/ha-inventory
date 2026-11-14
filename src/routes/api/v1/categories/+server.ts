import { createCategory, listCategories } from '$lib/server/categories';
import { dataResponse, readJson, wrapApi } from '$lib/server/http';

export const GET = wrapApi(() => dataResponse(listCategories()));

export const POST = wrapApi(async ({ request }) =>
  dataResponse(createCategory(await readJson(request)), 201)
);
