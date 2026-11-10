import { attachmentResponse } from '$lib/server/attachments';
import { wrapApi } from '$lib/server/http';

export const GET = wrapApi(({ params }) => attachmentResponse(params.id!));
