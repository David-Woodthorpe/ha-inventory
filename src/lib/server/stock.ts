import { randomUUID } from 'node:crypto';
import type {
  ItemAllocation,
  ItemStockLot,
  Location,
  StockMovement
} from '$lib/types';
import { db, nowIso, transaction } from './db';
import { conflict, notFound } from './errors';
import { getLocations } from './locations';
import {
  allocationReturnSchema,
  componentSignOutSchema,
  parseWith,
  stockTransferSchema
} from './schemas';
import { toLocationRef, toMovement } from './serialize';

const QUANTITY_EPSILON = 1e-6;

export function roundQuantity(value: number): number {
  return Math.round((value + Number.EPSILON) * 1e6) / 1e6;
}

interface ItemIdentityRow {
  id: string;
  name: string;
  sku: string | null;
  unit: string;
  quantity: number;
  location_id: string | null;
  archived: number;
}

interface StockRow {
  id: string;
  item_id: string;
  location_id: string | null;
  quantity: number;
  created_at: string;
  updated_at: string;
}

interface AllocationRow {
  id: string;
  component_item_id: string;
  host_item_id: string;
  quantity: number;
  source_location_id: string | null;
  note: string | null;
  created_at: string;
  updated_at: string;
  component_name: string;
  component_sku: string | null;
  component_unit: string;
  host_name: string;
  host_sku: string | null;
  host_unit: string;
}

export interface MovementInput {
  delta: number;
  reason?: string | null;
  note?: string | null;
  location_id?: string | null;
  to_location_id?: string | null;
}

export interface StockChangeOptions {
  reason?: string | null;
  note?: string | null;
}

function itemIdentity(id: string): ItemIdentityRow {
  const row = db
    .prepare('SELECT id, name, sku, unit, quantity, location_id, archived FROM items WHERE id = ?')
    .get(id) as unknown as ItemIdentityRow | undefined;
  if (!row) throw notFound('Item', id);
  return row;
}

function ensureLocationExists(locationId: string | null | undefined): void {
  if (!locationId) return;
  const row = db.prepare('SELECT id FROM locations WHERE id = ?').get(locationId);
  if (!row) throw notFound('Location', locationId);
}

function stockRows(itemId: string): StockRow[] {
  return db
    .prepare('SELECT * FROM item_stock WHERE item_id = ? ORDER BY created_at ASC, id ASC')
    .all(itemId) as unknown as StockRow[];
}

function stockRowAt(itemId: string, locationId: string | null): StockRow | undefined {
  return db
    .prepare(
      `SELECT * FROM item_stock
       WHERE item_id = ? AND COALESCE(location_id, '') = COALESCE(?, '')`
    )
    .get(itemId, locationId) as unknown as StockRow | undefined;
}

function toStockLot(row: StockRow, locations: Map<string, Location>): ItemStockLot {
  const location = row.location_id ? locations.get(row.location_id) : undefined;
  return {
    id: row.id,
    item_id: row.item_id,
    location_id: row.location_id,
    location: toLocationRef(location),
    quantity: Number(row.quantity),
    created_at: row.created_at,
    updated_at: row.updated_at
  };
}

function toAllocation(row: AllocationRow, locations: Map<string, Location>): ItemAllocation {
  const location = row.source_location_id ? locations.get(row.source_location_id) : undefined;
  return {
    id: row.id,
    component_item_id: row.component_item_id,
    component: {
      id: row.component_item_id,
      name: row.component_name,
      sku: row.component_sku,
      unit: row.component_unit
    },
    host_item_id: row.host_item_id,
    host: {
      id: row.host_item_id,
      name: row.host_name,
      sku: row.host_sku,
      unit: row.host_unit
    },
    quantity: Number(row.quantity),
    source_location_id: row.source_location_id,
    source_location: toLocationRef(location),
    note: row.note,
    created_at: row.created_at,
    updated_at: row.updated_at
  };
}

/**
 * Recompute the cached item total and primary location from its stock lots.
 * When every lot is empty the existing primary location is kept so an
 * out-of-stock item still appears where it belongs. Callers that deliberately
 * move an empty item pass a fallback.
 */
