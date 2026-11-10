import { createLocation, getLocations, locationTree } from '$lib/server/locations';
import { dataResponse, queryBool, readJson, wrapApi } from '$lib/server/http';

export const GET = wrapApi(({ url }) =>
  dataResponse(queryBool(url.searchParams.get('tree')) ? locationTree() : getLocations())
);

export const POST = wrapApi(async ({ request }) => dataResponse(createLocation(await readJson(request)), 201));
