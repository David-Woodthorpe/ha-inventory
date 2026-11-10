import { deleteAttachment, getAttachment } from '$lib/server/attachments';
import { dataResponse, wrapApi } from '$lib/server/http';

export const GET = wrapApi(({ params }) => dataResponse(getAttachment(params.id!)));

export const DELETE = wrapApi(async ({ params }) => {
  await deleteAttachment(params.id!);
  return new Response(null, { status: 204 });
});