function recalculateItemStock(
  itemId: string,
  fallbackLocationId?: string | null
): { quantity: number; location_id: string | null } {
  const rows = stockRows(itemId);
  const total = roundQuantity(rows.reduce((sum, row) => sum + Number(row.quantity), 0));
  const existing = db
    .prepare('SELECT location_id FROM items WHERE id = ?')
    .get(itemId) as unknown as { location_id: string | null } | undefined;
  let primary = existing?.location_id ?? null;

  const nonEmpty = rows
    .filter((row) => Number(row.quantity) > QUANTITY_EPSILON)
    .sort(
      (a, b) =>
        Number(b.quantity) - Number(a.quantity) ||
        a.created_at.localeCompare(b.created_at) ||
        a.id.localeCompare(b.id)
    );

  if (nonEmpty.length) {
    primary = nonEmpty[0].location_id;
  } else if (fallbackLocationId !== undefined) {
    primary = fallbackLocationId;
  }

  db.prepare('UPDATE items SET quantity = ?, location_id = ?, updated_at = ? WHERE id = ?').run(
    total,
    primary,
    nowIso(),
    itemId
  );
  return { quantity: total, location_id: primary };
}

function addToLot(itemId: string, locationId: string | null, quantity: number): void {
  const amount = roundQuantity(quantity);
  if (amount <= QUANTITY_EPSILON) return;
  const existing = stockRowAt(itemId, locationId);
  const now = nowIso();
  if (existing) {
    db.prepare('UPDATE item_stock SET quantity = ?, updated_at = ? WHERE id = ?').run(
      roundQuantity(Number(existing.quantity) + amount),
      now,
      existing.id
    );
    return;
  }
  db.prepare(
    `INSERT INTO item_stock (id, item_id, location_id, quantity, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?)`
  ).run(randomUUID(), itemId, locationId, amount, now, now);
}

/** Remove stock from one specific lot, rejecting an insufficient balance. */
function removeFromLot(itemId: string, locationId: string | null, quantity: number): void {
  const amount = roundQuantity(quantity);
  if (amount <= QUANTITY_EPSILON) return;
  const row = stockRowAt(itemId, locationId);
  const available = row ? Number(row.quantity) : 0;
  if (!row || available + QUANTITY_EPSILON < amount) {
    const item = itemIdentity(itemId);
    const location = locationId
      ? (db.prepare('SELECT name FROM locations WHERE id = ?').get(locationId) as unknown as
          | { name: string }
          | undefined)
      : undefined;
    throw conflict(
      `Not enough stock${location ? ` in ${location.name}` : ''}: ${available} ${item.unit} available, tried to remove ${amount}`,
      {
        item_id: itemId,
        location_id: locationId,
        available_quantity: available,
        requested_quantity: amount,
        unit: item.unit
      }
    );
  }
  const remaining = roundQuantity(available - amount);
  if (remaining <= QUANTITY_EPSILON) {
    db.prepare('DELETE FROM item_stock WHERE id = ?').run(row.id);
  } else {
    db.prepare('UPDATE item_stock SET quantity = ?, updated_at = ? WHERE id = ?').run(
      remaining,
      nowIso(),
      row.id
    );
  }
}

/**
 * Remove a quantity across lots, preferring one location and then the largest
 * lots. Used for total-quantity corrections where the user did not pick a bin.
 */
function removeAcrossLots(itemId: string, quantity: number, preferredLocationId?: string | null): void {
  let remaining = roundQuantity(quantity);
  const rows = stockRows(itemId);
  const total = roundQuantity(rows.reduce((sum, row) => sum + Number(row.quantity), 0));
  if (total + QUANTITY_EPSILON < remaining) {
    const item = itemIdentity(itemId);
    throw conflict(
      `Not enough stock: ${total} ${item.unit} on hand, tried to remove ${remaining}`,
      { item_id: itemId, current_quantity: total, requested_quantity: remaining, unit: item.unit }
    );
  }

  const ordered = rows
    .filter((row) => Number(row.quantity) > QUANTITY_EPSILON)
    .sort((a, b) => {
      if (preferredLocationId !== undefined) {
        const aPreferred = a.location_id === preferredLocationId ? 0 : 1;
        const bPreferred = b.location_id === preferredLocationId ? 0 : 1;
        if (aPreferred !== bPreferred) return aPreferred - bPreferred;
      }
      return Number(b.quantity) - Number(a.quantity) || a.created_at.localeCompare(b.created_at);
    });

  for (const row of ordered) {
    if (remaining <= QUANTITY_EPSILON) break;
    const take = Math.min(Number(row.quantity), remaining);
    const left = roundQuantity(Number(row.quantity) - take);
    if (left <= QUANTITY_EPSILON) {
      db.prepare('DELETE FROM item_stock WHERE id = ?').run(row.id);
    } else {
      db.prepare('UPDATE item_stock SET quantity = ?, updated_at = ? WHERE id = ?').run(
        left,
        nowIso(),
        row.id
      );
    }
    remaining = roundQuantity(remaining - take);
  }
}

