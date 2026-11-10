import type { ItemFormOptions } from '$lib/form-types';
import { getCategories, getCurrencies, getTags, getUnits } from './meta';
import { getLocations } from './locations';

export function getItemFormOptions(): ItemFormOptions {
  return {
    locations: getLocations(),
    categories: getCategories(),
    tags: getTags(),
    units: getUnits(),
    currencies: getCurrencies()
  };
}
