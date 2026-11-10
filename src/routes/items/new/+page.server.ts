import { fail, redirect } from '@sveltejs/kit';
import { defaultCurrency } from '$lib/server/config';
import { ApiError } from '$lib/server/errors';
import { getItemFormOptions } from '$lib/server/form-options';
import { emptyItemFormValues, readItemForm } from '$lib/server/forms';
import { createItem } from '$lib/server/items';

export function load({ url }: { url: URL }) {
  const values = emptyItemFormValues(defaultCurrency);
  values.location_id = url.searchParams.get('location') ?? '';
  return {
    values,
    options: getItemFormOptions()
  };
}

export const actions = {
  default: async ({ request }: { request: Request }) => {
    const form = await request.formData();
    const { values, input } = readItemForm(form);
    try {
      const item = createItem(input);
      redirect(303, `/items/${item.id}`);
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
