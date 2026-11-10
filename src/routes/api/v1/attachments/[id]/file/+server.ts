import { attachmentResponse } from '$lib/server/attachments';
import { queryBool, wrapApi } from '$lib/server/http';

export const GET = wrapApi(({ params, url }) =>
  attachmentResponse(params.id!, { download: queryBool(url.searchParams.get('download')) })
);
