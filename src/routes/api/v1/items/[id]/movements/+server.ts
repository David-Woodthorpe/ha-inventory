import { getItem } from '$lib/server/items';
import { dataResponse, wrapApi } from '$lib/server/http';

export const GET = wrapApi(({ params }) => dataResponse(getItem(params.id!).movements));
