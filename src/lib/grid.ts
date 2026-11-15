/**
 * Pure helpers for grid maps (a partitioned container such as a drawer, and the
 * bins that sit inside it).
 *
 * A placement stores the bin's unrotated footprint (w, h) plus a rotation in
 * degrees, because turning a bin to fit is exactly what a physical tray is for:
 * the bin keeps its own dimensions and the effective footprint changes at 90
 * and 270. Nothing here touches the database, so both the location store (which
 * guards grid resizes) and the layout store (which validates drops) can share
 * one definition of "does this fit".
 */

export const ROTATIONS = [0, 90] as const;

export type Rotation = (typeof ROTATIONS)[number];

/**
 * Portrait (0) or landscape (90).
 *
 * This is a toggle rather than a four-step cycle on purpose: a bin either sits
 * as designed or lies on its side, and 180/270 would only turn its label edge to
 * the back of the drawer. Older values are folded into the nearest of the two.
 */
export function normaliseRotation(value: number | null | undefined): Rotation {
  const numeric = Number(value ?? 0);
  const wrapped = ((numeric % 360) + 360) % 360;
  return wrapped === 90 || wrapped === 270 ? 90 : 0;
}

/** The number of cells a footprint covers once rotation is applied. */
export function effectiveFootprint(
  w: number,
  h: number,
  rotation: number | null | undefined
): [number, number] {
  return normaliseRotation(rotation) === 90 ? [h, w] : [w, h];
}

/** Every cell key (x,y) a placed bin occupies. */
export function cellKeys(x: number, y: number, w: number, h: number): string[] {
  const keys: string[] = [];
  for (let dx = 0; dx < w; dx += 1) {
    for (let dy = 0; dy < h; dy += 1) {
      keys.push(`${x + dx},${y + dy}`);
    }
  }
  return keys;
}

/** True when the origin plus the effective footprint stays inside the grid. */
export function fitsInGrid(
  x: number,
  y: number,
  w: number,
  h: number,
  rotation: number | null | undefined,
  cols: number,
  rows: number
): boolean {
  const [ew, eh] = effectiveFootprint(w, h, rotation);
  return x >= 0 && y >= 0 && x + ew <= cols && y + eh <= rows;
}

/** Turn a list of placed rectangles into the set of cells they occupy. */
export function occupiedCells(
  bins: Array<{ x: number; y: number; w: number; h: number }>
): Set<string> {
  const occupied = new Set<string>();
  for (const bin of bins) {
    for (const key of cellKeys(bin.x, bin.y, bin.w, bin.h)) occupied.add(key);
  }
  return occupied;
}

/** True when every cell of the rectangle is still free. */
export function areaIsFree(
  occupied: Set<string>,
  x: number,
  y: number,
  w: number,
  h: number
): boolean {
  return cellKeys(x, y, w, h).every((key) => !occupied.has(key));
}

/**
 * The first free spot for a footprint, scanning from the front row outwards.
 * Used when a new bin is added and just needs somewhere sensible to land.
 */
export function findFreeOrigin(
  occupied: Set<string>,
  w: number,
  h: number,
  cols: number,
  rows: number
): { x: number; y: number } | null {
  for (let y = 0; y + h <= rows; y += 1) {
    for (let x = 0; x + w <= cols; x += 1) {
      if (areaIsFree(occupied, x, y, w, h)) return { x, y };
    }
  }
  return null;
}
