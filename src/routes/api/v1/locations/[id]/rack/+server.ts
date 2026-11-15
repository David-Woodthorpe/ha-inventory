import { getRack, setRack } from '$lib/server/rack';
import { dataResponse, readJson, wrapApi } from '$lib/server/http';

export const GET = wrapApi(({ params }) => dataResponse(getRack(params.id!)));

export const PUT = wrapApi(async ({ params, request }) =>
  dataResponse(setRack(params.id!, await readJson(request)))
);
