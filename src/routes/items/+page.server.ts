import { pricingEnabled } from '$lib/server/config';
import { fail } from '@sveltejs/kit';
import { ApiError } from '$lib/server/errors';
import { listItems } from '$lib/server/items';
import { getCategories, getTags } from '$lib/server/meta';
import { getLocations } from '$lib/server/locations';
import { bulkMoveStock } from '$lib/server/stock';

const SORTS = new Set(['name', 'category', 'quantity', 'updated_at', 'created_at', 'value']);

export function load({ url }: { url: URL }) {
  const params = url.searchParams;
  const q = (params.get('q') ?? '').trim();
  const category = params.get('category') ?? '';
  const tag = params.get('tag') ?? '';
  const location = params.get('location') ?? '';
  const low = params.get('low') === '1';
  const archived = params.get('archived') === '1';
  const sortParam = params.get('sort') ?? 'name';
  const sort = !pricingEnabled && sortParam === 'value' ? 'name' : SORTS.has(sortParam) ? sortParam : 'name';
  const page = Math.max(1, Math.floor(Number(params.get('page') ?? '1')) || 1);
  const limit = 50;

  const result = listItems({
    q,
    category: category || undefined,
    tag: tag || undefined,
    location_id: location || undefined,
    low_stock: low,
    include_archived: archived,
    sort,
    order: sort === 'updated_at' || sort === 'created_at' ? 'desc' : 'asc',
    limit,
    offset: (page - 1) * limit
  });

  return {
    items: result.items,
    total: result.total,
    page,
    limit,
    filters: { q, category, tag, location, low, archived, sort },
    filtered: Boolean(q || category || tag || location || low || archived),
    options: {
      categories: getCategories().filter((category) => category.count > 0),
      tags: getTags(),
      locations: getLocations()
    }
  };
}

export const actions = {
  // Move every selected item's stock to one location. This is the batch
  // equivalent of editing an item's location, which consolidates its lots.
  move: async ({ request }: { request: Request }) => {
    const form = await request.formData();
    const itemIds = form
      .getAll('item_ids')
      .map((value) => String(value).trim())
      .filter(Boolean);
    const toLocationId = String(form.get('to_location_id') ?? '').trim();

    if (!itemIds.length) {
      return fail(400, { error: 'Select at least one item to move' });
    }
    if (!toLocationId) {
      return fail(400, { error: 'Choose a destination location' });
    }

    try {
      const result = bulkMoveStock({
        item_ids: itemIds,
        to_location_id: toLocationId,
        note: form.get('note')
      });

      const movedText = `${result.moved.length} item${result.moved.length === 1 ? '' : 's'} moved`;
      if (result.errors.length) {
        return fail(400, {
          error: `${result.errors.length} could not be moved: ${result.errors
            .slice(0, 3)
            .map((entry) => entry.message)
            .join('; ')}`,
          success: result.moved.length ? movedText : undefined
        });
      }
      return { success: movedText };
    } catch (error) {
      if (error instanceof ApiError) {
        return fail(error.status >= 400 && error.status < 600 ? error.status : 400, {
          error: error.message
        });
      }
      throw error;
    }
  }
};