export function recordMovement(itemId: string, input: MovementInput): void {
  const delta = roundQuantity(input.delta);
  if (delta === 0 && !input.location_id && !input.to_location_id) return;
  db.prepare(
    `INSERT INTO stock_movements
       (id, item_id, delta, reason, note, location_id, to_location_id, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    randomUUID(),
    itemId,
    delta,
    input.reason ?? null,
    input.note ?? null,
    input.location_id ?? null,
    input.to_location_id ?? null,
    nowIso()
  );
}

export function getItemStock(itemId: string): ItemStockLot[] {
  itemIdentity(itemId);
  const locations = new Map(getLocations().map((location) => [location.id, location]));
  return stockRows(itemId)
    .map((row) => toStockLot(row, locations))
    .sort((a, b) =>
      (a.location?.path_label ?? '\uffff').localeCompare(b.location?.path_label ?? '\uffff') ||
      a.created_at.localeCompare(b.created_at)
    );
}

/** Add stock at a location. The item total and primary location are updated. */
export function addStock(
  itemId: string,
  locationId: string | null,
  quantity: number,
  options: StockChangeOptions = {}
): void {
  const amount = roundQuantity(quantity);
  if (amount <= QUANTITY_EPSILON) return;
  ensureLocationExists(locationId);
  transaction(() => {
    addToLot(itemId, locationId, amount);
    recalculateItemStock(itemId);
    recordMovement(itemId, {
      delta: amount,
      reason: options.reason ?? null,
      note: options.note ?? null,
      location_id: locationId
    });
  });
}

/**
 * Set or adjust the total quantity for an item. Positive changes land in the
 * chosen location (the primary location by default); negative changes are taken
 * from that location first and then from other lots.
 */
export function adjustItemStock(
  itemId: string,
  input: { delta?: number; set?: number; location_id?: string | null; reason?: string | null; note?: string | null }
): void {
  const item = itemIdentity(itemId);
  const current = roundQuantity(Number(item.quantity));
  const requested = input.set !== undefined ? Number(input.set) : current + (input.delta ?? 0);
  const next = roundQuantity(requested);
  if (next < 0) {
    throw conflict(
      `Not enough stock: ${current} ${item.unit} on hand, tried to remove ${Math.abs(input.delta ?? next - current)}`,
      { current_quantity: current, requested_quantity: next, unit: item.unit }
    );
  }
  const change = roundQuantity(next - current);
  if (change === 0) return;

  const target =
    input.location_id !== undefined ? input.location_id : (item.location_id ?? null);
  ensureLocationExists(target);

  transaction(() => {
    if (change > 0) {
      addToLot(itemId, target, change);
    } else {
      removeAcrossLots(itemId, -change, target);
    }
    recalculateItemStock(itemId);
    recordMovement(itemId, {
      delta: change,
      reason: input.reason ?? null,
      note: input.note ?? null,
      location_id: target
    });
  });
}

/** Move every unit of an item to one location, merging any existing lots. */
export function moveAllStock(
  itemId: string,
  toLocationId: string | null,
  options: StockChangeOptions = {}
): void {
  ensureLocationExists(toLocationId);
  const item = itemIdentity(itemId);
  if ((item.location_id ?? null) === (toLocationId ?? null)) return;

  transaction(() => {
    const rows = stockRows(itemId);
    const total = roundQuantity(rows.reduce((sum, row) => sum + Number(row.quantity), 0));
    db.prepare('DELETE FROM item_stock WHERE item_id = ?').run(itemId);
    if (total > QUANTITY_EPSILON) addToLot(itemId, toLocationId, total);
    recalculateItemStock(itemId, toLocationId);
    recordMovement(itemId, {
      delta: 0,
      reason: options.reason ?? 'moved',
      note: options.note ?? null,
      location_id: item.location_id,
      to_location_id: toLocationId
    });
  });
}

/** Move part of an item's stock between locations without changing the total. */
export function transferStock(itemId: string, input: unknown): ItemStockLot[] {
  const data = parseWith(stockTransferSchema, input);
  itemIdentity(itemId);
  ensureLocationExists(data.from_location_id);
  ensureLocationExists(data.to_location_id ?? null);

  transaction(() => {
    removeFromLot(itemId, data.from_location_id, data.quantity);
    addToLot(itemId, data.to_location_id ?? null, data.quantity);
    recalculateItemStock(itemId);
    recordMovement(itemId, {
      delta: 0,
      reason: 'transfer',
      note: data.note ?? null,
      location_id: data.from_location_id,
      to_location_id: data.to_location_id ?? null
    });
  });

  return getItemStock(itemId);
}

function allocationQuery(): string {
  return `SELECT a.*,
      c.name AS component_name, c.sku AS component_sku, c.unit AS component_unit,
      h.name AS host_name, h.sku AS host_sku, h.unit AS host_unit
    FROM item_allocations a
    JOIN items c ON c.id = a.component_item_id
    JOIN items h ON h.id = a.host_item_id`;
}

function allocationRow(id: string): AllocationRow {
  const row = db
    .prepare(`${allocationQuery()} WHERE a.id = ?`)
    .get(id) as unknown as AllocationRow | undefined;
  if (!row) throw notFound('Allocation', id);
  return row;
}

export function getAllocation(id: string): ItemAllocation {
  const locations = new Map(getLocations().map((location) => [location.id, location]));
  return toAllocation(allocationRow(id), locations);
}

function getAllocationsWhere(column: 'host_item_id' | 'component_item_id', itemId: string): ItemAllocation[] {
  const locations = new Map(getLocations().map((location) => [location.id, location]));
  const rows = db
    .prepare(`${allocationQuery()} WHERE a.${column} = ? ORDER BY a.created_at DESC, a.id DESC`)
    .all(itemId) as unknown as AllocationRow[];
  return rows.map((row) => toAllocation(row, locations));
}

/** Components installed in this host item. */
export function getHostComponents(hostItemId: string): ItemAllocation[] {
  return getAllocationsWhere('host_item_id', hostItemId);
}

/** Hosts this component is installed in. */
export function getComponentHosts(componentItemId: string): ItemAllocation[] {
  return getAllocationsWhere('component_item_id', componentItemId);
}

export function getAllAllocations(): ItemAllocation[] {
  const locations = new Map(getLocations().map((location) => [location.id, location]));
  const rows = db
    .prepare(`${allocationQuery()} ORDER BY a.created_at ASC, a.id ASC`)
    .all() as unknown as AllocationRow[];
  return rows.map((row) => toAllocation(row, locations));
}

/**
 * Sign a component out to a host item. Stock is removed immediately and an
 * allocation records where it came from so it can be returned later.
 */
export function signOutComponent(input: unknown): ItemAllocation {
  const data = parseWith(componentSignOutSchema, input);
  if (data.component_item_id === data.host_item_id) {
    throw conflict('An item cannot be installed in itself');
  }
  const component = itemIdentity(data.component_item_id);
  const host = itemIdentity(data.host_item_id);
  ensureLocationExists(data.source_location_id ?? null);

  let sourceLocationId: string | null;
  if (data.source_location_id !== undefined) {
    sourceLocationId = data.source_location_id;
  } else {
    const rows = stockRows(component.id)
      .filter((row) => Number(row.quantity) > QUANTITY_EPSILON)
      .sort(
        (a, b) =>
          Number(b.quantity) - Number(a.quantity) || a.created_at.localeCompare(b.created_at)
      );
    if (!rows.length) {
      throw conflict(`No stock of ${component.name} is available to sign out`, {
        item_id: component.id
      });
    }
    sourceLocationId = rows[0].location_id;
  }

  let allocationId = '';
  transaction(() => {
    removeFromLot(component.id, sourceLocationId, data.quantity);
    recalculateItemStock(component.id);

    const existing = db
      .prepare(
        `SELECT id, quantity FROM item_allocations
         WHERE component_item_id = ? AND host_item_id = ?
           AND COALESCE(source_location_id, '') = COALESCE(?, '')
           AND COALESCE(note, '') = COALESCE(?, '')`
      )
      .get(
        component.id,
        host.id,
        sourceLocationId,
        data.note ?? null
      ) as unknown as { id: string; quantity: number } | undefined;

    const now = nowIso();
    if (existing) {
      allocationId = existing.id;
      db.prepare('UPDATE item_allocations SET quantity = ?, updated_at = ? WHERE id = ?').run(
        roundQuantity(Number(existing.quantity) + data.quantity),
        now,
        existing.id
      );
    } else {
      allocationId = randomUUID();
      db.prepare(
        `INSERT INTO item_allocations
           (id, component_item_id, host_item_id, quantity, source_location_id, note, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
      ).run(
        allocationId,
        component.id,
        host.id,
        roundQuantity(data.quantity),
        sourceLocationId,
        data.note ?? null,
        now,
        now
      );
    }

    recordMovement(component.id, {
      delta: -data.quantity,
      reason: 'installed',
      note: data.note ?? `Installed in ${host.name}`,
      location_id: sourceLocationId
    });
  });

  return getAllocation(allocationId);
}

