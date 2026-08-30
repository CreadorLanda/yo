import { createAvatar } from '@dicebear/core';
import * as lorelei from '@dicebear/lorelei';

/**
 * The avatar somebody has when they have not chosen one.
 *
 * Generated from their id, so the same person is the same face on every
 * device and after every reinstall, with nothing stored anywhere and no
 * request made. That last part is the reason this is the local library and
 * not DiceBear's HTTP API: asking `api.dicebear.com` for an avatar would tell
 * a third party who you are looking at, once per row of the chat list, in an
 * app whose whole argument is that nobody can see that.
 *
 * `lorelei` is CC0 1.0 — public domain, no attribution required — which the
 * package asserts in its own `meta.license`. That was the deciding factor:
 * roughly half of DiceBear's styles are CC BY 4.0 and would put an
 * attribution obligation on everyone who ships this app.
 *
 * The style is imported directly rather than through `@dicebear/collection`.
 * The barrel re-exports thirty-odd styles and would bundle every one of them;
 * the same reason the typefaces are imported one subpath at a time.
 */

/** Seeds are ids, so the cache is bounded by how many people you have seen. */
const cache = new Map<string, string>();
/**
 * Big enough for a chat list and a few screens of search, small enough that
 * an app left open for a week does not accumulate every face it has drawn.
 * Each entry is roughly 6 KB of SVG.
 */
const MAX_CACHED = 200;

/**
 * A deterministic avatar for `seed`.
 *
 * Returns SVG markup for `react-native-svg` to render. Cached because
 * generating one is real work — string building over the style's parts — and
 * a chat list re-renders far more often than the set of people in it changes.
 */
export function defaultAvatarSvg(seed: string, size = 96): string {
  const key = `${seed}@${size}`;
  const hit = cache.get(key);
  if (hit !== undefined) {
    // Re-insert so the eviction below drops what is genuinely coldest rather
    // than whatever happened to be drawn first.
    cache.delete(key);
    cache.set(key, hit);
    return hit;
  }

  const svg = createAvatar(lorelei, { seed, size }).toString();

  if (cache.size >= MAX_CACHED) {
    const oldest = cache.keys().next().value;
    if (oldest !== undefined) cache.delete(oldest);
  }
  cache.set(key, svg);
  return svg;
}

/**
 * What to draw somebody with.
 *
 * An id is preferred over a username because a username can be changed and a
 * face that changes with it is a face nobody recognises. The username is the
 * fallback for the one place no id exists yet — the person choosing their own
 * name during sign-up, watching it settle into a face.
 */
export function avatarSeed(input: { id?: string; username?: string }): string {
  return (input.id || input.username || 'yo').trim().toLowerCase();
}

/** Exposed for tests and for anywhere that needs to state the licence. */
export const DEFAULT_AVATAR_LICENSE = lorelei.meta.license;
