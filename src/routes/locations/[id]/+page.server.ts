import { fail, redirect } from '@sveltejs/kit';
import { createAttachment, deleteAttachment, getAttachment, listAttachments } from '$lib/server/attachments';
import { ApiError } from '$lib/server/errors';
import { listItems } from '$lib/server/items';
import { deleteLocation, getLocation, getLocations } from '$lib/server/locations';

export function load({ params }: { params: { id: string } }) {
  const location = getLocation(params.id);
  const children = getLocations().filter((entry) => entry.parent_id === location.id);
  const items = listItems({ location_id: location.id, include_descendants: false, limit: 500 }).items;
  const attachments = listAttachments({ location_id: location.id });
  const parent = location.parent_id ? getLocation(location.parent_id) : null;
  return {
    location,
    parent,
    children,
    items,
    photos: attachments.filter((attachment) => attachment.kind === 'photo'),
    documents: attachments.filter((attachment) => attachment.kind === 'document')
  };
}

function actionFailure(error: unknown) {
  if (error instanceof ApiError) {
    return fail(error.status >= 400 && error.status < 600 ? error.status : 400, {
      error: error.message
    });
  }
  throw error;
}

export const actions = {
  upload: async ({ request, params }: { request: Request; params: { id: string } }) => {
    const form = await request.formData();
    form.set('location_id', params.id);
    form.delete('item_id');
    try {
      const attachment = await createAttachment(form);
      return { success: attachment.kind === 'photo' ? 'Photo uploaded' : 'Document uploaded' };
    } catch (error) {
      return actionFailure(error);
    }
  },

  deleteAttachment: async ({ request, params }: { request: Request; params: { id: string } }) => {
    const form = await request.formData();
    const id = String(form.get('id') ?? '');
    try {
      const attachment = getAttachment(id);
      if (attachment.location_id !== params.id) {
        throw new ApiError(404, 'not_found', 'Attachment does not belong to this location');
      }
      await deleteAttachment(id);
      return { success: 'Attachment deleted' };
    } catch (error) {
      return actionFailure(error);
    }
  },

  delete: async ({ params }: { params: { id: string } }) => {
    try {
      deleteLocation(params.id);
      redirect(303, '/locations');
    } catch (error) {
      if (error instanceof ApiError) {
        return fail(error.status === 409 ? 409 : 400, { error: error.message });
      }
      throw error;
    }
  }
};
