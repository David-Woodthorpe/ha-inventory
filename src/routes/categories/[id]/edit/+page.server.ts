import { fail, redirect } from '@sveltejs/kit';
import {
  deleteCategory,
  getCategory,
  removeCategoryImage,
  setCategoryImage,
  updateCategory,
  validateCategoryImage
} from '$lib/server/categories';
import { ApiError } from '$lib/server/errors';
import { categoryToFormValues, readCategoryForm } from '$lib/server/forms';

export function load({ params }: { params: { id: string } }) {
  const category = getCategory(params.id);
  return {
    category,
    values: categoryToFormValues(category)
  };
}

export const actions = {
  save: async ({ request, params }: { request: Request; params: { id: string } }) => {
    const form = await request.formData();
    const { values, input } = readCategoryForm(form);
    try {
      const image = validateCategoryImage(form.get('image'));
      updateCategory(params.id, input);
      if (form.get('remove_image') === '1') await removeCategoryImage(params.id);
      if (image) await setCategoryImage(params.id, image);
      redirect(303, '/categories');
    } catch (error) {
      if (error instanceof ApiError) {
        return fail(error.status === 409 ? 409 : 400, {
          error: error.message,
          details: Array.isArray(error.details)
            ? (error.details as Array<{ field: string; message: string }>)
            : [],
          values
        });
      }
      throw error;
    }
  },

  delete: async ({ params }: { params: { id: string } }) => {
    deleteCategory(params.id);
    redirect(303, '/categories');
  }
};
