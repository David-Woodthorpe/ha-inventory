import { jsonResponse, wrapApi } from '$lib/server/http';
import { openapi } from '$lib/server/openapi';

export const GET = wrapApi(() => jsonResponse(openapi));
