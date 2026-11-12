import { fail, redirect } from '@sveltejs/kit';
import { defaultCurrency } from '$lib/server/config';
import { ApiError } from '$lib/server/errors';
import { getItemFormOptions } from '$lib/server/form-options';
import { emptyItemFormValues, itemToFormValues, readItemForm } from '$lib/server/forms';
import { createItem, getItem } from '$lib/server/items';

function getCopySource(id: string | null) {
  if (!id) return null;
  try {
    return getItem(id);
  } catch (error) {
    // A stale copy link should fall back to a blank form, not a 404.
    if (error instanceof ApiError) return null;
    throw error;
  }
}

export function load({ url }: { url: URL }) {
  const source = getCopySource(url.searchParams.get('copy'));
  const values = source ? itemToFormValues(source) : emptyItemFormValues(defaultCurrency);
  if (source) {
    // The SKU is the one field that must differ for the next item.
    values.sku = '';
  } else {
    values.location_id = url.searchParams.get('location') ?? '';
  }
  return {
    values,
    options: getItemFormOptions(),
    focusSku: url.searchParams.get('focus') === 'sku',
    copiedFrom: source ? { id: source.id, name: source.name } : null
  };
}

export const actions = {
  default: async ({ request }: { request: Request }) => {
    const form = await request.formData();
    const intent = form.get('intent');
    const { values, input } = readItemForm(form);
    try {
      const item = createItem(input);
      redirect(303, intent === 'add_another' ? `/items/new?copy=${item.id}&focus=sku` : `/items/${item.id}`);
    } catch (error) {
      if (error instanceof ApiError) {
        return fail(400, {
          error: error.message,
          details: Array.isArray(error.details)
            ? (error.details as Array<{ field: string; message: string }>)
            : [],
          values
        });
      }
      throw error;
    }
  }
};
