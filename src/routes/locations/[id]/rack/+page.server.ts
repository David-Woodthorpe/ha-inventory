import { fail } from '@sveltejs/kit';
import { ApiError } from '$lib/server/errors';
import { listItemChoices } from '$lib/server/items';
import { getLocations } from '$lib/server/locations';
import { addRackMount, getRack, removeRackMount } from '$lib/server/rack';

export function load({ params }: { params: { id: string } }) {
  const rack = getRack(params.id);
  const mountedIds = new Set(
    rack.mounts.filter((mount) => mount.type === 'location').map((mount) => mount.ref_id)
  );
  const mountedItems = new Set(
    rack.mounts.filter((mount) => mount.type === 'item').map((mount) => mount.ref_id)
  );
  return {
    rack,
    items: listItemChoices().filter((item) => !mountedItems.has(item.id)),
    shelves: getLocations()
      .filter((entry) => entry.parent_id === params.id && !mountedIds.has(entry.id))
      .map((entry) => ({ id: entry.id, name: entry.name, code: entry.code }))
  };
}

function actionFailure(error: unknown) {
  if (error instanceof ApiError) {
    return fail(error.status >= 400 && error.status < 600 ? error.status : 400, {
      error: error.message,
      details: error.details ?? null
    });
  }
  throw error;
}

export const actions = {
  /** Mount one item or shelf at a slot, leaving the rest of the rack alone. */
  mountDevice: async ({ request, params }: { request: Request; params: { id: string } }) => {
    const form = await request.formData();
    const ref = String(form.get('ref') ?? '').trim();
    const uStart = String(form.get('u_start') ?? '').trim();
    const uHeight = String(form.get('u_height') ?? '').trim();

    const [kind, id] = ref.split(':');
    if (!id || (kind !== 'item' && kind !== 'location')) {
      return fail(400, { error: 'Choose an item or a shelf to mount' });
    }

    try {
      addRackMount(params.id, {
        item_id: kind === 'item' ? id : null,
        location_id: kind === 'location' ? id : null,
        u_start: uStart === '' ? 1 : uStart,
        u_height: uHeight === '' ? 1 : uHeight
      });
      return { success: 'Mounted' };
    } catch (error) {
      return actionFailure(error);
    }
  },

  /** Take one mount out of the rack. */
  unmountDevice: async ({ request, params }: { request: Request; params: { id: string } }) => {
    const form = await request.formData();
    const mountId = String(form.get('mount_id') ?? '');
    try {
      removeRackMount(params.id, mountId);
      return { success: 'Removed from the rack' };
    } catch (error) {
      return actionFailure(error);
    }
  }
};
