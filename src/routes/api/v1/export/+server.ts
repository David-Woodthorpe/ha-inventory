import { exportAll } from '$lib/server/items';
import { jsonResponse, wrapApi } from '$lib/server/http';

export const GET = wrapApi(() => {
  const date = new Date().toISOString().slice(0, 10);
  return jsonResponse(exportAll(), 200, {
    'content-disposition': `attachment; filename="inventory-export-${date}.json"`
  });
});
