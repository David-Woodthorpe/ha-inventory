import { createAttachment, listAttachments } from '$lib/server/attachments';
import { dataResponse, wrapApi } from '$lib/server/http';

export const GET = wrapApi(({ url }) => {
  const itemId = url.searchParams.get('item_id') ?? undefined;
  const locationId = url.searchParams.get('location_id') ?? undefined;
  return dataResponse(listAttachments({ item_id: itemId, location_id: locationId }));
});

export const POST = wrapApi(async ({ request }) => {
  const form = await request.formData();
  const attachment = await createAttachment(form);
  return dataResponse(attachment, 201);
});
