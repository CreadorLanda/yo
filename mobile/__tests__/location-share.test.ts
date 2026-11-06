import { describe, expect, test } from 'bun:test';

import {
  HEARTBEAT_MS,
  LIVE_DURATIONS,
  MIN_UPDATE_MS,
  distanceMeters,
  formatCoords,
  isValidPosition,
  liveState,
  mapTiles,
  mapsUrl,
  minutesAgo,
  minutesLeft,
  shouldPublish,
  worldPixel,
} from '@/data/location-share';

const luanda = { lat: -8.83833, lng: 13.23444 };

describe('positions', () => {
  test('accepts real coordinates and rejects nonsense', () => {
    expect(isValidPosition(luanda)).toBe(true);
    expect(isValidPosition({ lat: 91, lng: 0 })).toBe(false);
    expect(isValidPosition({ lat: 0, lng: 181 })).toBe(false);
    expect(isValidPosition({ lat: NaN, lng: 0 })).toBe(false);
    expect(isValidPosition({ lat: '1', lng: 2 })).toBe(false);
    expect(isValidPosition(null)).toBe(false);
  });

  test('distance is zero for the same point and about 111 km per degree of latitude', () => {
    expect(distanceMeters(luanda, luanda)).toBe(0);
    const d = distanceMeters({ lat: 0, lng: 0 }, { lat: 1, lng: 0 });
    expect(Math.round(d / 1000)).toBe(111);
  });

  test('coordinates read with five decimals', () => {
    expect(formatCoords(luanda)).toBe('-8.83833, 13.23444');
  });
});

describe('when a live share publishes', () => {
  const at = 1_000_000;
  const here = { at, point: luanda };
  const moved = { lat: luanda.lat + 0.001, lng: luanda.lng }; // about 111 m

  test('the first fix always goes out', () => {
    expect(shouldPublish(null, here)).toBe(true);
  });
  test('moving soon after is held back', () => {
    expect(shouldPublish(here, { at: at + MIN_UPDATE_MS - 1, point: moved })).toBe(false);
  });
  test('moving after the wait goes out', () => {
    expect(shouldPublish(here, { at: at + MIN_UPDATE_MS, point: moved })).toBe(true);
  });
  test('standing still is not worth a message', () => {
    expect(shouldPublish(here, { at: at + MIN_UPDATE_MS * 3, point: luanda })).toBe(false);
  });
  test('a heartbeat goes out even when standing still', () => {
    expect(shouldPublish(here, { at: at + HEARTBEAT_MS, point: luanda })).toBe(true);
  });
  test('a few metres of jitter does not count as moving', () => {
    const jitter = { lat: luanda.lat + 0.00003, lng: luanda.lng }; // about 3 m
    expect(shouldPublish(here, { at: at + MIN_UPDATE_MS * 2, point: jitter })).toBe(false);
  });
});

describe('live state', () => {
  const now = Date.parse('2026-01-01T12:00:00Z');
  const iso = (ms: number) => new Date(now + ms).toISOString();

  test('a one-off position is static', () => {
    expect(liveState({}, now)).toBe('static');
  });
  test('a one-off position keeps its time without becoming a share that ended', () => {
    expect(liveState({ updatedAt: iso(-10_000) }, now)).toBe('static');
  });
  test('a running share is live', () => {
    expect(liveState({ live: true, expiresAt: iso(60_000), updatedAt: iso(-10_000) }, now)).toBe('live');
  });
  test('a share with no end stays live', () => {
    expect(liveState({ live: true, updatedAt: iso(-10_000) }, now)).toBe('live');
  });
  test('a share past its time has ended, whatever the sender phone says', () => {
    expect(liveState({ live: true, expiresAt: iso(-1), updatedAt: iso(-10_000) }, now)).toBe('ended');
  });
  test('a share that was stopped has ended', () => {
    expect(liveState({ live: false, updatedAt: iso(-10_000) }, now)).toBe('ended');
  });
  test('silence for minutes means the sender may be offline', () => {
    expect(liveState({ live: true, expiresAt: iso(600_000), updatedAt: iso(-4 * 60_000) }, now)).toBe('stale');
  });
  test('minutes left round up, and zero once over', () => {
    expect(minutesLeft(iso(61_000), now)).toBe(2);
    expect(minutesLeft(iso(-5), now)).toBe(0);
    expect(minutesLeft(undefined, now)).toBeNull();
    expect(minutesAgo(iso(-125_000), now)).toBe(2);
  });
  test('the offered durations are 15 minutes, an hour and until turned off', () => {
    expect(LIVE_DURATIONS.map((d) => d.ms)).toEqual([900_000, 3_600_000, null]);
  });
});

describe('the map', () => {
  test('the centre of the view is the point', () => {
    const w = 300;
    const h = 200;
    const centre = worldPixel(luanda, 16);
    const tiles = mapTiles(luanda, w, h);
    // A tile's own corner, in world pixels, minus where it is drawn, is the view's origin.
    const t0 = tiles[0];
    const m = t0.url.match(/\/(\d+)\/(\d+)\/(\d+)\.png$/)!;
    const originX = Number(m[2]) * 256 - t0.left;
    const originY = Number(m[3]) * 256 - t0.top;
    expect(originX + w / 2).toBeCloseTo(centre.x, 5);
    expect(originY + h / 2).toBeCloseTo(centre.y, 5);
  });

  test('the tiles cover the whole view', () => {
    const tiles = mapTiles(luanda, 300, 200);
    const minLeft = Math.min(...tiles.map((t) => t.left));
    const maxRight = Math.max(...tiles.map((t) => t.left + 256));
    const minTop = Math.min(...tiles.map((t) => t.top));
    const maxBottom = Math.max(...tiles.map((t) => t.top + 256));
    expect(minLeft).toBeLessThanOrEqual(0);
    expect(maxRight).toBeGreaterThanOrEqual(300);
    expect(minTop).toBeLessThanOrEqual(0);
    expect(maxBottom).toBeGreaterThanOrEqual(200);
  });

  test('a small view needs only a few tiles', () => {
    expect(mapTiles(luanda, 300, 200).length).toBeLessThanOrEqual(6);
  });

  test('longitude wraps at the date line and tiles past the poles are skipped', () => {
    const nearLine = mapTiles({ lat: 0, lng: 179.9999 }, 600, 200);
    expect(nearLine.every((t) => Number(t.url.split('/').slice(-2)[0]) < 2 ** 16)).toBe(true);
    const pole = mapTiles({ lat: 85, lng: 0 }, 600, 600);
    expect(pole.every((t) => Number(t.url.split('/').pop()!.replace('.png', '')) >= 0)).toBe(true);
  });

  test('a point at 0,0 is the corner of four tiles at zoom 1', () => {
    const p = worldPixel({ lat: 0, lng: 0 }, 1);
    expect(p.x).toBeCloseTo(256, 5);
    expect(p.y).toBeCloseTo(256, 5);
  });
});

describe('opening a map app', () => {
  test('each platform gets the link it understands', () => {
    expect(mapsUrl(luanda, 'Here', 'android')).toBe('geo:-8.83833,13.23444?q=-8.83833,13.23444(Here)');
    expect(mapsUrl(luanda, 'Here', 'ios')).toContain('maps.apple.com');
    expect(mapsUrl(luanda, 'Here', 'web')).toContain('openstreetmap.org');
  });
  test('the label is escaped', () => {
    expect(mapsUrl(luanda, 'a b&c', 'android')).toContain('a%20b%26c');
  });
});
