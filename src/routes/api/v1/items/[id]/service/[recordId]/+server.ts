import { deleteServiceRecord, getServiceRecord, updateServiceRecord } from '$lib/server/service';
import { dataResponse, readJson, wrapApi } from '$lib/server/http';

export const GET = wrapApi(({ params }) =>
  dataResponse(getServiceRecord(params.id!, params.recordId!))
);

export const PATCH = wrapApi(async ({ params, request }) =>
  dataResponse(updateServiceRecord(params.id!, params.recordId!, await readJson(request)))
);

export const PUT = PATCH;

export const DELETE = wrapApi(({ params }) => {
  deleteServiceRecord(params.id!, params.recordId!);
  return new Response(null, { status: 204 });
});
