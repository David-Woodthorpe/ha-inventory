import { randomUUID } from 'node:crypto';
import { db, nowIso, transaction } from './db';
import { badRequest, conflict, notFound } from './errors';
import { getLocation, getLocations } from './locations';
import { rackSchema, parseWith } from './schemas';
import type { ItemRackMount, RackMount, RackView } from '$lib/types';

interface RackRow {
  id: string;
  item_id: string | null;
  location_id: string | null;
  u_start: number;
  u_height: number;
  note: string | null;
}

interface MountInput {
  item_id?: string | null;
  location_id?: string | null;
  u_start: number;
  u_height: number;
  note?: string | null;
}

/** True when a location is the rack itself or sits somewhere below it. */
function isInsideRack(locationId: string | null, rack: { id: string; path_ids: string[] }): boolean {
  return Boolean(locationId && (locationId === rack.id || rack.path_ids.includes(locationId)));
}

function readMounts(rackId: string): RackMount[] {
  const rows = db
    .prepare(
      `SELECT id, item_id, location_id, u_start, u_height, note
       FROM rack_mounts WHERE rack_location_id = ? ORDER BY u_start ASC`
    )
    .all(rackId) as unknown as RackRow[];

  const locations = new Map(getLocations().map((entry) => [entry.id, entry]));

  const itemRows = db
    .prepare('SELECT id, name, sku, location_id FROM items')
    .all() as Array<{ id: string; name: string; sku: string | null; location_id: string | null }>;
  const items = new Map(itemRows.map((row) => [row.id, row]));

  // How much is fitted into each mounted host, so a disk shelf can show that it
  // holds two drives rather than looking empty.
  const fittedRows = db
    .prepare(
      `SELECT host_item_id, COUNT(*) AS types, COALESCE(SUM(quantity), 0) AS units
       FROM item_allocations GROUP BY host_item_id`
    )
    .all() as Array<{ host_item_id: string; types: number; units: number }>;
  const fitted = new Map(
    fittedRows.map((row) => [row.host_item_id, { types: Number(row.types), units: Number(row.units) }])
  );

  return rows.map((row) => {
    if (row.item_id) {
      const item = items.get(row.item_id);
      return {
        id: row.id,
        type: 'item' as const,
        ref_id: row.item_id,
        name: item?.name ?? 'Deleted item',
        code: item?.sku ?? null,
        u_start: row.u_start,
        u_height: row.u_height,
        stored_here: isInsideRack(item?.location_id ?? null, locations.get(rackId) ?? { id: rackId, path_ids: [] }),
        fitted_units: fitted.get(row.item_id)?.units ?? 0,
        fitted_types: fitted.get(row.item_id)?.types ?? 0,
        note: row.note
      };
    }
    const location = row.location_id ? locations.get(row.location_id) : undefined;
    return {
      id: row.id,
      type: 'location' as const,
      ref_id: row.location_id ?? '',
      name: location?.name ?? 'Deleted location',
      code: location?.code ?? null,
      u_start: row.u_start,
      u_height: row.u_height,
      stored_here: true,
      fitted_units: 0,
      fitted_types: 0,
      note: row.note
    };
  });
}

/**
 * The elevation of a rack: every mount, from the bottom slot upwards.
 *
 * `used_units` sums the heights rather than the span, so gaps are visible as
 * free space rather than being quietly absorbed.
 */
export function getRack(locationId: string): RackView {
  const location = getLocation(locationId);
  const mounts = readMounts(locationId);
  const used = mounts.reduce((total, mount) => total + mount.u_height, 0);
  const units = location.rack_units;
  return {
    location,
    units,
    mounts,
    used_units: used,
    free_units: units === null ? 0 : Math.max(0, units - used)
  };
}

