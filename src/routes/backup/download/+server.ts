import { backupResponse } from '$lib/server/backup';
import { wrapApi } from '$lib/server/http';

export const GET = wrapApi(() => backupResponse());
