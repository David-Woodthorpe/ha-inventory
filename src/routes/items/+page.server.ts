import { pricingEnabled } from '$lib/server/config';
import { listItems } from '$lib/server/items';
import { getCategories, getTags } from '$lib/server/meta';
import { getLocations } from '$lib/server/locations';

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
      categories: getCategories(),
      tags: getTags(),
      locations: getLocations()
    }
  };
}
