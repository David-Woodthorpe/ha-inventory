import { fail, redirect } from '@sveltejs/kit';
import { ApiError } from '$lib/server/errors';
import { emptyLocationFormValues, readLocationForm } from '$lib/server/forms';
import { createLocation, getLocations } from '$lib/server/locations';

export function load({ url }: { url: URL }) {
  return {
    values: emptyLocationFormValues(url.searchParams.get('parent') ?? ''),
    locations: getLocations()
  };
}

export const actions = {
  default: async ({ request }: { request: Request }) => {
    const form = await request.formData();
    const { values, input } = readLocationForm(form);
    try {
      const location = createLocation(input);
      redirect(303, `/locations/${location.id}`);
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
