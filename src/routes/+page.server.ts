import { listItems } from '$lib/server/items';
import { getCategories } from '$lib/server/meta';
import { getLocations } from '$lib/server/locations';

export function load() {
  const recent = listItems({ limit: 6, sort: 'created_at', order: 'desc' }).items;
  const lowStock = listItems({ low_stock: true, limit: 8, sort: 'quantity', order: 'asc' }).items;
  const categories = getCategories().slice(0, 6);
  const locations = getLocations()
    .filter((location) => location.depth === 0)
    .sort((a, b) => b.total_item_count - a.total_item_count)
    .slice(0, 6);

  return { recent, lowStock, categories, locations };
}
