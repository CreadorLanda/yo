import type { ChatDTO } from '@/data/api/messages';

import { getDB } from './index';

/**
 * The chat list on disk, so it can be shown before the network answers.
 *
 * The whole DTO is kept as JSON. The list screen, the chat header and the
 * outbox all read it, and a column per field would drop anything added later.
 * Order is the server's, stored as a position, because the client never sorts.
 */

export type CachedPreview = { source: string; text: string };

export type CachedChats = {
  active: ChatDTO[];
  archived: ChatDTO[];
  previews: Map<string, CachedPreview>;
};

type Row = {
  id: string;
  dto: string;
  archived_at: string | null;
  preview: string | null;
  preview_src: string | null;
};

export async function loadCachedChats(): Promise<CachedChats> {
  const db = await getDB();
  const res = await db.execute(
    `SELECT id, dto, archived_at, preview, preview_src
       FROM chats
      WHERE dto IS NOT NULL
      ORDER BY position ASC`,
  );
  const out: CachedChats = { active: [], archived: [], previews: new Map() };
  for (const r of (res.rows ?? []) as unknown as Row[]) {
    (r.archived_at ? out.archived : out.active).push(JSON.parse(r.dto) as ChatDTO);
    if (r.preview != null && r.preview_src != null) {
      out.previews.set(r.id, { source: r.preview_src, text: r.preview });
    }
  }
  return out;
}

/** Replace one of the two lists. Previews survive, keyed by the chat. */
export async function saveCachedChats(list: ChatDTO[], archived: boolean): Promise<void> {
  const db = await getDB();
  await db.transaction(async (tx) => {
    const scope = archived ? 'archived_at IS NOT NULL' : 'archived_at IS NULL';
    const marks = list.map(() => '?').join(',');
    await tx.execute(
      list.length > 0
        ? `DELETE FROM chats WHERE ${scope} AND id NOT IN (${marks})`
        : `DELETE FROM chats WHERE ${scope}`,
      list.map((c) => c.id),
    );
    for (const [position, c] of list.entries()) {
      await tx.execute(
        `INSERT INTO chats (id, type, created_at, archived_at, dto, position)
         VALUES (?, ?, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET
           archived_at = excluded.archived_at,
           dto         = excluded.dto,
           position    = excluded.position`,
        [
          c.id,
          c.type,
          c.created_at,
          archived ? c.archived_at ?? c.created_at : null,
          JSON.stringify(c),
          position,
        ],
      );
    }
  });
}

/**
 * Remember a decrypted preview next to the ciphertext it came from, so the
 * list only decrypts again when the last message actually changes.
 */
export async function saveCachedPreview(chatId: string, source: string, text: string): Promise<void> {
  const db = await getDB();
  await db.execute(`UPDATE chats SET preview = ?, preview_src = ? WHERE id = ?`, [text, source, chatId]);
}
