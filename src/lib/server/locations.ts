import { randomUUID } from 'node:crypto';
import { db, nowIso, transaction } from './db';
import { conflict, notFound, badRequest } from './errors';
import { effectiveFootprint, fitsInGrid, normaliseRotation } from '$lib/grid';
import { locationCreateSchema, locationUpdateSchema, parseWith } from './schemas';
import type { Location, LocationNode } from '$lib/types';

interface LocationRow {
  id: string;
  name: string;
  parent_id: string | null;
  description: string | null;
  code: string | null;
  sort_order: number;
  ha_enabled: number;
  grid_cols: number | null;
  grid_rows: number | null;
  grid_x: number | null;
  grid_y: number | null;
  grid_w: number | null;
  grid_h: number | null;
  grid_rot: number;
  created_at: string;
  updated_at: string;
}

function allRows(): LocationRow[] {
  return db
    .prepare('SELECT * FROM locations ORDER BY sort_order ASC, name COLLATE NOCASE ASC')
    .all() as unknown as LocationRow[];
}

function itemLocationIndex(): {
  counts: Map<string, number>;
  itemIdsByLocation: Map<string, Set<string>>;
} {
  const rows = db
    .prepare(
      `SELECT DISTINCT item_id, location_id
       FROM (
         SELECT s.item_id AS item_id, s.location_id AS location_id
         FROM item_stock s
         JOIN items i ON i.id = s.item_id
         WHERE i.archived = 0 AND s.location_id IS NOT NULL
         UNION
         SELECT i.id AS item_id, i.location_id AS location_id
         FROM items i
         WHERE i.archived = 0 AND i.location_id IS NOT NULL
       )`
    )
    .all() as unknown as Array<{ item_id: string; location_id: string }>;

  const itemIdsByLocation = new Map<string, Set<string>>();
  for (const row of rows) {
    const set = itemIdsByLocation.get(row.location_id) ?? new Set<string>();
    set.add(row.item_id);
    itemIdsByLocation.set(row.location_id, set);
  }

  return {
    counts: new Map(
      Array.from(itemIdsByLocation, ([locationId, itemIds]) => [locationId, itemIds.size])
    ),
    itemIdsByLocation
  };
}

export function getLocations(): Location[] {
  const rows = allRows();
  const byId = new Map(rows.map((row) => [row.id, row]));
  const { counts, itemIdsByLocation } = itemLocationIndex();
  const pathCache = new Map<string, { ids: string[]; names: string[] }>();

  function pathOf(id: string, seen = new Set<string>()): { ids: string[]; names: string[] } {
    const cached = pathCache.get(id);
    if (cached) return cached;
    const row = byId.get(id);
    if (!row) return { ids: [], names: [] };
    if (seen.has(id)) return { ids: [id], names: [row.name] };
    seen.add(id);
    const parent = row.parent_id ? pathOf(row.parent_id, seen) : { ids: [], names: [] };
    const result = { ids: [...parent.ids, id], names: [...parent.names, row.name] };
    pathCache.set(id, result);
    return result;
  }

  const childCounts = new Map<string, number>();
  for (const row of rows) {
    if (row.parent_id) childCounts.set(row.parent_id, (childCounts.get(row.parent_id) ?? 0) + 1);
  }

  const totalSets = new Map<string, Set<string>>();
  for (const [locationId, itemIds] of itemIdsByLocation) {
    const path = pathOf(locationId);
    for (const itemId of itemIds) {
      for (const ancestorId of path.ids) {
        const set = totalSets.get(ancestorId) ?? new Set<string>();
        set.add(itemId);
        totalSets.set(ancestorId, set);
      }
    }
  }

  const locations = rows.map((row) => {
    const path = pathOf(row.id);
    return {
      id: row.id,
      name: row.name,
      parent_id: row.parent_id,
      description: row.description,
      code: row.code,
      sort_order: row.sort_order,
      path: path.names,
      path_ids: path.ids,
      path_label: path.names.join(' / '),
      depth: path.names.length - 1,
      direct_item_count: counts.get(row.id) ?? 0,
      total_item_count: totalSets.get(row.id)?.size ?? 0,
      child_count: childCounts.get(row.id) ?? 0,
      ha_enabled: Boolean(row.ha_enabled),
      grid_cols: row.grid_cols ?? null,
      grid_rows: row.grid_rows ?? null,
      grid_x: row.grid_x ?? null,
      grid_y: row.grid_y ?? null,
      grid_w: row.grid_w ?? null,
      grid_h: row.grid_h ?? null,
      grid_rot: normaliseRotation(row.grid_rot),
      created_at: row.created_at,
      updated_at: row.updated_at
    } satisfies Location;
  });

  return locations.sort((a, b) => a.path_label.localeCompare(b.path_label));
}

