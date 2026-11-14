import { returnAllocation } from '$lib/server/stock';
import { dataResponse, readJson, wrapApi } from '$lib/server/http';

export const POST = wrapApi(async ({ params, request }) =>
  dataResponse(returnAllocation(params.allocationId!, await readJson(request), params.id!))
);
