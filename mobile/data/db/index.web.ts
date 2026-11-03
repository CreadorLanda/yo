/**
 * The local database does not exist in the browser.
 *
 * SQLCipher is a native library, so on web there is nothing to open. Every
 * caller already wraps `getDB` in a catch (a missing cache must never break a
 * screen), which means rejecting here makes the web client read from the
 * network, exactly what a phone does before its cache is warm.
 */
export const DB_NAME = 'socialize.db';

const REASON = 'The local database is not available on web.';

export function dbFailure(): string | null {
  return REASON;
}

export async function getDB(): Promise<never> {
  throw new Error(REASON);
}

export async function closeDB(): Promise<void> {}
