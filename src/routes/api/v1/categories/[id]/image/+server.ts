import {
  categoryImageResponse,
  removeCategoryImage,
  setCategoryImage
} from '$lib/server/categories';
import { badRequest } from '$lib/server/errors';
import { dataResponse, wrapApi } from '$lib/server/http';

export const GET = wrapApi(({ params }) => categoryImageResponse(params.id!));

export const POST = wrapApi(async ({ params, request }) => {
  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    throw badRequest('Send the image as multipart/form-data using the "file" field.');
  }
  const file = form.get('file');
  if (!(file instanceof File)) {
    throw badRequest('Attach an image using the "file" field.');
  }
  return dataResponse(await setCategoryImage(params.id!, file), 201);
});

export const DELETE = wrapApi(async ({ params }) => dataResponse(await removeCategoryImage(params.id!)));
