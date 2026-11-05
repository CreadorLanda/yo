/**
 * How the people in a group call share the stage.
 *
 * Pure so the awkward counts can be tested: two people stack, an odd person out
 * takes the whole last row, and past what fits the tiles keep a usable size and
 * the stage scrolls, rather than shrinking everyone into stamps.
 */

export type CallGrid = {
  columns: number;
  tileWidth: number;
  tileHeight: number;
  /** The last tile takes the whole row, because it has no neighbour. */
  spanLast: boolean;
  scrolls: boolean;
};

const MIN_TILE_HEIGHT = 150;

export function callGrid(count: number, width: number, height: number, gap: number): CallGrid {
  const landscape = width > height;
  const columns = count <= 1 ? 1 : landscape ? (count <= 4 ? 2 : 3) : count <= 2 ? 1 : 2;
  const rows = Math.max(1, Math.ceil(count / columns));
  const fit = (height - gap * (rows - 1)) / rows;
  const tileHeight = Math.max(fit, MIN_TILE_HEIGHT);
  return {
    columns,
    tileWidth: (width - gap * (columns - 1)) / columns,
    tileHeight,
    spanLast: columns === 2 && count % 2 === 1,
    scrolls: fit < MIN_TILE_HEIGHT,
  };
}

/** A steady colour for someone with no video, so a tile is recognisable. */
export function tileHueIndex(identity: string, hues: number): number {
  let sum = 0;
  for (let i = 0; i < identity.length; i += 1) sum = (sum * 31 + identity.charCodeAt(i)) >>> 0;
  return sum % hues;
}
