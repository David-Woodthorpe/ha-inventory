import { categoryImageResponse } from '$lib/server/categories';
import { wrapApi } from '$lib/server/http';

export const GET = wrapApi(({ params }) => categoryImageResponse(params.id!));
