import { randomUUID } from 'node:crypto';
import { rmSync } from 'node:fs';
import path from 'node:path';
import type { Attachment, Item, ItemDetail, ItemListParams, ItemListResult } from '$lib/types';
import { db, nowIso, transaction } from './db';
import { defaultCurrency, uploadDir } from './config';
import { ApiError, conflict, notFound } from './errors';
import { getDescendantIds, getLocations } from './locations';
import {
  itemCreateSchema,
  itemUpdateSchema,
  parseWith,
  stockAdjustSchema,
  type ItemInput
} from './schemas';
import {
  round2,
  toAttachment,
  toItem,
  toMovement,
  type HydrateContext,
  type ItemRow
} from './serialize';

type SqlValue = string | number | null;

const itemColumns = [
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
  'archived'
] as const;

function escapeLike(value: string): string {
  return value.replace(/[\\%_]/g, (char) => `\\${char}`);
}

function hydrateContext(itemIds: string[]): HydrateContext {
  const locations = new Map(getLocations().map((location) => [location.id, location]));
  const attachmentsByItem = new Map<string, Attachment[]>();
  if (itemIds.length) {
    const placeholders = itemIds.map(() => '?').join(', ');
    const rows = db
      .prepare(
        `SELECT * FROM attachments WHERE item_id IN (${placeholders}) ORDER BY created_at ASC, original_name ASC`
      )
      .all(...itemIds) as unknown as Array<Record<string, unknown>>;
    for (const row of rows) {
      const attachment = toAttachment(row);
      if (!attachment.item_id) continue;
      const list = attachmentsByItem.get(attachment.item_id) ?? [];
      list.push(attachment);
      attachmentsByItem.set(attachment.item_id, list);
    }
  }
  return { locations, attachmentsByItem };
}

function getItemRow(id: string): ItemRow {
  const row = db.prepare('SELECT * FROM items WHERE id = ?').get(id) as unknown as ItemRow | undefined;
  if (!row) throw notFound('Item', id);
  return row;
}

export function listItems(params: ItemListParams = {}): ItemListResult {
  const where: string[] = [];
  const args: SqlValue[] = [];

  if (!params.include_archived) where.push('items.archived = 0');

  if (params.q?.trim()) {
    const tokens = params.q.trim().toLowerCase().split(/\s+/).slice(0, 8);
    for (const token of tokens) {
      const like = `%${escapeLike(token)}%`;
      where.push(`(
        items.name LIKE ? ESCAPE '\\' OR
        items.sku LIKE ? ESCAPE '\\' OR
        items.description LIKE ? ESCAPE '\\' OR
        items.category LIKE ? ESCAPE '\\' OR
        items.manufacturer LIKE ? ESCAPE '\\' OR
        items.mpn LIKE ? ESCAPE '\\' OR
        items.supplier LIKE ? ESCAPE '\\' OR
        items.notes LIKE ? ESCAPE '\\' OR
        items.tags LIKE ? ESCAPE '\\' OR
        items.custom_fields LIKE ? ESCAPE '\\'
      )`);
      args.push(like, like, like, like, like, like, like, like, like, like);
    }
  }

  if (params.category) {
    where.push('items.category = ? COLLATE NOCASE');
    args.push(params.category);
  }

  if (params.tag) {
    where.push('EXISTS (SELECT 1 FROM json_each(items.tags) WHERE json_each.value = ? COLLATE NOCASE)');
    args.push(params.tag);
  }

  if (params.location_id) {
    const ids =
      params.include_descendants === false
        ? [params.location_id]
        : getDescendantIds(params.location_id);
    if (ids.length === 0) {
      where.push('0 = 1');
    } else {
      where.push(`items.location_id IN (${ids.map(() => '?').join(', ')})`);
      args.push(...ids);
    }
  }

  if (params.low_stock) {
    where.push('items.min_quantity > 0 AND items.quantity <= items.min_quantity');
  }

  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';

  const sortMap: Record<string, string> = {
    name: 'items.name COLLATE NOCASE',
    category: 'items.category COLLATE NOCASE',
    quantity: 'items.quantity',
    updated_at: 'items.updated_at',
    created_at: 'items.created_at',
    value: '(COALESCE(items.price, 0) * items.quantity)'
  };
  const sort = sortMap[params.sort ?? 'name'] ?? sortMap.name;
  const order = params.order === 'desc' ? 'DESC' : 'ASC';
  const limit = Math.max(1, Math.min(100000, params.limit ?? 50));
  const offset = Math.max(0, params.offset ?? 0);

  const totalRow = db
    .prepare(`SELECT COUNT(*) AS total FROM items ${whereSql}`)
    .get(...args) as unknown as { total: number };
  const total = Number(totalRow?.total ?? 0);

  const rows = db
    .prepare(
      `SELECT items.* FROM items ${whereSql}
       ORDER BY ${sort} ${order}, items.name COLLATE NOCASE ASC
       LIMIT ? OFFSET ?`
    )
    .all(...args, limit, offset) as unknown as ItemRow[];

  const ctx = hydrateContext(rows.map((row) => row.id));
  return { items: rows.map((row) => toItem(row, ctx)), total };
}

