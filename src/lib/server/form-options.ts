import type { ItemFormOptions } from '$lib/form-types';
import { getCategories, getCurrencies, getTags, getUnits } from './meta';
import { getLocations } from './locations';

export function getItemFormOptions(): ItemFormOptions {
  const categories = getCategories()
    .slice()
    .sort((a, b) => a.category.localeCompare(b.category));
  return {
    locations: getLocations(),
    categories,
    tags: getTags(),
    units: getUnits(),
    currencies: getCurrencies()
  };
}
