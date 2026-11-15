import { getLayout, setLayout } from '$lib/server/layout';
import { dataResponse, readJson, wrapApi } from '$lib/server/http';

export const GET = wrapApi(({ params }) => dataResponse(getLayout(params.id!)));

export const PUT = wrapApi(async ({ params, request }) =>
  dataResponse(setLayout(params.id!, await readJson(request)))
);
