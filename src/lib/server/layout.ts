import { db, nowIso, transaction } from './db';
import { badRequest, conflict } from './errors';
import { cellKeys, effectiveFootprint, normaliseRotation } from '$lib/grid';
import { listItems } from './items';
import { getLocation, getLocations } from './locations';
import { layoutSchema, parseWith } from './schemas';
import type {
  BinItem,
  DrawerBin,
  DrawerLayout,
  Location,
  LooseItem,
  StagingArea
} from '$lib/types';

/**
 * What each of these locations holds, item by item.
 *
 * Lots are the truth once an item has been split across bins, and the fallback
 * covers an item whose location_id was set without stock rows yet (for example
 * straight after an import), without double counting rows that exist in both.
 */
function contentsByLocation(locationIds: string[]): Map<string, BinItem[]> {
  const byLocation = new Map<string, BinItem[]>();
  if (locationIds.length === 0) return byLocation;

  const placeholders = locationIds.map(() => '?').join(', ');
  const rows = db
    .prepare(
      `WITH lots AS (
         SELECT s.location_id AS location_id, i.id AS item_id, i.name AS name,
                i.unit AS unit, s.quantity AS quantity
         FROM item_stock s
         JOIN items i ON i.id = s.item_id
         WHERE i.archived = 0 AND s.location_id IN (${placeholders})
       ),
       fallback AS (
         SELECT i.location_id AS location_id, i.id AS item_id, i.name AS name,
                i.unit AS unit, i.quantity AS quantity
         FROM items i
         WHERE i.archived = 0 AND i.location_id IN (${placeholders})
           AND NOT EXISTS (SELECT 1 FROM item_stock s WHERE s.item_id = i.id)
       )
       SELECT location_id, item_id, name, unit, SUM(quantity) AS quantity
       FROM (SELECT * FROM lots UNION ALL SELECT * FROM fallback)
       GROUP BY location_id, item_id
       ORDER BY name COLLATE NOCASE ASC`
    )
    .all(...locationIds, ...locationIds) as Array<{
    location_id: string;
    item_id: string;
    name: string;
    unit: string;
    quantity: number;
  }>;

  for (const row of rows) {
    const list = byLocation.get(row.location_id) ?? [];
    list.push({
      id: row.item_id,
      name: row.name,
      unit: row.unit,
      quantity: Number(row.quantity)
    });
    byLocation.set(row.location_id, list);
  }
  return byLocation;
}

/** How much of each item is held by one container, as opposed to on hand. */
function quantitiesAt(locationId: string): Map<string, number> {
  const rows = db
    .prepare(
      `WITH lots AS (
         SELECT s.item_id AS item_id, s.quantity AS quantity
         FROM item_stock s
         JOIN items i ON i.id = s.item_id
         WHERE i.archived = 0 AND s.location_id = ?
       ),
       fallback AS (
         SELECT i.id AS item_id, i.quantity AS quantity
         FROM items i
         WHERE i.archived = 0 AND i.location_id = ?
           AND NOT EXISTS (SELECT 1 FROM item_stock s WHERE s.item_id = i.id)
       )
       SELECT item_id, SUM(quantity) AS quantity
       FROM (SELECT * FROM lots UNION ALL SELECT * FROM fallback)
       GROUP BY item_id`
    )
    .all(locationId, locationId) as Array<{ item_id: string; quantity: number }>;

  return new Map(rows.map((row) => [row.item_id, Number(row.quantity)]));
}

/** The location marked as unsorted, with what is waiting in it. */
export function getStagingArea(): StagingArea | null {
  const location = getLocations().find((entry) => entry.is_staging);
  if (!location) return null;
  const quantities = quantitiesAt(location.id);
  const items: LooseItem[] = listItems({
    location_id: location.id,
    include_descendants: false,
    limit: 500
  }).items.map((item) => ({
    id: item.id,
    name: item.name,
    unit: item.unit,
    quantity: item.quantity,
    loose_quantity: quantities.get(item.id) ?? item.quantity
  }));
  items.sort((a, b) => a.name.localeCompare(b.name));
  return { location, items };
}

function placementOf(location: Location): DrawerBin | null {
  if (
    location.grid_x === null ||
    location.grid_y === null ||
    location.grid_w === null ||
    location.grid_h === null
  ) {
    return null;
  }
  const rotation = normaliseRotation(location.grid_rot);
  const [w, h] = effectiveFootprint(location.grid_w, location.grid_h, rotation);
  return {
    location_id: location.id,
    name: location.name,
    code: location.code,
    x: location.grid_x,
    y: location.grid_y,
    w,
    h,
    base_w: location.grid_w,
    base_h: location.grid_h,
    rotation,
    item_count: 0,
    unit_count: 0,
    items: []
  };
}