/** Every reason a mount cannot sit where it says, thrown before any write. */
function validateMounts(
  rack: { id: string; units: number },
  mounts: MountInput[],
  existing: Array<{ id: string; item_id: string | null; location_id: string | null }>,
  ignoreIds: Set<string>
): void {
  const all = getLocations();
  const childIds = new Set(all.filter((entry) => entry.parent_id === rack.id).map((entry) => entry.id));
  const locationNames = new Map(all.map((entry) => [entry.id, entry.name]));
  const itemNames = new Map(
    (db.prepare('SELECT id, name FROM items').all() as Array<{ id: string; name: string }>).map(
      (row) => [row.id, row.name]
    )
  );

  const mountedItems = new Set(
    existing.filter((row) => !ignoreIds.has(row.id) && row.item_id).map((row) => row.item_id as string)
  );
  const mountedLocations = new Set(
    existing
      .filter((row) => !ignoreIds.has(row.id) && row.location_id)
      .map((row) => row.location_id as string)
  );

  const occupied = new Map<string, string>();

  for (const mount of mounts) {
    const label =
      (mount.item_id ? itemNames.get(mount.item_id) : undefined) ??
      (mount.location_id ? locationNames.get(mount.location_id) : undefined) ??
      'Unknown';

    if (mount.item_id && mount.location_id) {
      throw badRequest('A slot holds either an item or a shelf, not both', { name: label });
    }
    if (!mount.item_id && !mount.location_id) {
      throw badRequest('A slot needs an item or a shelf');
    }

    if (mount.item_id) {
      if (!itemNames.has(mount.item_id)) throw notFound('Item', mount.item_id);
      if (mountedItems.has(mount.item_id)) {
        throw conflict(`“${label}” is already mounted in this rack.`, { item_id: mount.item_id });
      }
      mountedItems.add(mount.item_id);
    }

    if (mount.location_id) {
      if (!locationNames.has(mount.location_id)) throw notFound('Location', mount.location_id);
      if (!childIds.has(mount.location_id)) {
        throw badRequest(
          `“${locationNames.get(mount.location_id)}” is not a sublocation of this rack, so it cannot be mounted in it.`,
          { location_id: mount.location_id }
        );
      }
      if (mountedLocations.has(mount.location_id)) {
        throw conflict(`“${label}” is already mounted in this rack.`, {
          location_id: mount.location_id
        });
      }
      mountedLocations.add(mount.location_id);
    }

    if (mount.u_start < 1) {
      throw badRequest(`“${label}” cannot start below U1.`, { name: label });
    }
    if (mount.u_start + mount.u_height - 1 > rack.units) {
      throw conflict(
        `“${label}” runs past the top: ${mount.u_height}U from U${mount.u_start} needs a ${rack.units}U rack.`,
        { name: label, rack_units: rack.units }
      );
    }

    for (let u = mount.u_start; u < mount.u_start + mount.u_height; u += 1) {
      const other = occupied.get(String(u));
      if (other) {
        throw conflict(`U${u} is claimed by both “${label}” and “${other}”.`, {
          u,
          conflicts_with: other
        });
      }
      occupied.set(String(u), label);
    }
  }
}

function requireRack(locationId: string) {
  const location = getLocation(locationId);
  if (location.rack_units === null) {
    throw badRequest(
      'This location is not a rack yet. Set rack_units on the location first.',
      { location_id: location.id }
    );
  }
  return { ...location, units: location.rack_units };
}

/**
 * Replace every mount in a rack.
 *
 * The payload is the whole elevation, not a patch: anything left out is
 * unmounted. Positions are validated here rather than trusted from the client.
 */