export function getItem(id: string): ItemDetail {
  const row = getItemRow(id);
  const ctx = hydrateContext([row.id]);
  const movements = db
    .prepare('SELECT * FROM stock_movements WHERE item_id = ? ORDER BY created_at DESC, rowid DESC LIMIT 100')
    .all(id) as unknown as Array<Record<string, unknown>>;
  return {
    ...toItem(row, ctx),
    movements: movements.map(toMovement)
  };
}

function ensureLocationExists(locationId: string | null | undefined): void {
  if (!locationId) return;
  const row = db.prepare('SELECT id FROM locations WHERE id = ?').get(locationId);
  if (!row) throw notFound('Location', locationId);
}

function ensureSkuAvailable(sku: string | null | undefined, excludeId?: string): void {
  if (!sku) return;
  const row = db
    .prepare('SELECT id FROM items WHERE sku = ? COLLATE NOCASE AND id <> ?')
    .get(sku, excludeId ?? '') as unknown as { id: string } | undefined;
  if (row) {
    throw conflict(`An item with SKU "${sku}" already exists`, { sku, existing_item_id: row.id });
  }
}

function normalizeTags(tags: string[] | undefined): string[] {
  if (!tags) return [];
  return Array.from(new Set(tags.map((tag) => tag.trim()).filter(Boolean))).slice(0, 100);
}

function serializeValue(column: (typeof itemColumns)[number], value: unknown): SqlValue {
  if (column === 'tags' || column === 'custom_fields') return JSON.stringify(value ?? (column === 'tags' ? [] : {}));
  if (column === 'archived') return value ? 1 : 0;
  if (typeof value === 'number') return value;
  if (value === undefined || value === null) return null;
  return String(value);
}

function addMovement(itemId: string, delta: number, reason: string | null, note: string | null): void {
  if (delta === 0) return;
  db.prepare(
    'INSERT INTO stock_movements (id, item_id, delta, reason, note, created_at) VALUES (?, ?, ?, ?, ?, ?)'
  ).run(randomUUID(), itemId, delta, reason, note, nowIso());
}

export function createItem(input: unknown): ItemDetail {
  const data = parseWith(itemCreateSchema, input) as ItemInput;
  ensureLocationExists(data.location_id);
  ensureSkuAvailable(data.sku);

  const id = randomUUID();
  const now = nowIso();
  const quantity = data.quantity ?? 0;
  const values: SqlValue[] = [
    id,
    data.name,
    data.sku ?? null,
    data.description ?? null,
    data.category ?? null,
    quantity,
    data.unit || 'pcs',
    data.min_quantity ?? 0,
    data.location_id ?? null,
    data.manufacturer ?? null,
    data.mpn ?? null,
    data.supplier ?? null,
    data.supplier_url ?? null,
    data.price ?? null,
    data.currency || defaultCurrency,
    data.datasheet_url ?? null,
    data.notes ?? null,
    JSON.stringify(normalizeTags(data.tags)),
    JSON.stringify(data.custom_fields ?? {}),
    data.archived ? 1 : 0,
    now,
    now
  ];

  transaction(() => {
    db.prepare(
      `INSERT INTO items (
        id, name, sku, description, category, quantity, unit, min_quantity, location_id,
        manufacturer, mpn, supplier, supplier_url, price, currency, datasheet_url, notes,
        tags, custom_fields, archived, created_at, updated_at
      ) VALUES (${values.map(() => '?').join(', ')})`
    ).run(...values);
    if (quantity > 0) addMovement(id, quantity, 'initial', 'Initial stock level');
  });

  return getItem(id);
}

export function updateItem(id: string, input: unknown): ItemDetail {
  const existing = getItemRow(id);
  const data = parseWith(itemUpdateSchema, input) as Record<string, unknown>;

  if ('location_id' in data) ensureLocationExists(data.location_id as string | null);
  if ('sku' in data) ensureSkuAvailable(data.sku as string | null, id);

  const fields: string[] = [];
  const values: SqlValue[] = [];
  for (const column of itemColumns) {
    if (!(column in data)) continue;
    const value = data[column];
    if (column === 'tags') {
      fields.push('tags = ?');
      values.push(JSON.stringify(normalizeTags(value as string[])));
    } else if (column === 'quantity') {
      fields.push('quantity = ?');
      values.push(Number(value));
    } else if (column === 'unit') {
      fields.push('unit = ?');
      values.push(String(value || 'pcs'));
    } else if (column === 'currency') {
      fields.push('currency = ?');
      values.push(String(value || defaultCurrency));
    } else {
      fields.push(`${column} = ?`);
      values.push(serializeValue(column, value));
    }
  }

  const quantityChanged = 'quantity' in data && Number(data.quantity) !== Number(existing.quantity);
  if (!fields.length) return getItem(id);

  fields.push('updated_at = ?');
  values.push(nowIso(), id);

  transaction(() => {
    db.prepare(`UPDATE items SET ${fields.join(', ')} WHERE id = ?`).run(...values);
    if (quantityChanged) {
      addMovement(
        id,
        Number(data.quantity) - Number(existing.quantity),
        'correction',
        'Quantity changed while editing the item'
      );
    }
  });

  return getItem(id);
}

