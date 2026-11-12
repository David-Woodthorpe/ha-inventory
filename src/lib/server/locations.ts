import { randomUUID } from 'node:crypto';
import { db, nowIso, transaction } from './db';
import { conflict, notFound } from './errors';
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
  created_at: string;
  updated_at: string;
}

function allRows(): LocationRow[] {
  return db
    .prepare('SELECT * FROM locations ORDER BY sort_order ASC, name COLLATE NOCASE ASC')
    .all() as unknown as LocationRow[];
}

function directItemCounts(): Map<string, number> {
  const rows = db
    .prepare(
      `SELECT location_id, COUNT(*) AS count
       FROM items
       WHERE archived = 0 AND location_id IS NOT NULL
       GROUP BY location_id`
    )
    .all() as unknown as Array<{ location_id: string; count: number }>;
  return new Map(rows.map((row) => [row.location_id, Number(row.count)]));
}

export function getLocations(): Location[] {
  const rows = allRows();
  const byId = new Map(rows.map((row) => [row.id, row]));
  const counts = directItemCounts();
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

  const totals = new Map<string, number>();
  for (const row of rows) {
    const direct = counts.get(row.id) ?? 0;
    const path = pathOf(row.id);
    for (const ancestorId of path.ids) {
      totals.set(ancestorId, (totals.get(ancestorId) ?? 0) + direct);
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
      total_item_count: totals.get(row.id) ?? 0,
      child_count: childCounts.get(row.id) ?? 0,
      ha_enabled: Boolean(row.ha_enabled),
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
    `INSERT INTO locations (id, name, parent_id, description, code, sort_order, ha_enabled, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    id,
    data.name,
    data.parent_id ?? null,
    data.description ?? null,
    data.code ?? null,
    data.sort_order ?? 0,
    data.ha_enabled ? 1 : 0,
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

  const fields: string[] = [];
  const values: unknown[] = [];
  const map: Array<[keyof typeof data, string]> = [
    ['name', 'name'],
    ['parent_id', 'parent_id'],
    ['description', 'description'],
    ['code', 'code'],
    ['sort_order', 'sort_order'],
    ['ha_enabled', 'ha_enabled']
  ];
  for (const [key, column] of map) {
    if (data[key] !== undefined) {
      fields.push(`${column} = ?`);
      values.push(key === 'ha_enabled' ? (data.ha_enabled ? 1 : 0) : data[key] === undefined ? null : data[key]);
    }
  }
  if (!fields.length) return existing;
  fields.push('updated_at = ?');
  values.push(nowIso(), id);
  db.prepare(`UPDATE locations SET ${fields.join(', ')} WHERE id = ?`).run(...(values as never[]));
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
