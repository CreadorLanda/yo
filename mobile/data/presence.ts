/**
 * How a last-seen timestamp is said out loud.
 *
 * Pure, and separate from the screen, because the interesting decisions here
 * are about honesty rather than layout: what to say when the server declined
 * to tell us, and how much precision to claim.
 *
 * The header used to read "last seen recently" for everybody, always — a
 * fixed string, because there was no timestamp behind it. It is gone: saying
 * "recently" about someone last seen in March is not a rounding error, it is
 * a different claim.
 */

export type PresenceLabel =
  | { kind: 'online' }
  /** `key` is an i18n key; `minutes`/`hours`/`days` fill its placeholder. */
  | { kind: 'last-seen'; key: string; value: number }
  /** Nothing may be said: hidden, frozen out of view, or never seen. */
  | { kind: 'unknown' };

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

/**
 * Buckets, not exact times.
 *
 * "Last seen 3m ago" is a claim about where somebody was three minutes ago,
 * and a messenger that reports presence to the minute is a tracking tool. The
 * buckets widen as they age for the same reason a clock face has no seconds
 * hand on the hour marks.
 */
export function presenceLabel(
  online: boolean,
  lastSeenIso: string | undefined,
  now: number = Date.now(),
): PresenceLabel {
  if (online) return { kind: 'online' };
  if (!lastSeenIso) return { kind: 'unknown' };

  const at = new Date(lastSeenIso).getTime();
  // An unparseable date is not a time to reason about, and a future one means
  // the clocks disagree — in both cases the honest answer is that we do not
  // know rather than a number pulled out of the arithmetic.
  if (!Number.isFinite(at) || at > now) return { kind: 'unknown' };

  const diff = now - at;
  if (diff < MINUTE) return { kind: 'last-seen', key: 'chats.seen_just_now', value: 0 };
  if (diff < HOUR) {
    return { kind: 'last-seen', key: 'chats.seen_minutes', value: Math.floor(diff / MINUTE) };
  }
  if (diff < DAY) {
    return { kind: 'last-seen', key: 'chats.seen_hours', value: Math.floor(diff / HOUR) };
  }
  return { kind: 'last-seen', key: 'chats.seen_days', value: Math.floor(diff / DAY) };
}