export function setRack(locationId: string, input: unknown): RackView {
  const location = requireRack(locationId);
  const data = parseWith(rackSchema, input);
  const existing = db
    .prepare('SELECT id, item_id, location_id FROM rack_mounts WHERE rack_location_id = ?')
    .all(locationId) as Array<{ id: string; item_id: string | null; location_id: string | null }>;

  validateMounts(
    { id: location.id, units: location.units },
    data.mounts,
    existing,
    new Set(existing.map((row) => row.id))
  );

  const now = nowIso();
  transaction(() => {
    db.prepare('DELETE FROM rack_mounts WHERE rack_location_id = ?').run(locationId);
    const statement = db.prepare(
      `INSERT INTO rack_mounts (id, rack_location_id, item_id, location_id, u_start, u_height, note, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
    );
    for (const mount of data.mounts) {
      statement.run(
        randomUUID(),
        locationId,
        mount.item_id ?? null,
        mount.location_id ?? null,
        mount.u_start,
        mount.u_height,
        mount.note ?? null,
        now,
        now
      );
    }
  });

  return getRack(locationId);
}

/** Add one mount, validating it against what is already in the rack. */
export function addRackMount(locationId: string, input: unknown): RackView {
  const location = requireRack(locationId);
  const data = parseWith(rackSchema, { mounts: [input] });
  const existing = db
    .prepare('SELECT id, item_id, location_id FROM rack_mounts WHERE rack_location_id = ?')
    .all(locationId) as Array<{ id: string; item_id: string | null; location_id: string | null }>;

  const mount = data.mounts[0];
  validateMounts({ id: location.id, units: location.units }, [mount], existing, new Set());

  const now = nowIso();
  db.prepare(
    `INSERT INTO rack_mounts (id, rack_location_id, item_id, location_id, u_start, u_height, note, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    randomUUID(),
    locationId,
    mount.item_id ?? null,
    mount.location_id ?? null,
    mount.u_start,
    mount.u_height,
    mount.note ?? null,
    now,
    now
  );

  return getRack(locationId);
}

/**
 * Move one mount to a different slot, or resize it.
 *
 * The rest of the rack is left alone, so this is the counterpart to a drag: it
 * validates the new position against everything else without rewriting rows
 * that did not move.
 */
export function moveRackMount(
  locationId: string,
  mountId: string,
  input: { u_start?: unknown; u_height?: unknown }
): RackView {
  const location = requireRack(locationId);
  const row = db
    .prepare(
      `SELECT id, item_id, location_id, u_start, u_height, note
       FROM rack_mounts WHERE id = ? AND rack_location_id = ?`
    )
    .get(mountId, locationId) as
    | { id: string; item_id: string | null; location_id: string | null; u_start: number; u_height: number; note: string | null }
    | undefined;
  if (!row) throw notFound('Mount', mountId);

  const uStart = input.u_start === undefined ? row.u_start : Number(input.u_start);
  const uHeight = input.u_height === undefined ? row.u_height : Number(input.u_height);
  if (!Number.isInteger(uStart) || uStart < 1) {
    throw badRequest('A slot number must be a whole number from 1 upwards');
  }
  if (!Number.isInteger(uHeight) || uHeight < 1) {
    throw badRequest('A device needs a whole number of U');
  }

  const existing = db
    .prepare('SELECT id, item_id, location_id FROM rack_mounts WHERE rack_location_id = ?')
    .all(locationId) as Array<{ id: string; item_id: string | null; location_id: string | null }>;

  validateMounts(
    { id: location.id, units: location.units },
    [
      {
        item_id: row.item_id,
        location_id: row.location_id,
        u_start: uStart,
        u_height: uHeight,
        note: row.note
      }
    ],
    existing,
    new Set([mountId])
  );

  db.prepare('UPDATE rack_mounts SET u_start = ?, u_height = ?, updated_at = ? WHERE id = ?').run(
    uStart,
    uHeight,
    nowIso(),
    mountId
  );
  return getRack(locationId);
}

/**
 * The rack an item is mounted in, if it is mounted in one.
 *
 * Used by the item page to show a strip of the cabinet with this device picked
 * out, the way a bin on a drawer map is shown.
 */
export function rackMountForItem(itemId: string): ItemRackMount | null {
  const row = db
    .prepare(
      `SELECT rack_location_id, u_start, u_height FROM rack_mounts
       WHERE item_id = ? ORDER BY created_at ASC LIMIT 1`
    )
    .get(itemId) as { rack_location_id: string; u_start: number; u_height: number } | undefined;
  if (!row) return null;

  const locations = getLocations();
  const rack = locations.find((entry) => entry.id === row.rack_location_id);
  if (!rack || rack.rack_units === null) return null;

  const mounts = readMounts(rack.id);
  return {
    rack: { id: rack.id, name: rack.name, path_label: rack.path_label },
    units: rack.rack_units,
    u_start: row.u_start,
    u_height: row.u_height,
    slots: mounts.map((mount) => ({
      name: mount.name,
      u_start: mount.u_start,
      u_height: mount.u_height,
      is_this: mount.type === 'item' && mount.ref_id === itemId
    }))
  };
}

/** Take one mount out, leaving everything else where it is. */
export function removeRackMount(locationId: string, mountId: string): RackView {
  const row = db
    .prepare('SELECT id FROM rack_mounts WHERE id = ? AND rack_location_id = ?')
    .get(mountId, locationId) as { id: string } | undefined;
  if (!row) throw notFound('Mount', mountId);
  db.prepare('DELETE FROM rack_mounts WHERE id = ?').run(mountId);
  return getRack(locationId);
}
