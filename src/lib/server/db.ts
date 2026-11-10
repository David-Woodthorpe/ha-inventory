import { mkdirSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { databaseFile, uploadDir, dataDir } from './config';

mkdirSync(dataDir, { recursive: true });
mkdirSync(uploadDir, { recursive: true });

const migrations: string[] = [
  // v1 — initial schema
  `
  CREATE TABLE locations (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    parent_id TEXT REFERENCES locations(id) ON DELETE RESTRICT,
    description TEXT,
    code TEXT,
    sort_order INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );
  CREATE INDEX idx_locations_parent ON locations(parent_id);

  CREATE TABLE items (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    sku TEXT,
    description TEXT,
    category TEXT,
    quantity REAL NOT NULL DEFAULT 0,
    unit TEXT NOT NULL DEFAULT 'pcs',
    min_quantity REAL NOT NULL DEFAULT 0,
    location_id TEXT REFERENCES locations(id) ON DELETE SET NULL,
    manufacturer TEXT,
    mpn TEXT,
    supplier TEXT,
    supplier_url TEXT,
    price REAL,
    currency TEXT NOT NULL DEFAULT 'GBP',
    datasheet_url TEXT,
    notes TEXT,
    tags TEXT NOT NULL DEFAULT '[]',
    custom_fields TEXT NOT NULL DEFAULT '{}',
    archived INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );
  CREATE INDEX idx_items_location ON items(location_id);
  CREATE INDEX idx_items_category ON items(category COLLATE NOCASE);
  CREATE INDEX idx_items_name ON items(name COLLATE NOCASE);
  CREATE INDEX idx_items_updated ON items(updated_at);
  CREATE UNIQUE INDEX idx_items_sku ON items(sku) WHERE sku IS NOT NULL AND sku <> '';

  CREATE TABLE attachments (
    id TEXT PRIMARY KEY,
    item_id TEXT REFERENCES items(id) ON DELETE CASCADE,
    location_id TEXT REFERENCES locations(id) ON DELETE CASCADE,
    kind TEXT NOT NULL CHECK (kind IN ('photo', 'document')),
    filename TEXT NOT NULL,
    original_name TEXT NOT NULL,
    mime_type TEXT NOT NULL,
    size INTEGER NOT NULL,
    caption TEXT,
    created_at TEXT NOT NULL,
    CHECK ((item_id IS NOT NULL AND location_id IS NULL) OR (item_id IS NULL AND location_id IS NOT NULL))
  );
  CREATE INDEX idx_attachments_item ON attachments(item_id);
  CREATE INDEX idx_attachments_location ON attachments(location_id);

  CREATE TABLE stock_movements (
    id TEXT PRIMARY KEY,
    item_id TEXT NOT NULL REFERENCES items(id) ON DELETE CASCADE,
    delta REAL NOT NULL,
    reason TEXT,
    note TEXT,
    created_at TEXT NOT NULL
  );
  CREATE INDEX idx_movements_item ON stock_movements(item_id, created_at);
  `
];

export const latestSchemaVersion = migrations.length;

function configure(connection: DatabaseSync): void {
  connection.exec(`
    PRAGMA journal_mode = WAL;
    PRAGMA foreign_keys = ON;
    PRAGMA busy_timeout = 5000;
    PRAGMA synchronous = NORMAL;
  `);
}

function migrate(connection: DatabaseSync): void {
  connection.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version INTEGER PRIMARY KEY,
      applied_at TEXT NOT NULL
    );
  `);

  const appliedRow = connection
    .prepare('SELECT COALESCE(MAX(version), 0) AS version FROM schema_migrations')
    .get() as { version: number };
  let currentVersion = Number(appliedRow?.version ?? 0);

  for (let i = currentVersion; i < migrations.length; i++) {
    const version = i + 1;
    connection.exec('BEGIN');
    try {
      connection.exec(migrations[i]);
      connection
        .prepare('INSERT INTO schema_migrations (version, applied_at) VALUES (?, ?)')
        .run(version, new Date().toISOString());
      connection.exec('COMMIT');
      currentVersion = version;
    } catch (error) {
      connection.exec('ROLLBACK');
      throw error;
    }
  }
}

function openDatabase(): DatabaseSync {
  const connection = new DatabaseSync(databaseFile);
  try {
    configure(connection);
    migrate(connection);
    return connection;
  } catch (error) {
    try {
      connection.close();
    } catch {
      // ignore close failures while handling the original error
    }
    throw error;
  }
}

/**
 * The live SQLite connection. This is deliberately a mutable export so a
 * restore can close the old connection and replace it with one opened against
 * the restored database file; every importer sees the new connection through
 * the ES module live binding.
 */
export let db = openDatabase();

export function closeDatabase(): void {
  db.close();
}

export function reopenDatabase(): void {
  db = openDatabase();
}

export function transaction<T>(fn: () => T): T {
  db.exec('BEGIN IMMEDIATE');
  try {
    const result = fn();
    db.exec('COMMIT');
    return result;
  } catch (error) {
    try {
      db.exec('ROLLBACK');
    } catch {
      // ignore rollback failures
    }
    throw error;
  }
}

export function nowIso(): string {
  return new Date().toISOString();
}