/** Return all or part of a signed-out component to stock. */
export function returnAllocation(
  allocationId: string,
  input: unknown,
  expectedHostId?: string
): ItemAllocation | null {
  const data = parseWith(allocationReturnSchema, input ?? {});
  const allocation = allocationRow(allocationId);
  if (expectedHostId && allocation.host_item_id !== expectedHostId) {
    throw notFound('Allocation', allocationId);
  }
  const available = roundQuantity(Number(allocation.quantity));
  const quantity =
    data.quantity === undefined ? available : roundQuantity(Number(data.quantity));
  if (quantity <= QUANTITY_EPSILON) {
    throw conflict('Return quantity must be greater than zero');
  }
  if (quantity > available + QUANTITY_EPSILON) {
    throw conflict(
      `Only ${available} ${allocation.component_unit} are signed out to ${allocation.host_name}`,
      { allocation_id: allocationId, available_quantity: available, requested_quantity: quantity }
    );
  }

  const component = itemIdentity(allocation.component_item_id);
  const destination =
    allocation.source_location_id ?? component.location_id ?? null;
  ensureLocationExists(destination);

  transaction(() => {
    addToLot(component.id, destination, quantity);
    recalculateItemStock(component.id);

    const remaining = roundQuantity(available - quantity);
    if (remaining <= QUANTITY_EPSILON) {
      db.prepare('DELETE FROM item_allocations WHERE id = ?').run(allocationId);
    } else {
      db.prepare('UPDATE item_allocations SET quantity = ?, updated_at = ? WHERE id = ?').run(
        remaining,
        nowIso(),
        allocationId
      );
    }

    recordMovement(component.id, {
      delta: quantity,
      reason: 'returned',
      note: data.note ?? `Returned from ${allocation.host_name}`,
      location_id: destination
    });
  });

  return remainingAllocation(allocationId);
}

