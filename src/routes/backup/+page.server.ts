import { statSync } from 'node:fs';
import { fail } from '@sveltejs/kit';
import { restoreDatabaseFile } from '$lib/server/backup';
import { apiKey, databaseFile } from '$lib/server/config';
import { ApiError } from '$lib/server/errors';
import { getStats } from '$lib/server/meta';

export function load() {
  let size = 0;
  let modified: string | null = null;
  try {
    const info = statSync(databaseFile);
    size = info.size;
    modified = info.mtime.toISOString();
  } catch {
    // the database is created on startup; treat a missing file as empty info
  }

  return {
    database: { name: 'inventory.db', size, modified },
    stats: getStats(),
    apiKeyEnabled: Boolean(apiKey)
  };
}

export const actions = {
  restore: async ({ request }: { request: Request }) => {
    const form = await request.formData();
    if (form.get('confirm') !== 'yes') {
      return fail(400, { error: 'Confirm that you want to replace the current database.' });
    }

    const file = form.get('file');
    if (!(file instanceof File)) {
      return fail(400, { error: 'Choose a SQLite database file to restore.' });
    }

    try {
      const result = await restoreDatabaseFile(file);
      return { success: 'Database restored successfully.', result };
    } catch (error) {
      if (error instanceof ApiError) {
        return fail(error.status, { error: error.message });
      }
      throw error;
    }
  }
};
