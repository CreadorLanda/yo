/**
 * The arithmetic of sharing a place, kept apart from the screen and the GPS so
 * it can be tested without either.
 *
 * Nothing here talks to a server. The position travels inside an end-to-end
 * encrypted message like any other body, and the only third party involved is
 * the map tile host, which is asked for an image of an area, never for a
 * person (see `docs/features/location.md`).
 */

export type LatLng = { lat: number; lng: number };

/** How long a live share may last. `null` is until the person turns it off. */
export type LiveDuration = { id: string; ms: number | null };

export const LIVE_DURATIONS: readonly LiveDuration[] = [
  { id: '15m', ms: 15 * 60_000 },
  { id: '1h', ms: 60 * 60_000 },
  { id: 'off', ms: null },
];

/** Map zoom for a bubble: street level, about 600 m across. */
export const MAP_ZOOM = 16;
const TILE = 256;

const EARTH_RADIUS_M = 6_371_000;
const rad = (deg: number) => (deg * Math.PI) / 180;

export function isValidPosition(p: { lat?: unknown; lng?: unknown } | null | undefined): p is LatLng {
  return (
    !!p &&
    typeof p.lat === 'number' &&
    typeof p.lng === 'number' &&
    Number.isFinite(p.lat) &&
    Number.isFinite(p.lng) &&
    Math.abs(p.lat) <= 90 &&
    Math.abs(p.lng) <= 180
  );
}

/** Straight-line distance in metres. */
export function distanceMeters(a: LatLng, b: LatLng): number {
  const dLat = rad(b.lat - a.lat);
  const dLng = rad(b.lng - a.lng);
  const h =
    Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** "-8.83833, 13.23444": a place with no street name, which is all we know. */
export function formatCoords(p: LatLng): string {
  return `${p.lat.toFixed(5)}, ${p.lng.toFixed(5)}`;
}

/**
 * Where a live share has to send its next update.
 *
 * Every GPS fix is not worth a message: each one is an encrypted edit that every
 * member has to receive. A moved-enough fix goes out after a short wait, and a
 * heartbeat goes out even when standing still so the others can tell the share
 * is alive rather than abandoned.
 */
export const MIN_UPDATE_MS = 8_000;
export const MIN_MOVE_M = 10;
export const HEARTBEAT_MS = 60_000;

export function shouldPublish(
  last: { at: number; point: LatLng } | null,
  next: { at: number; point: LatLng },
): boolean {
  if (!last) return true;
  const elapsed = next.at - last.at;
  if (elapsed >= HEARTBEAT_MS) return true;
  return elapsed >= MIN_UPDATE_MS && distanceMeters(last.point, next.point) >= MIN_MOVE_M;
}

/** A live share is stale when nothing has arrived for this long. */
export const STALE_MS = 3 * 60_000;

export type LiveState = 'static' | 'live' | 'stale' | 'ended';

export function liveState(
  a: { live?: boolean; expiresAt?: string; updatedAt?: string },
  now: number,
): LiveState {
  // `live` is absent on a one-off position and false on a share that was stopped.
  if (a.live === undefined) return 'static';
  if (!a.live) return 'ended';
  if (a.expiresAt && Date.parse(a.expiresAt) <= now) return 'ended';
  if (a.updatedAt && now - Date.parse(a.updatedAt) > STALE_MS) return 'stale';
  return 'live';
}

/** Whole minutes left, rounded up; null when it has no end. */
export function minutesLeft(expiresAt: string | undefined, now: number): number | null {
  if (!expiresAt) return null;
  const ms = Date.parse(expiresAt) - now;
  return ms > 0 ? Math.ceil(ms / 60_000) : 0;
}

export function minutesAgo(iso: string | undefined, now: number): number {
  if (!iso) return 0;
  return Math.max(0, Math.floor((now - Date.parse(iso)) / 60_000));
}

export type MapTile = { url: string; left: number; top: number };

/** Web-Mercator position of a point, in world pixels at `zoom`. */
export function worldPixel(p: LatLng, zoom: number): { x: number; y: number } {
  const scale = TILE * 2 ** zoom;
  const sin = Math.sin(rad(Math.max(-85.0511, Math.min(85.0511, p.lat))));
  return {
    x: ((p.lng + 180) / 360) * scale,
    y: (0.5 - Math.log((1 + sin) / (1 - sin)) / (4 * Math.PI)) * scale,
  };
}

/**
 * The tiles that cover a `width` x `height` view centred on `p`, each with the
 * offset to draw it at. A single tile cannot be used: it has the point
 * wherever it happens to fall, and a pin has to sit in the middle.
 */
export function mapTiles(
  p: LatLng,
  width: number,
  height: number,
  zoom: number = MAP_ZOOM,
  host = 'https://tile.openstreetmap.org',
): MapTile[] {
  const centre = worldPixel(p, zoom);
  const left = centre.x - width / 2;
  const top = centre.y - height / 2;
  const count = 2 ** zoom;
  const tiles: MapTile[] = [];
  for (let ty = Math.floor(top / TILE); ty <= Math.floor((top + height) / TILE); ty += 1) {
    if (ty < 0 || ty >= count) continue;
    for (let tx = Math.floor(left / TILE); tx <= Math.floor((left + width) / TILE); tx += 1) {
      const wrapped = ((tx % count) + count) % count;
      tiles.push({
        url: `${host}/${zoom}/${wrapped}/${ty}.png`,
        left: tx * TILE - left,
        top: ty * TILE - top,
      });
    }
  }
  return tiles;
}

/** A link the platform's own map app opens. */
export function mapsUrl(
  p: LatLng,
  label: string,
  platform: 'android' | 'ios' | 'web' | string,
): string {
  const coords = `${p.lat},${p.lng}`;
  if (platform === 'android') return `geo:${coords}?q=${coords}(${encodeURIComponent(label)})`;
  if (platform === 'ios') return `https://maps.apple.com/?ll=${coords}&q=${encodeURIComponent(label)}`;
  return `https://www.openstreetmap.org/?mlat=${p.lat}&mlon=${p.lng}#map=17/${p.lat}/${p.lng}`;
}
