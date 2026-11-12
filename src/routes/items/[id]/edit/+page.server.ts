import { fail, redirect } from '@sveltejs/kit';
import { ApiError } from '$lib/server/errors';
import { getItemFormOptions } from '$lib/server/form-options';
import { itemToFormValues, readItemForm } from '$lib/server/forms';
import { getItem, updateItem } from '$lib/server/items';

export function load({ params }: { params: { id: string } }) {
  const item = getItem(params.id);
  return {
    item,
    values: itemToFormValues(item),
    options: getItemFormOptions()
  };
}

export const actions = {
  default: async ({ request, params }: { request: Request; params: { id: string } }) => {
    const form = await request.formData();
    const intent = form.get('intent');
    const { values, input } = readItemForm(form);
    try {
      const item = updateItem(params.id, input);
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
