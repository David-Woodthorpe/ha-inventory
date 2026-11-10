import { randomUUID } from 'node:crypto';
import { createReadStream, copyFileSync, existsSync, rmSync, statSync } from 'node:fs';
import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import { Readable } from 'node:stream';
import { DatabaseSync } from 'node:sqlite';
import { dataDir, databaseFile, maxUploadBytes } from './config';
import { closeDatabase, db, latestSchemaVersion, reopenDatabase } from './db';
import { ApiError, badRequest } from './errors';

const REQUIRED_COLUMNS: Record<string, string[]> = {
  locations: [
    'id',
    'name',
    'parent_id',
    'description',
    'code',
    'sort_order',
    'created_at',
    'updated_at'
  ],
  items: [
    'id',
    'name',
    'sku',
    'description',
    'category',
    'quantity',
    'unit',
    'min_quantity',
    'location_id',
    'manufacturer',
    'mpn',
    'supplier',
    'supplier_url',
    'price',
    'currency',
    'datasheet_url',
    'notes',
    'tags',
    'custom_fields',
    'archived',
    'created_at',
    'updated_at'
  ],
  attachments: [
    'id',
    'item_id',
    'location_id',
    'kind',
    'filename',
    'original_name',
    'mime_type',
    'size',
    'caption',
    'created_at'
  ],
  stock_movements: ['id', 'item_id', 'delta', 'reason', 'note', 'created_at'],
  schema_migrations: ['version', 'applied_at']
};

const REQUIRED_TABLES = Object.keys(REQUIRED_COLUMNS);

export interface RestoreResult {
  size: number;
  schema_version: number;
  item_count: number;
  location_count: number;
  attachment_count: number;
}

function backupFilename(date = new Date()): string {
  const stamp = date.toISOString().replace(/[-:]/g, '').replace('T', '-').slice(0, 15);
  return `inventory-backup-${stamp}.db`;
}

function removeSqliteFiles(file: string): void {
  for (const candidate of [file, `${file}-wal`, `${file}-shm`]) {
    rmSync(candidate, { force: true });
  }
}

function validateDatabaseFile(file: string): void {
  let connection: DatabaseSync | undefined;
  try {
    connection = new DatabaseSync(file, { readOnly: true });

    const integrity = connection.prepare('PRAGMA integrity_check').all() as Array<
      Record<string, unknown>
    >;
    const integrityValue = integrity.length === 1 ? Object.values(integrity[0])[0] : undefined;
    if (integrityValue !== 'ok') {
      throw badRequest('The uploaded database failed SQLite integrity checks.');
    }

    const tableRows = connection
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table'")
      .all() as Array<{ name: string }>;
    const tables = new Set(tableRows.map((row) => row.name));
    const missing = REQUIRED_TABLES.filter((table) => !tables.has(table));
    if (missing.length > 0) {
      throw badRequest(
        `This does not look like an Inventory database. Missing tables: ${missing.join(', ')}.`
      );
    }

    for (const [table, requiredColumns] of Object.entries(REQUIRED_COLUMNS)) {
      const columnRows = connection.prepare(`PRAGMA table_info(${table})`).all() as Array<{
        name: string;
      }>;
      const present = new Set(columnRows.map((column) => column.name));
      const missingColumns = requiredColumns.filter((column) => !present.has(column));
      if (missingColumns.length > 0) {
        throw badRequest(
          `The uploaded database has an incompatible "${table}" table. Missing columns: ${missingColumns.join(', ')}.`
        );
      }
    }

    const versionRow = connection
      .prepare('SELECT COALESCE(MAX(version), 0) AS version FROM schema_migrations')
      .get() as { version: number } | undefined;
    const version = Number(versionRow?.version ?? 0);
    if (!Number.isInteger(version) || version < 1) {
      throw badRequest('The uploaded database does not contain a valid Inventory schema version.');
    }
    if (version > latestSchemaVersion) {
      throw badRequest(
        `The backup was created by a newer version of Inventory (schema ${version}); this server supports up to schema ${latestSchemaVersion}.`
      );
    }

    const foreignKeyIssues = connection.prepare('PRAGMA foreign_key_check').all();
    if (foreignKeyIssues.length > 0) {
      throw badRequest('The uploaded database contains invalid references between tables.');
    }
  } catch (error) {
    if (error instanceof ApiError) throw error;
    throw badRequest('The uploaded file is not a valid SQLite database.');
  } finally {
    try {
      connection?.close();
    } catch {
      // ignore close failures while validating
    }
  }
}

