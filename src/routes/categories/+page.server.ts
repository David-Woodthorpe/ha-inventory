import { fail, redirect } from '@sveltejs/kit';
import { deleteCategory, listCategories } from '$lib/server/categories';
import { ApiError } from '$lib/server/errors';

export function load() {
  return { categories: listCategories() };
}

export const actions = {
  delete: async ({ request }: { request: Request }) => {
    const form = await request.formData();
    const id = String(form.get('id') ?? '').trim();
    try {
      deleteCategory(id);
    } catch (error) {
      if (error instanceof ApiError) {
        return fail(error.status === 404 ? 404 : 400, { error: error.message });
      }
      throw error;
    }
    redirect(303, '/categories');
  }
};
