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

/**
 * The next queued send to attempt, oldest first. A message that gave up
 * (`failed`) waits for a manual tap and is skipped: it must not hold back
 * everything written after it (#364). Retrying it later sends it then, out
 * of order, which is what the person asked for by tapping.
 */
export function nextToSend<T extends { status: string }>(queue: T[]): T | undefined {
  return queue.find((m) => m.status !== 'failed');
}
