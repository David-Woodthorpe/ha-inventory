import { fail, redirect } from '@sveltejs/kit';
import { createCategory, deleteCategory, setCategoryImage, validateCategoryImage } from '$lib/server/categories';
import { ApiError } from '$lib/server/errors';
import { emptyCategoryFormValues, readCategoryForm } from '$lib/server/forms';

export function load() {
  return { values: emptyCategoryFormValues() };
}

export const actions = {
  save: async ({ request }: { request: Request }) => {
    const form = await request.formData();
    const { values, input } = readCategoryForm(form);
    let createdId: string | null = null;
    try {
      const image = validateCategoryImage(form.get('image'));
      const category = createCategory(input);
      createdId = category.id;
      if (image) await setCategoryImage(category.id, image);
    } catch (error) {
      if (createdId) {
        try {
          deleteCategory(createdId);
        } catch {
          // keep the original error; the category may already have been removed
        }
      }
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
    redirect(303, '/categories');
  }
};
