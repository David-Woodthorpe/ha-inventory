import { listItems } from '$lib/server/items';
import { getCategories, getTags } from '$lib/server/meta';
import { getLocations } from '$lib/server/locations';
import { dataResponse, queryInt, wrapApi } from '$lib/server/http';

export const GET = wrapApi(({ url }) => {
  const q = (url.searchParams.get('q') ?? '').trim();
  if (!q) {
    return dataResponse({ query: q, items: [], locations: [], categories: [], tags: [] });
  }
  const limit = queryInt(url.searchParams.get('limit'), 20, 1, 100);
  const items = listItems({ q, limit }).items;
  const needle = q.toLowerCase();
  const locations = getLocations()
    .filter(
      (location) =>
        location.name.toLowerCase().includes(needle) ||
        location.path_label.toLowerCase().includes(needle) ||
        (location.code ?? '').toLowerCase().includes(needle)
    )
    .slice(0, 25);
  const categories = getCategories()
    .filter((category) => category.category.toLowerCase().includes(needle))
    .slice(0, 15);
  const tags = getTags()
    .filter((tag) => tag.tag.toLowerCase().includes(needle))
    .slice(0, 25);
  return dataResponse({ query: q, items, locations, categories, tags });
});
