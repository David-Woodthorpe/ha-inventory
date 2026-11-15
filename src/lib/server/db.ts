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
  `,
  // v2 — per-item and per-location Home Assistant publishing
  //
  // New rows default to 0 so a large inventory does not flood Home Assistant
  // with devices. The UPDATE keeps every row that existed before this migration
  // published, so upgrading does not remove entities that are already in use.
  `
  ALTER TABLE items ADD COLUMN ha_enabled INTEGER NOT NULL DEFAULT 0;
  UPDATE items SET ha_enabled = 1;

  ALTER TABLE locations ADD COLUMN ha_enabled INTEGER NOT NULL DEFAULT 0;
  UPDATE locations SET ha_enabled = 1;
  `,
  // v3 — optional service history and recurring service schedule
  //
  // service_next_due is stored as a date-only string (YYYY-MM-DD) so it maps
  // cleanly to an all-day event in a Home Assistant local calendar.
  `
  ALTER TABLE items ADD COLUMN service_interval_months INTEGER;
  ALTER TABLE items ADD COLUMN service_next_due TEXT;
  ALTER TABLE items ADD COLUMN service_notes TEXT;

  CREATE TABLE service_records (
    id TEXT PRIMARY KEY,
    item_id TEXT NOT NULL REFERENCES items(id) ON DELETE CASCADE,
    performed_at TEXT NOT NULL,
    notes TEXT,
    cost REAL,
    currency TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );
  CREATE INDEX idx_service_records_item ON service_records(item_id, performed_at DESC);

  ALTER TABLE attachments ADD COLUMN service_record_id TEXT REFERENCES service_records(id) ON DELETE CASCADE;
  CREATE INDEX idx_attachments_service_record ON attachments(service_record_id);

  CREATE TABLE service_calendar_events (
    item_id TEXT PRIMARY KEY REFERENCES items(id) ON DELETE CASCADE,
    entity_id TEXT NOT NULL,
    uid TEXT NOT NULL,
    due_date TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );
  `,
  // v4 — stock split across locations and components installed in other items
  //
  // items.quantity stays the cached total and items.location_id the primary
  // location, so existing queries, sorting, stats and Home Assistant grouping
  // keep working. The item_stock lots are the authoritative per-location
  // breakdown. Each item starts with one lot matching its current location and
  // quantity.
  `
  CREATE TABLE item_stock (
    id TEXT PRIMARY KEY,
    item_id TEXT NOT NULL REFERENCES items(id) ON DELETE CASCADE,
    location_id TEXT REFERENCES locations(id) ON DELETE CASCADE,
    quantity REAL NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );
  CREATE INDEX idx_item_stock_item ON item_stock(item_id);
  CREATE INDEX idx_item_stock_location ON item_stock(location_id);
  CREATE UNIQUE INDEX idx_item_stock_item_location ON item_stock(item_id, COALESCE(location_id, ''));

  INSERT INTO item_stock (id, item_id, location_id, quantity, created_at, updated_at)
  SELECT
    lower(
      hex(randomblob(4)) || '-' ||
      hex(randomblob(2)) || '-' ||
      hex(randomblob(2)) || '-' ||
      hex(randomblob(2)) || '-' ||
      hex(randomblob(6))
    ),
    id, location_id, quantity, created_at, updated_at
  FROM items
  WHERE quantity <> 0;

  CREATE TABLE item_allocations (
    id TEXT PRIMARY KEY,
    component_item_id TEXT NOT NULL REFERENCES items(id) ON DELETE RESTRICT,
    host_item_id TEXT NOT NULL REFERENCES items(id) ON DELETE RESTRICT,
    quantity REAL NOT NULL,
    source_location_id TEXT REFERENCES locations(id) ON DELETE SET NULL,
    note TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    CHECK (component_item_id <> host_item_id),
    CHECK (quantity > 0)
  );
  CREATE INDEX idx_item_allocations_host ON item_allocations(host_item_id);
  CREATE INDEX idx_item_allocations_component ON item_allocations(component_item_id);

  ALTER TABLE stock_movements ADD COLUMN location_id TEXT REFERENCES locations(id) ON DELETE SET NULL;
  ALTER TABLE stock_movements ADD COLUMN to_location_id TEXT REFERENCES locations(id) ON DELETE SET NULL;
  `,
  // v5 — normalise stock lot ids created by the v4 backfill
  //
  // The first version of the v4 backfill generated 32-character hex ids while
  // the rest of the application uses UUIDs. Rewrite them in UUID text form so
  // every id returned by the API and included in exports is a valid UUID.
  `
  UPDATE item_stock
  SET id =
    substr(id, 1, 8) || '-' ||
    substr(id, 9, 4) || '-' ||
    substr(id, 13, 4) || '-' ||
    substr(id, 17, 4) || '-' ||
    substr(id, 21, 12)
  WHERE length(id) = 32 AND instr(id, '-') = 0;
  `,
  // v6 — managed categories with optional icon or image
  //
  // items.category stays as text so existing exports, searches and API clients
  // keep working. The categories table is the managed catalogue: it holds the
  // display icon/image and provides a single place to rename or remove a
  // category. Existing category names on items are copied in so nothing is lost
  // when upgrading.
  `
  CREATE TABLE categories (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    description TEXT,
    icon TEXT,
    image_filename TEXT,
    image_mime_type TEXT,
    sort_order INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );
  CREATE UNIQUE INDEX idx_categories_name ON categories(name COLLATE NOCASE);
  CREATE INDEX idx_categories_sort ON categories(sort_order);

  UPDATE items SET category = trim(category)
  WHERE category IS NOT NULL AND category <> trim(category);

  INSERT INTO categories (id, name, sort_order, created_at, updated_at)
  SELECT
    lower(
      hex(randomblob(4)) || '-' ||
      hex(randomblob(2)) || '-' ||
      hex(randomblob(2)) || '-' ||
      hex(randomblob(2)) || '-' ||
      hex(randomblob(6))
    ),
    MIN(category),
    0,
    strftime('%Y-%m-%dT%H:%M:%fZ', 'now'),
    strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
  FROM items
  WHERE category IS NOT NULL AND category <> ''
  GROUP BY category COLLATE NOCASE;
  `,
  // v7 — grid maps for drawers and other partitioned containers
  //
  // A container (a drawer, a tray) gets grid_cols x grid_rows; each child
  // location that physically sits inside it gets a footprint and an origin
  // cell. Placement lives on the child so that moving a bin between drawers is
  // a single-row update, and so a bin can only appear on one grid at a time.
  //
  // grid_w/grid_h are the bin's unrotated footprint and grid_rot is the
  // rotation in degrees (0, 90, 180 or 270); the effective footprint swaps w
  // and h at 90 and 270. Storing rotation separately keeps the bin's own
  // dimensions stable as it is turned to fit, which is the whole point of a
  // Gridfinity-style tray. Columns stay nullable: a location without a grid is
  // just a container, and a child without a footprint is simply not placed yet.
  `
  ALTER TABLE locations ADD COLUMN grid_cols INTEGER;
  ALTER TABLE locations ADD COLUMN grid_rows INTEGER;
  ALTER TABLE locations ADD COLUMN grid_x INTEGER;
  ALTER TABLE locations ADD COLUMN grid_y INTEGER;
  ALTER TABLE locations ADD COLUMN grid_w INTEGER;
  ALTER TABLE locations ADD COLUMN grid_h INTEGER;
  ALTER TABLE locations ADD COLUMN grid_rot INTEGER NOT NULL DEFAULT 0;
  `,
  // v8 — one location can be marked as the unsorted staging area
  //
  // Sorting means having somewhere for parts that are not filed yet. Rather than
  // inventing a second kind of record, one location carries the flag; the map
  // screen reads it and lists what is waiting to be put away. Only one location
  // can hold it at a time, which is enforced when the flag is set.
  `
  ALTER TABLE locations ADD COLUMN is_staging INTEGER NOT NULL DEFAULT 0;
  `,
  // v9 — equipment racks: a location can be a rack of U slots
  //
  // A rack is one-dimensional, 42U in a full cabinet, and its slots hold things
  // that are not containers: a switch, a server, a UPS. Those are items, so a
  // mount points at either an item or a location (a rack shelf, which is a child
  // location and holds its own items). Exactly one of the two is set, enforced
  // by the table, and a rack can hold a given item or shelf only once.
  `
  ALTER TABLE locations ADD COLUMN rack_units INTEGER;

  CREATE TABLE rack_mounts (
    id TEXT PRIMARY KEY,
    rack_location_id TEXT NOT NULL REFERENCES locations(id) ON DELETE CASCADE,
    item_id TEXT REFERENCES items(id) ON DELETE CASCADE,
    location_id TEXT REFERENCES locations(id) ON DELETE CASCADE,
    u_start INTEGER NOT NULL CHECK (u_start >= 1),
    u_height INTEGER NOT NULL CHECK (u_height >= 1),
    note TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    CHECK (
      (item_id IS NOT NULL AND location_id IS NULL) OR
      (item_id IS NULL AND location_id IS NOT NULL)
    )
  );
  CREATE INDEX idx_rack_mounts_rack ON rack_mounts(rack_location_id, u_start);
  CREATE UNIQUE INDEX idx_rack_mounts_item
    ON rack_mounts(rack_location_id, item_id) WHERE item_id IS NOT NULL;
  CREATE UNIQUE INDEX idx_rack_mounts_location
    ON rack_mounts(rack_location_id, location_id) WHERE location_id IS NOT NULL;
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

let transactionDepth = 0;

/**
 * Run a function inside a transaction. Nested calls join the outer transaction
 * so small helpers can stay atomic when composed by callers.
 */
export function transaction<T>(fn: () => T): T {
  if (transactionDepth > 0) {
    transactionDepth += 1;
    try {
      return fn();
    } finally {
      transactionDepth -= 1;
    }
  }

  db.exec('BEGIN IMMEDIATE');
  transactionDepth = 1;
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
  } finally {
    transactionDepth = 0;
  }
}

export function nowIso(): string {
  return new Date().toISOString();
}
