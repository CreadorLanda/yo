/**
 * When the app should re-lock itself.
 *
 * Pure — no storage, no React Native, no clock of its own — so the one
 * decision that matters here can be checked without a device. Everything
 * stateful lives in [app-lock].
 *
 * The rule is deliberately about *elapsed time in the background*, not about
 * how long the app has been open. Someone who puts the phone down for a
 * minute and picks it up should not be asked again; someone who left it on a
 * table an hour ago should.
 */

/** Grace periods offered in settings, in milliseconds. */
export const LOCK_TIMEOUTS_MS = [0, 60_000, 5 * 60_000, 15 * 60_000, 60 * 60_000] as const;

export type LockTimeoutMs = (typeof LOCK_TIMEOUTS_MS)[number];

/**
 * A minute. Long enough that switching to the camera roll and back does not
 * ask for the code, short enough that a phone left on a desk locks before
 * anyone sits down at it.
 */
export const DEFAULT_LOCK_TIMEOUT_MS: LockTimeoutMs = 60_000;

/** Keep only a value this build still offers; anything else is the default. */
export function sanitizeTimeout(value: unknown): LockTimeoutMs {
  return (LOCK_TIMEOUTS_MS as readonly number[]).includes(value as number)
    ? (value as LockTimeoutMs)
    : DEFAULT_LOCK_TIMEOUT_MS;
}

/**
 * Whether the grace period has run out.
 *
 * `backgroundedAt` is null while the app is in the foreground, and there is
 * nothing to decide then. A zero timeout means "immediately": the moment the
 * app leaves the screen it is locked, which is what someone choosing that
 * option is asking for and is why it cannot be folded into the comparison
 * below — `now === backgroundedAt` on a fast switch would otherwise let them
 * back in.
 *
 * A clock that has moved *backwards* since the app was backgrounded locks.
 * That is the whole reason this is not a bare subtraction: the arithmetic
 * gives a negative elapsed time, which reads as "no time has passed", and a
 * lock that can be walked past by changing the device clock is not a lock.
 */
export function shouldLock(
  backgroundedAt: number | null,
  now: number,
  timeoutMs: number,
): boolean {
  if (backgroundedAt === null) return false;
  if (timeoutMs <= 0) return true;
  if (now < backgroundedAt) return true;
  return now - backgroundedAt >= timeoutMs;
}