export function getLayout(id: string): DrawerLayout {
  const location = getLocation(id);
  const children = getLocations().filter((entry) => entry.parent_id === id);

  const bins: DrawerBin[] = [];
  const unplaced: Location[] = [];
  for (const child of children) {
    const placement = placementOf(child);
    if (!placement) {
      unplaced.push(child);
      continue;
    }
    bins.push(placement);
  }

  const contents = contentsByLocation(bins.map((bin) => bin.location_id));
  for (const bin of bins) {
    bin.items = contents.get(bin.location_id) ?? [];
    bin.item_count = bin.items.length;
    bin.unit_count = bin.items.reduce((total, item) => total + item.quantity, 0);
  }
  bins.sort((a, b) => a.y - b.y || a.x - b.x || a.name.localeCompare(b.name));
  unplaced.sort((a, b) => a.name.localeCompare(b.name));

  const used = bins.reduce((total, bin) => total + bin.w * bin.h, 0);
  const total = (location.grid_cols ?? 0) * (location.grid_rows ?? 0);
  const looseQuantities = quantitiesAt(id);
  const loose: LooseItem[] = listItems({
    location_id: id,
    include_descendants: false,
    limit: 500
  }).items.map((item) => ({
    id: item.id,
    name: item.name,
    unit: item.unit,
    quantity: item.quantity,
    loose_quantity: looseQuantities.get(item.id) ?? item.quantity
  }));

  return {
    location,
    cols: location.grid_cols,
    rows: location.grid_rows,
    used_cells: used,
    free_cells: location.grid_cols === null || location.grid_rows === null ? 0 : Math.max(0, total - used),
    bins,
    unplaced_bins: unplaced,
    loose_items: loose
  };
}

/**
 * Replace the placements on a container's grid.
 *
 * The payload is a whole map, not a patch: any child location left out becomes
 * unplaced. Positions are validated here rather than trusted from the client,
 * so a stale drag in a second tab cannot overlap another bin.
 */
export function setLayout(id: string, input: unknown): DrawerLayout {
  const location = getLocation(id);
  if (location.grid_cols === null || location.grid_rows === null) {
    throw badRequest(
      'This location has no grid map yet. Set grid_cols and grid_rows on the location first.',
      { location_id: location.id }
    );
  }

  const cols = location.grid_cols;
  const rows = location.grid_rows;
  const data = parseWith(layoutSchema, input);
  const children = new Map(
    getLocations()
      .filter((entry) => entry.parent_id === id)
      .map((entry) => [entry.id, entry])
  );

  const occupied = new Map<string, string>();
  const seen = new Set<string>();
  const placements: Array<{
    location_id: string;
    x: number;
    y: number;
    w: number;
    h: number;
    rotation: number;
  }> = [];

  for (const bin of data.bins) {
    const child = children.get(bin.location_id);
    if (!child) {
      throw badRequest(`"${bin.location_id}" is not a bin inside this location.`, {
        location_id: bin.location_id
      });
    }
    if (seen.has(bin.location_id)) {
      throw badRequest(`"${child.name}" was placed twice.`, { location_id: bin.location_id });
    }
    seen.add(bin.location_id);

    const rotation = normaliseRotation(bin.rotation ?? child.grid_rot);
    const [w, h] = effectiveFootprint(bin.w, bin.h, rotation);

    if (bin.x + w > cols || bin.y + h > rows) {
      throw conflict(
        `"${child.name}" does not fit: a ${w}x${h} footprint at cell ${bin.x},${bin.y} runs past the ${cols}x${rows} grid.`,
        { location_id: bin.location_id, footprint: [w, h], grid: [cols, rows] }
      );
    }

    for (const key of cellKeys(bin.x, bin.y, w, h)) {
      const other = occupied.get(key);
      if (other) {
        const otherName = children.get(other)?.name ?? other;
        throw conflict(`"${child.name}" overlaps "${otherName}".`, {
          location_id: bin.location_id,
          conflicts_with: other
        });
      }
      occupied.set(key, bin.location_id);
    }

    placements.push({ location_id: bin.location_id, x: bin.x, y: bin.y, w: bin.w, h: bin.h, rotation });
  }

  const now = nowIso();
  transaction(() => {
    // Clear positions only. A bin's own footprint and rotation stay with it, so
    // an unplaced bin keeps its size while it waits.
    db.prepare(
      `UPDATE locations
       SET grid_x = NULL, grid_y = NULL, updated_at = ?
       WHERE parent_id = ? AND grid_x IS NOT NULL`
    ).run(now, id);
    const statement = db.prepare(
      `UPDATE locations
       SET grid_x = ?, grid_y = ?, grid_w = ?, grid_h = ?, grid_rot = ?, updated_at = ?
       WHERE id = ? AND parent_id = ?`
    );
    for (const placement of placements) {
      statement.run(
        placement.x,
        placement.y,
        placement.w,
        placement.h,
        placement.rotation,
        now,
        placement.location_id,
        id
      );
    }
  });

  return getLayout(id);
}
