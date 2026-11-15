import { bulkMoveStock } from '$lib/server/stock';
import { jsonResponse, readJson, wrapApi } from '$lib/server/http';

export const POST = wrapApi(async ({ request }) => {
  const result = bulkMoveStock(await readJson(request));
  return jsonResponse(
    {
      data: {
        moved: result.moved,
        errors: result.errors,
        moved_count: result.moved.length,
        error_count: result.errors.length
      }
    },
    result.errors.length ? 207 : 200
  );
});
