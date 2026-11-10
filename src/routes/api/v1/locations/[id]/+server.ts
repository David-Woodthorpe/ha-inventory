import { listItems } from '$lib/server/items';
import { deleteLocation, getLocation, getLocations, updateLocation } from '$lib/server/locations';
import { dataResponse, readJson, wrapApi } from '$lib/server/http';

export const GET = wrapApi(({ params, url }) => {
  const id = params.id!;
  const location = getLocation(id);
  const children = getLocations().filter((entry) => entry.parent_id === id);
  const items = url.searchParams.get('include_items') === 'false'
    ? []
    : listItems({ location_id: id, include_descendants: false, limit: 500 }).items;
  return dataResponse({ ...location, children, items });
});

export const PATCH = wrapApi(async ({ params, request }) =>
  dataResponse(updateLocation(params.id!, await readJson(request)))
);

export const PUT = PATCH;

export const DELETE = wrapApi(({ params }) => {
  deleteLocation(params.id!);
  return new Response(null, { status: 204 });
});
