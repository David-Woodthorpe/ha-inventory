import { fail } from '@sveltejs/kit';
import { ApiError } from '$lib/server/errors';
import { findFreeOrigin, occupiedCells } from '$lib/grid';
import { getLayout, getStagingArea, setLayout } from '$lib/server/layout';
import { createLocation, getLocation, getLocations, updateLocation } from '$lib/server/locations';
import { transferStock } from '$lib/server/stock';

export function load({ params }: { params: { id: string } }) {
  const layout = getLayout(params.id);
  // Drawers that could receive this one's bins when rearranging.
  const staging = getStagingArea();

  // Other grid locations can take this drawer's bins. The unsorted area is a
  // legitimate destination too — emptying a drawer onto it keeps a half-finished
  // reshuffle honest — but it may itself have a grid, so key by id and label it
  // once rather than listing it twice.
  const targets = new Map<string, string>();
  for (const entry of getLocations()) {
    if (
      entry.id === params.id ||
      entry.grid_cols === null ||
      entry.grid_rows === null ||
      entry.parent_id === params.id
    ) {
      continue;
    }
    targets.set(entry.id, entry.path_label);
  }
  if (staging && staging.location.id !== params.id) {
    targets.set(staging.location.id, `${staging.location.path_label} — unsorted`);
  }

  return {
    layout,
    staging,
    rearrangeTargets: Array.from(targets, ([id, label]) => ({ id, label }))
  };
}

function actionFailure(error: unknown) {
  if (error instanceof ApiError) {
    return fail(error.status >= 400 && error.status < 600 ? error.status : 400, {
      error: error.message,
      details: error.details ?? null
    });
  }
  throw error;
}

