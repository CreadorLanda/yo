import type { MessageDTO } from '@/data/api/messages';

/**
 * How a fetched page of history is reconciled with what is already on disk.
 *
 * Pure on purpose. Everything here decides what opening a chat costs and what
 * it may throw away, so it has to be testable without a database or a screen.
 */

/** What decryptMessageContent returns for a body it could not open. */
const SEALED_BODY = '[encrypted]';

/** Whether a body is still an E2EE envelope rather than readable text. */
export function isSealedBody(body?: string | null): boolean {
  return !!body && (body === SEALED_BODY || body.startsWith('soc1.') || body.startsWith('soc1g.'));
}

/**
 * The plaintext already held for a fetched message, or null if it has to be
 * decrypted. An edit changes the body, and a body that failed to open before
 * gets another chance, because the session may exist by now.
 */
export function reusableBody(server: MessageDTO, cached: MessageDTO | undefined): string | null {
  if (!cached?.content || isSealedBody(cached.content)) return null;
  if ((cached.edited_at ?? null) !== (server.edited_at ?? null)) return null;
  return cached.content;
}

/**
 * Cached messages the server no longer returns: deleted, expired or cleared
 * while this chat was closed. Only the range the page covers can be judged.
 * Anything newer may have arrived after the page was read, and anything older
 * than a full page was simply not asked for.
 */
export function staleCachedIds(
  cached: MessageDTO[],
  server: MessageDTO[],
  pageSize: number,
): number[] {
  const seen = new Set(server.map((m) => m.id));
  const ids = server.map((m) => m.id);
  const newest = ids.length > 0 ? Math.max(...ids) : Infinity;
  const oldest = ids.length >= pageSize ? Math.min(...ids) : 0;
  return cached
    .filter((m) => !seen.has(m.id) && m.id >= oldest && m.id <= newest)
    .map((m) => m.id);
}

const isServerId = (id: string) => /^\d+$/.test(id);

/**
 * Lay a fetched page over what is on screen. Local bubbles the server has not
 * accepted yet stay, and so does anything that arrived live after the page was
 * read. Replacing the list outright lost both.
 */
export function mergeThread<T extends { id: string }>(
  current: T[],
  fetched: T[],
  stale: number[],
): T[] {
  const seen = new Set(fetched.map((m) => m.id));
  const gone = new Set(stale.map(String));
  const newest = fetched.reduce((max, m) => (isServerId(m.id) ? Math.max(max, Number(m.id)) : max), 0);
  const kept = current.filter(
    (m) => !seen.has(m.id) && !gone.has(m.id) && (!isServerId(m.id) || Number(m.id) > newest),
  );
  return [...fetched, ...kept];
}

/** Same content, so the screen can keep the list it has and not repaint. */
export function sameThread(a: unknown[], b: unknown[]): boolean {
  return a.length === b.length && JSON.stringify(a) === JSON.stringify(b);
}

/** Drop what has passed its deadline, so an offline read cannot show it. */
export function withoutExpired<T extends { expires_at?: string }>(list: T[], now = Date.now()): T[] {
  return list.filter((m) => !m.expires_at || new Date(m.expires_at).getTime() > now);
}
