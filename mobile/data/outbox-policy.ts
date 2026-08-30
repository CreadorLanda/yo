/**
 * Pure retry policy for the offline outbox — no database, no network, no
 * React Native import, so it can be unit tested on its own. data/outbox.ts
 * is where the actual retrying happens; this only answers "give up yet?".
 */

/** Attempts before a message stops auto-retrying and needs a manual tap. */
export const MAX_SEND_ATTEMPTS = 5;

export function hasExhaustedRetries(attempts: number): boolean {
  return attempts >= MAX_SEND_ATTEMPTS;
}