export const actions = {
  /**
   * Save the whole map. Drags are positional rather than form-shaped, so the
   * page posts the placements as one JSON field and the server validates them
   * again before storing anything.
   */
  saveLayout: async ({ request, params }: { request: Request; params: { id: string } }) => {
    const form = await request.formData();
    let bins: unknown;
    try {
      bins = JSON.parse(String(form.get('bins') ?? '[]'));
    } catch {
      return fail(400, { error: 'The layout payload was not valid JSON' });
    }
    try {
      setLayout(params.id, { bins });
      return { success: 'Layout saved' };
    } catch (error) {
      return actionFailure(error);
    }
  },

  /** Create a bin location and drop it into the first free space of its size. */
  addBin: async ({ request, params }: { request: Request; params: { id: string } }) => {
    const form = await request.formData();
    const name = String(form.get('name') ?? '').trim();
    const code = String(form.get('code') ?? '').trim();
    const w = Number(form.get('w') ?? 1);
    const h = Number(form.get('h') ?? 1);
    const rotation = Number(form.get('rotation') ?? 0);

    if (!name) return fail(400, { error: 'Give the bin a name' });
    try {
      const container = getLocation(params.id);
      if (container.grid_cols === null || container.grid_rows === null) {
        return fail(400, { error: 'Set up a grid on this location first' });
      }
      if (!Number.isInteger(w) || !Number.isInteger(h) || w < 1 || h < 1) {
        return fail(400, { error: 'A bin needs a whole-cell width and depth' });
      }

      const created = createLocation({
        name,
        code: code || null,
        parent_id: params.id
      });

      const layout = getLayout(params.id);
      const [ew, eh] = rotation === 90 || rotation === 270 ? [h, w] : [w, h];
      const origin = findFreeOrigin(
        occupiedCells(layout.bins),
        ew,
        eh,
        container.grid_cols,
        container.grid_rows
      );

      if (!origin) {
        return {
          success: `Added “${name}”, but a ${ew}x${eh} bin does not fit on this grid — it is waiting in the unplaced list.`
        };
      }

      setLayout(params.id, {
        bins: [
          ...layout.bins.map((bin) => ({
            location_id: bin.location_id,
            x: bin.x,
            y: bin.y,
            w: bin.base_w,
            h: bin.base_h,
            rotation: bin.rotation
          })),
          { location_id: created.id, x: origin.x, y: origin.y, w, h, rotation }
        ]
      });
      return { success: `Added “${name}” at cell ${origin.x},${origin.y}` };
    } catch (error) {
      return actionFailure(error);
    }
  },

  /**
   * Drop an existing unplaced bin into the first free space of its footprint.
   * A bin that was moved from another drawer arrives with no position, so this
   * is the counterpart to the move.
   */
  placeBin: async ({ request, params }: { request: Request; params: { id: string } }) => {
    const form = await request.formData();
    const locationId = String(form.get('location_id') ?? '');
    try {
      const container = getLocation(params.id);
      if (container.grid_cols === null || container.grid_rows === null) {
        return fail(400, { error: 'Set up a grid on this location first' });
      }
      const child = getLocation(locationId);
      if (child.parent_id !== params.id) {
        return fail(400, { error: 'That bin is not inside this location' });
      }

      const layout = getLayout(params.id);
      const w = child.grid_w ?? 1;
      const h = child.grid_h ?? 1;
      const rotation = child.grid_rot ?? 0;
      const [ew, eh] = rotation === 90 || rotation === 270 ? [h, w] : [w, h];
      const origin = findFreeOrigin(
        occupiedCells(layout.bins),
        ew,
        eh,
        container.grid_cols,
        container.grid_rows
      );
      if (!origin) {
        return fail(409, {
          error: `No free ${ew}x${eh} space left for “${child.name}”. Turn it 90° or free some cells first.`
        });
      }

      setLayout(params.id, {
        bins: [
          ...layout.bins.map((bin) => ({
            location_id: bin.location_id,
            x: bin.x,
            y: bin.y,
            w: bin.base_w,
            h: bin.base_h,
            rotation: bin.rotation
          })),
          { location_id: locationId, x: origin.x, y: origin.y, w, h, rotation }
        ]
      });
      return { success: `Placed “${child.name}” at cell ${origin.x},${origin.y}` };
    } catch (error) {
      return actionFailure(error);
    }
  },

  /**
   * Put loose stock into a bin on this map, in part or in full.
   *
   * This is a transfer from the container rather than a move of the item: a
   * printed caddy holds a fixed number of sticks, so "move 8 of the 20 here"
   * has to leave the rest exactly where it is. Stock in another drawer is never
   * pulled in by accident.
   */
  assignItem: async ({ request, params }: { request: Request; params: { id: string } }) => {
    const form = await request.formData();
    const itemId = String(form.get('item_id') ?? '');
    const binId = String(form.get('bin_id') ?? '');
    const rawQuantity = String(form.get('quantity') ?? '').trim();
    if (!itemId || !binId) return fail(400, { error: 'Choose an item and a bin' });

    const quantity = rawQuantity === '' ? null : Number(rawQuantity);
    if (quantity !== null && (!Number.isFinite(quantity) || quantity <= 0)) {
      return fail(400, { error: 'Enter how many to put away' });
    }

    try {
      const bin = getLocation(binId);
      if (bin.parent_id !== params.id) {
        return fail(400, { error: 'That bin is not inside this location' });
      }

      if (quantity === null) {
        // No amount given: put away everything loose in this container.
        const layout = getLayout(params.id);
        const loose = layout.loose_items.find((entry) => entry.id === itemId);
        if (!loose) return fail(400, { error: 'That item is not loose in this location' });
        transferStock(itemId, {
          from_location_id: params.id,
          to_location_id: binId,
          quantity: loose.loose_quantity,
          note: `Put away in ${bin.name}`
        });
        return { success: `Moved ${loose.loose_quantity} ${loose.unit} into “${bin.name}”` };
      }

      transferStock(itemId, {
        from_location_id: params.id,
        to_location_id: binId,
        quantity,
        note: `Put away in ${bin.name}`
      });
      return { success: `Moved ${quantity} into “${bin.name}”` };
    } catch (error) {
      return actionFailure(error);
    }
  },

  /**
   * File an unsorted item into this drawer, either into a chosen bin or into the
   * drawer itself. Partial amounts work the same way as the loose list, so a
   * tray with room for eight takes eight and the rest stays unsorted.
   */
  fileItem: async ({ request, params }: { request: Request; params: { id: string } }) => {
    const form = await request.formData();
    const itemId = String(form.get('item_id') ?? '');
    const binId = String(form.get('bin_id') ?? '').trim();
    const rawQuantity = String(form.get('quantity') ?? '').trim();
    const staging = getStagingArea();
    if (!staging) return fail(400, { error: 'No unsorted area is set' });
    if (!itemId) return fail(400, { error: 'Choose an item to file' });

    const item = staging.items.find((entry) => entry.id === itemId);
    if (!item) return fail(400, { error: 'That item is not in the unsorted area' });

    let quantity = item.loose_quantity;
    if (rawQuantity !== '') {
      const parsed = Number(rawQuantity);
      if (!Number.isFinite(parsed) || parsed <= 0) {
        return fail(400, { error: 'Enter how many to file' });
      }
      quantity = parsed;
    }

    try {
      let target = params.id;
      if (binId) {
        const bin = getLocation(binId);
        if (bin.parent_id !== params.id) {
          return fail(400, { error: 'That bin is not inside this location' });
        }
        target = binId;
      }
      transferStock(itemId, {
        from_location_id: staging.location.id,
        to_location_id: target,
        quantity,
        note: `Filed from ${staging.location.name}`
      });
      return { success: `Filed ${quantity} ${item.unit} of “${item.name}”` };
    } catch (error) {
      return actionFailure(error);
    }
  },

  /** File everything unsorted into this drawer at once. */
  fileAll: async ({ params }: { params: { id: string } }) => {
    const staging = getStagingArea();
    if (!staging) return fail(400, { error: 'No unsorted area is set' });
    if (staging.items.length === 0) return fail(400, { error: 'The unsorted area is empty' });
    try {
      let moved = 0;
      for (const item of staging.items) {
        transferStock(item.id, {
          from_location_id: staging.location.id,
          to_location_id: params.id,
          quantity: item.loose_quantity,
          note: `Filed from ${staging.location.name}`
        });
        moved += 1;
      }
      return { success: `Filed ${moved} item(s) into this location` };
    } catch (error) {
      return actionFailure(error);
    }
  },

  /**
   * Move every bin in this drawer to another location in one step, which is how
   * a drawer gets emptied for a reshuffle. Bins keep their footprint and
   * rotation but lose their position, because cells belong to the old grid.
   */
  moveAllBins: async ({ request, params }: { request: Request; params: { id: string } }) => {
    const form = await request.formData();
    const targetId = String(form.get('target_location_id') ?? '');
    if (!targetId) return fail(400, { error: 'Choose where the bins should go' });
    if (targetId === params.id) return fail(400, { error: 'Those bins are already here' });
    try {
      const target = getLocation(targetId);
      const children = getLocations().filter((entry) => entry.parent_id === params.id);
      if (children.length === 0) return fail(400, { error: 'This location has no bins to move' });
      for (const child of children) {
        updateLocation(child.id, { parent_id: targetId });
      }
      return {
        success: `Moved ${children.length} bin(s) to “${target.name}”. They keep their footprint and wait in the unplaced list.`
      };
    } catch (error) {
      return actionFailure(error);
    }
  },

  /** Turn a container into a map, or resize an existing one. */
  setGrid: async ({ request, params }: { request: Request; params: { id: string } }) => {    const form = await request.formData();
    const cols = String(form.get('cols') ?? '').trim();
    const rows = String(form.get('rows') ?? '').trim();
    try {
      updateLocation(params.id, {
        grid_cols: cols === '' ? null : cols,
        grid_rows: rows === '' ? null : rows
      });
      return { success: cols === '' ? 'Grid map removed' : `Grid map set to ${cols} x ${rows}` };
    } catch (error) {
      return actionFailure(error);
    }
  }
};
