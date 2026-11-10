import { restoreFromRequest } from '$lib/server/backup';
import { dataResponse, wrapApi } from '$lib/server/http';

export const POST = wrapApi(async ({ request }) => dataResponse(await restoreFromRequest(request)));
