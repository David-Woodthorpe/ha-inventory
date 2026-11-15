import { fail } from '@sveltejs/kit';
import { ApiError } from '$lib/server/errors';
import { findFreeOrigin, occupiedCells } from '$lib/grid';
import { getLayout, setLayout } from '$lib/server/layout';
import { createLocation, getLocation, updateLocation } from '$lib/server/locations';
import { moveAllStock } from '$lib/server/stock';

export function load({ params }: { params: { id: string } }) {
  return { layout: getLayout(params.id) };
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
   * Put a loose item into a bin on this map. Reuses moveAllStock so the item's
   * lots are merged and the move is recorded in its history exactly as it would
   * be from the item page.
   */
  assignItem: async ({ request, params }: { request: Request; params: { id: string } }) => {
    const form = await request.formData();
    const itemId = String(form.get('item_id') ?? '');
    const binId = String(form.get('bin_id') ?? '');
    if (!itemId || !binId) return fail(400, { error: 'Choose an item and a bin' });
    try {
      const bin = getLocation(binId);
      if (bin.parent_id !== params.id) {
        return fail(400, { error: 'That bin is not inside this location' });
      }
      moveAllStock(itemId, binId, { note: `Put away in ${bin.name}` });
      return { success: `Moved into “${bin.name}”` };
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
