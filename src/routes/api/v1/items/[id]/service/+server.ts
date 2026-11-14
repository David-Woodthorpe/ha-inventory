import { createServiceRecord, listServiceRecords } from '$lib/server/service';
import { dataResponse, readJson, wrapApi } from '$lib/server/http';

export const GET = wrapApi(({ params }) => dataResponse(listServiceRecords(params.id!)));

export const POST = wrapApi(async ({ params, request }) =>
  dataResponse(createServiceRecord(params.id!, await readJson(request)), 201)
);