export function deleteItem(id: string): void {
  getItemRow(id);
  const attachments = db
    .prepare('SELECT filename FROM attachments WHERE item_id = ?')
    .all(id) as unknown as Array<{ filename: string }>;
  db.prepare('DELETE FROM items WHERE id = ?').run(id);
  for (const attachment of attachments) {
    try {
      rmSync(path.join(uploadDir, attachment.filename), { force: true });
    } catch {
      // a missing file should not block deletion
    }
  }
}

export function adjustStock(id: string, input: unknown): ItemDetail {
  const data = parseWith(stockAdjustSchema, input);
  const existing = getItemRow(id);
  const current = Number(existing.quantity);
  const next = data.set !== undefined ? data.set : current + (data.delta ?? 0);
  const rounded = Math.round((next + Number.EPSILON) * 1e6) / 1e6;
  if (rounded < 0) {
    throw conflict(`Not enough stock: ${current} ${existing.unit} on hand, tried to remove ${Math.abs(data.delta ?? 0)}`, {
      current_quantity: current,
      requested_quantity: rounded,
      unit: existing.unit
    });
  }
  const delta = Math.round((rounded - current + Number.EPSILON) * 1e6) / 1e6;

  transaction(() => {
    db.prepare('UPDATE items SET quantity = ?, updated_at = ? WHERE id = ?').run(rounded, nowIso(), id);
    addMovement(id, delta, data.reason ?? null, data.note ?? null);
  });

  return getItem(id);
}

export interface BulkResult {
  created: ItemDetail[];
  errors: Array<{ index: number; code: string; message: string; details?: unknown }>;
}

export function bulkCreateItems(inputs: unknown[]): BulkResult {
  const created: ItemDetail[] = [];
  const errors: BulkResult['errors'] = [];
  inputs.forEach((input, index) => {
    try {
      created.push(createItem(input));
    } catch (error) {
      if (error instanceof ApiError) {
        errors.push({ index, code: error.code, message: error.message, details: error.details });
      } else {
        errors.push({
          index,
          code: 'internal_error',
          message: error instanceof Error ? error.message : 'Unknown error'
        });
      }
    }
  });
  return { created, errors };
}

export function exportAll() {
  const items = listItems({ include_archived: true, limit: 100000, sort: 'created_at', order: 'asc' }).items;
  const attachments = (
    db.prepare('SELECT * FROM attachments ORDER BY created_at ASC').all() as unknown as Array<
      Record<string, unknown>
    >
  ).map(toAttachment);
  const movements = (
    db.prepare('SELECT * FROM stock_movements ORDER BY created_at ASC').all() as unknown as Array<
      Record<string, unknown>
    >
  ).map(toMovement);
  return {
    exported_at: nowIso(),
    schema_version: 1,
    locations: getLocations(),
    items,
    attachments,
    movements
  };
}

export function itemSummaryCounts() {
  const row = db
    .prepare(
      `SELECT
        COUNT(*) AS item_count,
        COALESCE(SUM(quantity), 0) AS total_units,
        COALESCE(SUM(CASE WHEN price IS NOT NULL THEN price * quantity ELSE 0 END), 0) AS total_value,
        COALESCE(SUM(CASE WHEN min_quantity > 0 AND quantity <= min_quantity THEN 1 ELSE 0 END), 0) AS low_stock_count
       FROM items WHERE archived = 0`
    )
    .get() as unknown as {
    item_count: number;
    total_units: number;
    total_value: number;
    low_stock_count: number;
  };
  return {
    item_count: Number(row.item_count),
    total_units: Number(row.total_units),
    total_value: round2(Number(row.total_value)),
    low_stock_count: Number(row.low_stock_count)
  };
}

export function getItemAttachments(id: string): Attachment[] {
  const rows = db
    .prepare('SELECT * FROM attachments WHERE item_id = ? ORDER BY created_at ASC')
    .all(id) as unknown as Array<Record<string, unknown>>;
  return rows.map(toAttachment);
}

export type { Item };
