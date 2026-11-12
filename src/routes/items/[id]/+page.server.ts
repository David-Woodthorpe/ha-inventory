import { fail, redirect } from '@sveltejs/kit';
import { createAttachment, deleteAttachment, getAttachment } from '$lib/server/attachments';
import { ApiError } from '$lib/server/errors';
import { adjustStock, deleteItem, getItem, updateItem } from '$lib/server/items';
import { getLocations } from '$lib/server/locations';

export function load({ params }: { params: { id: string } }) {
  const item = getItem(params.id);
  const locations = getLocations();
  const byId = new Map(locations.map((location) => [location.id, location]));
  const location = item.location_id ? byId.get(item.location_id) : undefined;
  // An item is only published when its own toggle is on and every location in
  // its path is published. Null means the item has no location.
  const locationPublished = location
    ? location.path_ids.every((id) => byId.get(id)?.ha_enabled)
    : null;
  return {
    item,
    locationPublished
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
  adjust: async ({ request, params }: { request: Request; params: { id: string } }) => {
    const form = await request.formData();
    try {
      adjustStock(params.id, {
        delta: form.get('delta'),
        set: form.get('set'),
        reason: form.get('reason'),
        note: form.get('note')
      });
      return { success: 'Stock updated' };
    } catch (error) {
      return actionFailure(error);
    }
  },

  upload: async ({ request, params }: { request: Request; params: { id: string } }) => {
    const form = await request.formData();
    form.set('item_id', params.id);
    form.delete('location_id');
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
      if (attachment.item_id !== params.id) {
        throw new ApiError(404, 'not_found', 'Attachment does not belong to this item');
      }
      await deleteAttachment(id);
      return { success: 'Attachment deleted' };
    } catch (error) {
      return actionFailure(error);
    }
  },

  archive: async ({ params }: { params: { id: string } }) => {
    const item = getItem(params.id);
    updateItem(params.id, { archived: !item.archived });
    return { success: item.archived ? 'Item restored' : 'Item archived' };
  },

  toggleHomeAssistant: async ({ params }: { params: { id: string } }) => {
    const item = getItem(params.id);
    updateItem(params.id, { ha_enabled: !item.ha_enabled });
    return {
      success: item.ha_enabled
        ? 'Item is no longer published to Home Assistant'
        : 'Item will be published to Home Assistant'
    };
  },

  delete: async ({ params }: { params: { id: string } }) => {
    deleteItem(params.id);
    redirect(303, '/items');
  }
};