function restoredDatabaseStats(size: number): RestoreResult {
  const count = (table: string) =>
    Number(
      (
        db.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get() as unknown as {
          count: number;
        }
      ).count
    );

  return {
    size,
    schema_version: latestSchemaVersion,
    item_count: count('items'),
    location_count: count('locations'),
    attachment_count: count('attachments')
  };
}

/**
 * Create a consistent standalone SQLite snapshot with VACUUM INTO. The
 * temporary file is removed automatically once the response stream closes.
 */
export function backupResponse(): Response {
  const tempPath = path.join(dataDir, `.backup-${randomUUID()}.db`);
  try {
    db.prepare('VACUUM INTO ?').run(tempPath);
    const info = statSync(tempPath);
    const stream = createReadStream(tempPath);
    const cleanup = () => {
      try {
        rmSync(tempPath, { force: true });
      } catch {
        // ignore cleanup failures
      }
    };
    stream.once('close', cleanup);
    stream.once('error', cleanup);

    const body = Readable.toWeb(stream) as unknown as ReadableStream;
    return new Response(body, {
      headers: {
        'content-type': 'application/vnd.sqlite3',
        'content-length': String(info.size),
        'content-disposition': `attachment; filename="${backupFilename()}"`,
        'cache-control': 'no-store'
      }
    });
  } catch (error) {
    rmSync(tempPath, { force: true });
    throw error;
  }
}

async function restoreDatabaseBuffer(buffer: Uint8Array): Promise<RestoreResult> {
  if (buffer.byteLength === 0) {
    throw badRequest('The uploaded database file is empty.');
  }
  if (buffer.byteLength > maxUploadBytes) {
    throw new ApiError(
      413,
      'file_too_large',
      `The database file is too large. The limit is ${Math.round(maxUploadBytes / (1024 * 1024))} MB.`
    );
  }

  const token = randomUUID();
  const uploadPath = path.join(dataDir, `.restore-${token}.db`);
  const safetyPath = path.join(dataDir, `.pre-restore-${token}.db`);

  await writeFile(uploadPath, buffer);
  try {
    validateDatabaseFile(uploadPath);

    // Keep a consistent copy of the current database so a failed reopen can be
    // rolled back without losing data.
    db.prepare('VACUUM INTO ?').run(safetyPath);

    let closed = false;
    let result: RestoreResult;
    try {
      closeDatabase();
      closed = true;
      removeSqliteFiles(databaseFile);
      copyFileSync(uploadPath, databaseFile);
      reopenDatabase();
      result = restoredDatabaseStats(buffer.byteLength);
    } catch (error) {
      if (closed) {
        try {
          removeSqliteFiles(databaseFile);
          if (existsSync(safetyPath)) copyFileSync(safetyPath, databaseFile);
          reopenDatabase();
        } catch (rollbackError) {
          console.error('[backup] restore rollback failed', rollbackError);
        }
      }
      throw new ApiError(
        500,
        'restore_failed',
        'The database could not be restored. The previous database was kept.',
        error instanceof Error ? { reason: error.message } : undefined
      );
    }

    return result;
  } finally {
    rmSync(uploadPath, { force: true });
    rmSync(safetyPath, { force: true });
  }
}

export async function restoreDatabaseFile(file: File | null): Promise<RestoreResult> {
  if (!(file instanceof File) || file.size === 0) {
    throw badRequest('Attach a non-empty SQLite database using the "file" field.');
  }
  if (file.size > maxUploadBytes) {
    throw new ApiError(
      413,
      'file_too_large',
      `The database file is too large. The limit is ${Math.round(maxUploadBytes / (1024 * 1024))} MB.`
    );
  }
  return restoreDatabaseBuffer(Buffer.from(await file.arrayBuffer()));
}

export async function restoreFromRequest(request: Request): Promise<RestoreResult> {
  const contentType = (request.headers.get('content-type') ?? '').toLowerCase();

  if (contentType.includes('multipart/form-data')) {
    let form: FormData;
    try {
      form = await request.formData();
    } catch {
      throw badRequest('Send the database as multipart/form-data using the "file" field.');
    }
    const file = form.get('file');
    return restoreDatabaseFile(file instanceof File ? file : null);
  }

  const contentLength = Number(request.headers.get('content-length') ?? '');
  if (Number.isFinite(contentLength) && contentLength > maxUploadBytes) {
    throw new ApiError(
      413,
      'file_too_large',
      `The database file is too large. The limit is ${Math.round(maxUploadBytes / (1024 * 1024))} MB.`
    );
  }

  let buffer: Buffer;
  try {
    buffer = Buffer.from(await request.arrayBuffer());
  } catch {
    throw badRequest('The request body must be a SQLite database file.');
  }
  return restoreDatabaseBuffer(buffer);
}