function remainingAllocation(id: string): ItemAllocation | null {
  const row = db.prepare('SELECT id FROM item_allocations WHERE id = ?').get(id);
  return row ? getAllocation(id) : null;
}

/** Block deleting an item that is still installed in, or hosts, components. */
export function ensureItemCanBeDeleted(itemId: string): void {
  const host = db
    .prepare('SELECT COUNT(*) AS count FROM item_allocations WHERE host_item_id = ?')
    .get(itemId) as unknown as { count: number };
  if (Number(host.count) > 0) {
    throw conflict('Item still has components installed. Return them to stock first.', {
      allocation_count: Number(host.count)
    });
  }
  const component = db
    .prepare('SELECT COUNT(*) AS count FROM item_allocations WHERE component_item_id = ?')
    .get(itemId) as unknown as { count: number };
  if (Number(component.count) > 0) {
    throw conflict('Item is installed in another item. Return it to stock first.', {
      allocation_count: Number(component.count)
    });
  }
}

export function getItemMovements(itemId: string, limit = 100): StockMovement[] {
  const locations = new Map(getLocations().map((location) => [location.id, location]));
  const rows = db
    .prepare(
      'SELECT * FROM stock_movements WHERE item_id = ? ORDER BY created_at DESC, rowid DESC LIMIT ?'
    )
    .all(itemId, limit) as unknown as Array<Record<string, unknown>>;
  return rows.map((row) => toMovement(row, locations));
}

export function listAllStock(): ItemStockLot[] {
  const locations = new Map(getLocations().map((location) => [location.id, location]));
  const rows = db
    .prepare('SELECT * FROM item_stock ORDER BY item_id ASC, created_at ASC')
    .all() as unknown as StockRow[];
  return rows.map((row) => toStockLot(row, locations));
}
