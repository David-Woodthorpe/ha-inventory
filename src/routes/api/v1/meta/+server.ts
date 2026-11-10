import { dataResponse, wrapApi } from '$lib/server/http';
import { getMeta } from '$lib/server/meta';

export const GET = wrapApi(() => dataResponse(getMeta()));