export function getLocation(id: string): Location {
  const location = getLocations().find((entry) => entry.id === id);
  if (!location) throw notFound('Location', id);
  return location;
}

export function getLocationOrNull(id: string | null | undefined): Location | null {
  if (!id) return null;
  return getLocations().find((entry) => entry.id === id) ?? null;
}

export function getDescendantIds(id: string): string[] {
  const rows = allRows();
  if (!rows.some((row) => row.id === id)) return [];
  const childrenByParent = new Map<string, string[]>();
  for (const row of rows) {
    if (!row.parent_id) continue;
    const list = childrenByParent.get(row.parent_id) ?? [];
    list.push(row.id);
    childrenByParent.set(row.parent_id, list);
  }
  const result: string[] = [];
  const queue = [id];
  const seen = new Set<string>();
  while (queue.length) {
    const current = queue.shift()!;
    if (seen.has(current)) continue;
    seen.add(current);
    result.push(current);
    queue.push(...(childrenByParent.get(current) ?? []));
  }
  return result;
}

export function createLocation(input: unknown): Location {
  const data = parseWith(locationCreateSchema, input);
  const parent = data.parent_id ? getLocation(data.parent_id) : null;
  if (data.parent_id && !parent) throw notFound('Parent location', data.parent_id);
  const id = randomUUID();
  const now = nowIso();
  db.prepare(
    `INSERT INTO locations (id, name, parent_id, description, code, sort_order, ha_enabled, grid_cols, grid_rows, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    id,
    data.name,
    data.parent_id ?? null,
    data.description ?? null,
    data.code ?? null,
    data.sort_order ?? 0,
    data.ha_enabled ? 1 : 0,
    data.grid_cols ?? null,
    data.grid_rows ?? null,
    now,
    now
  );
  return getLocation(id);
}

export function updateLocation(id: string, input: unknown): Location {
  const existing = getLocation(id);
  const data = parseWith(locationUpdateSchema, input);

  if (data.parent_id !== undefined && data.parent_id !== null) {
    if (data.parent_id === id) {
      throw conflict('A location cannot be its own parent');
    }
    if (getDescendantIds(id).includes(data.parent_id)) {
      throw conflict('A location cannot be moved inside one of its own descendants');
    }
    const parent = getLocationOrNull(data.parent_id);
    if (!parent) throw notFound('Parent location', data.parent_id);
  }

  const nextCols = data.grid_cols === undefined ? existing.grid_cols : data.grid_cols;
  const nextRows = data.grid_rows === undefined ? existing.grid_rows : data.grid_rows;
  if ((nextCols === null) !== (nextRows === null)) {
    throw badRequest('grid_cols and grid_rows must be set together, or both left empty');
  }

  const gridChanged = nextCols !== existing.grid_cols || nextRows !== existing.grid_rows;
  if (gridChanged && nextCols !== null && nextRows !== null) {
    // Shrinking a grid can leave currently placed bins hanging over the edge.
    // Refuse the resize rather than silently dropping their positions.
    const strays = db
      .prepare(
        `SELECT id, name, grid_x, grid_y, grid_w, grid_h, grid_rot FROM locations
         WHERE parent_id = ? AND grid_x IS NOT NULL AND grid_y IS NOT NULL
           AND grid_w IS NOT NULL AND grid_h IS NOT NULL`
      )
      .all(id) as Array<{
        id: string;
        name: string;
        grid_x: number;
        grid_y: number;
        grid_w: number;
        grid_h: number;
        grid_rot: number;
      }>;
    const offending = strays
      .filter((row) => !fitsInGrid(row.grid_x, row.grid_y, row.grid_w, row.grid_h, row.grid_rot, nextCols, nextRows))
      .map((row) => ({ location_id: row.id, name: row.name }));
    if (offending.length > 0) {
      throw conflict(
        `This grid cannot shrink to ${nextCols}x${nextRows}: ${offending.length} bin(s) would fall outside it. Move or remove those bins first.`,
        { bins: offending }
      );
    }
  }

  const fields: string[] = [];
  const values: unknown[] = [];
  const map: Array<[keyof typeof data, string]> = [
    ['name', 'name'],
    ['parent_id', 'parent_id'],
    ['description', 'description'],
    ['code', 'code'],
    ['sort_order', 'sort_order'],
    ['ha_enabled', 'ha_enabled'],
    ['grid_cols', 'grid_cols'],
    ['grid_rows', 'grid_rows']
  ];
  for (const [key, column] of map) {
    if (data[key] !== undefined) {
      fields.push(`${column} = ?`);
      values.push(key === 'ha_enabled' ? (data.ha_enabled ? 1 : 0) : data[key] === undefined ? null : data[key]);
    }
  }

  // A placement describes a cell on the current parent's grid. Once the parent
  // changes, those coordinates mean something different, so the bin loses its
  // position — but its footprint and rotation belong to the bin itself and are
  // kept, so a 2x2 caddy is still a 2x2 caddy in the next drawer.
  const parentChanged = data.parent_id !== undefined && data.parent_id !== existing.parent_id && data.parent_id !== null;
  if (parentChanged) {
    fields.push('grid_x = NULL', 'grid_y = NULL');
  }

  if (!fields.length) return existing;
  fields.push('updated_at = ?');
  values.push(nowIso(), id);

  transaction(() => {
    db.prepare(`UPDATE locations SET ${fields.join(', ')} WHERE id = ?`).run(...(values as never[]));
    if (gridChanged && nextCols === null) {
      // No grid, no positions: children keep their own footprint but are no
      // longer placed anywhere.
      db.prepare(`UPDATE locations SET grid_x = NULL, grid_y = NULL WHERE parent_id = ?`).run(id);
    }
  });
  return getLocation(id);
}

export function deleteLocation(id: string): void {
  const location = getLocation(id);
  if (location.child_count > 0) {
    throw conflict('Location still has sub-locations. Move or delete them first.', {
      child_count: location.child_count
    });
  }
  if (location.direct_item_count > 0) {
    throw conflict('Location still contains items. Move them somewhere else first.', {
      item_count: location.direct_item_count
    });
  }
  const attachment = db
    .prepare('SELECT COUNT(*) AS count FROM attachments WHERE location_id = ?')
    .get(id) as unknown as { count: number };
  if (Number(attachment.count) > 0) {
    throw conflict('Location still has photos or documents attached. Remove them first.', {
      attachment_count: Number(attachment.count)
    });
  }
  transaction(() => {
    db.prepare('DELETE FROM locations WHERE id = ?').run(id);
  });
}

export function locationTree(): LocationNode[] {
  const locations = getLocations();
  const byParent = new Map<string | null, Location[]>();
  for (const location of locations) {
    const list = byParent.get(location.parent_id) ?? [];
    list.push(location);
    byParent.set(location.parent_id, list);
  }
  const build = (parentId: string | null): LocationNode[] =>
    (byParent.get(parentId) ?? [])
      .slice()
      .sort((a, b) => a.sort_order - b.sort_order || a.name.localeCompare(b.name))
      .map((location) => ({ ...location, children: build(location.id) }));
  return build(null);
}

export function locationBreadcrumb(location: Location): Array<{ id: string; name: string }> {
  return location.path_ids.map((id, index) => ({ id, name: location.path[index] }));
}
