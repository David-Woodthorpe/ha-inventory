import { fail, redirect } from '@sveltejs/kit';
import { ApiError } from '$lib/server/errors';
import { locationToFormValues, readLocationForm } from '$lib/server/forms';
import { getLocation, getLocations, updateLocation } from '$lib/server/locations';

export function load({ params }: { params: { id: string } }) {
  const location = getLocation(params.id);
  const locations = getLocations().filter((entry) => !entry.path_ids.includes(location.id));
  return {
    location,
    values: locationToFormValues(location),
    locations
  };
}

export const actions = {
  default: async ({ request, params }: { request: Request; params: { id: string } }) => {
    const form = await request.formData();
    const { values, input } = readLocationForm(form);
    try {
      const location = updateLocation(params.id, input);
      redirect(303, `/locations/${location.id}`);
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
  }
};
