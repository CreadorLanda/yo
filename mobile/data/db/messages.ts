import type { MessageDTO } from '@/data/api/messages';

import { getDB } from './index';

/**
 * Local message history.
 *
 * What is cached here is the *decrypted API DTO*, not the on-screen message.
 * The screen keeps building its bubbles with mapApiMessage, so there is one
 * implementation of that derivation rather than two that drift; a change to
 * how media or attachments are rendered then applies to cached history for
 * free. It also means the row survives a UI refactor untouched.
 *
 * Decryption happens once, on the way in. Replaying an E2EE envelope on every
 * open was the visible cost — a 50-message thread meant 50 keystore round
 * trips before the first bubble appeared.
 */

/** Rows older than this are dropped per chat, newest kept. */
const RETAIN_PER_CHAT = 500;

type Row = {
  server_id: number | null;
  chat_id: string;
  sender_id: string | null;
  sender_name: string | null;
  sender_avatar: string | null;
  body: string;
  message_type: string;
  reply_to_id: string | null;
  created_at: string;
  edited_at: string | null;
  deleted_at: string | null;
  status: string;
  forward_count: number;
  source_channel_id: string | null;
  source_post_id: string | null;
  expires_at: string | null;
  view_limit: number | null;
  views_left: number | null;
};

function rowToDTO(r: Row): MessageDTO {
  return {
    id: Number(r.server_id),
    chat_id: r.chat_id,
    sender_id: r.sender_id ?? '',
    content: r.body,
    message_type: r.message_type,
    reply_to_id: r.reply_to_id ? Number(r.reply_to_id) : undefined,
    created_at: r.created_at,
    edited_at: r.edited_at ?? undefined,
    deleted_at: r.deleted_at ?? undefined,
    sender_name: r.sender_name ?? undefined,
    sender_avatar: r.sender_avatar ?? undefined,
    // Rebuilt from the collapsed status. mapApiMessage only ever compares
    // these against zero, so the exact recipient count is not information
    // the bubble can use — and storing one column keeps the write cheap.
    delivered_to: r.status === 'delivered' || r.status === 'read' ? 1 : 0,
    read_by: r.status === 'read' ? 1 : 0,
    forward_count: r.forward_count ?? 0,
    source_channel_id: r.source_channel_id ?? undefined,
    source_post_id: r.source_post_id ?? undefined,
    expires_at: r.expires_at ?? undefined,
    view_limit: r.view_limit ?? undefined,
    views_left: r.views_left ?? undefined,
  };
}

function statusOf(m: MessageDTO): string {
  if (m.read_by && m.read_by > 0) return 'read';
  if (m.delivered_to && m.delivered_to > 0) return 'delivered';
  return 'sent';
}

/**
 * Newest `limit` messages for a chat, returned oldest-first — the order the
 * chat screen renders in, so the caller never has to reverse.
 */
export async function loadCachedMessages(
  chatId: string,
  limit = 50,
): Promise<MessageDTO[]> {
  const db = await getDB();
  const res = await db.execute(
    `SELECT server_id, chat_id, sender_id, sender_name, sender_avatar, body,
            message_type, reply_to_id, created_at, edited_at, deleted_at, status,
            forward_count, source_channel_id, source_post_id, expires_at,
            view_limit, views_left
       FROM messages
      WHERE chat_id = ? AND server_id IS NOT NULL
      ORDER BY server_id DESC
      LIMIT ?`,
    [chatId, limit],
  );
  const rows = (res.rows ?? []) as unknown as Row[];
  return rows.map(rowToDTO).reverse();
}

/**
 * Write decrypted messages through to the cache.
 *
 * `body` must already be plaintext: storing an envelope would defeat the
 * point, since the next open would have to decrypt it again anyway.
 *
 * Upsert rather than insert — a message reappears on every refresh, and its
 * receipt status changes underneath it.
 */
export async function saveCachedMessages(
  chatId: string,
  msgs: { dto: MessageDTO; body: string }[],
): Promise<void> {
  if (msgs.length === 0) return;
  const db = await getDB();

  await db.transaction(async (tx) => {
    for (const { dto, body } of msgs) {
      await tx.execute(
        `INSERT INTO messages
           (id, server_id, chat_id, sender_id, sender_name, sender_avatar, body,
            message_type, reply_to_id, created_at, edited_at, deleted_at, status, pending,
            forward_count, source_channel_id, source_post_id, expires_at,
            view_limit, views_left)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET
           body        = excluded.body,
           sender_name = excluded.sender_name,
           sender_avatar = excluded.sender_avatar,
           edited_at   = excluded.edited_at,
           deleted_at  = excluded.deleted_at,
           -- Origin has to be updated too, or a row cached before these
           -- columns existed would keep coming back without them.
           forward_count     = excluded.forward_count,
           source_channel_id = excluded.source_channel_id,
           source_post_id    = excluded.source_post_id,
           expires_at        = excluded.expires_at,
           view_limit        = excluded.view_limit,
           -- Opens only ever go down, so never let a stale refresh restore one.
           views_left        = MIN(COALESCE(messages.views_left, 999), COALESCE(excluded.views_left, 999)),
           -- Receipts only ever move forward. Without this guard a refresh
           -- that raced a websocket update could walk a read message back to
           -- delivered, flipping the ticks backwards on screen.
           status      = CASE
                           WHEN messages.status = 'read' THEN 'read'
                           WHEN messages.status = 'delivered'
                                AND excluded.status = 'sent' THEN 'delivered'
                           ELSE excluded.status
                         END`,
        [
          String(dto.id),
          dto.id,
          chatId,
          dto.sender_id ?? null,
          dto.sender_name ?? null,
          dto.sender_avatar ?? null,
          body,
          dto.message_type ?? 'text',
          dto.reply_to_id != null ? String(dto.reply_to_id) : null,
          dto.created_at,
          dto.edited_at ?? null,
          dto.deleted_at ?? null,
          statusOf(dto),
          dto.forward_count ?? 0,
          dto.source_channel_id ?? null,
          dto.source_post_id ?? null,
          dto.expires_at ?? null,
          dto.view_limit ?? null,
          dto.views_left ?? null,
        ],
      );
    }
  });
}

/**
 * Record that a limited-view message was opened.
 *
 * Written straight through rather than waiting for the next fetch: the whole
 * point of caching is that the chat can be reopened without the network, and
 * a cached copy that still says "tap to view" would offer an open that no
 * longer exists.
 */
export async function markCachedMessageOpened(
  messageId: string,
  viewsLeft: number,
): Promise<void> {
  const db = await getDB();
  await db.execute(`UPDATE messages SET views_left = ? WHERE id = ?`, [viewsLeft, messageId]);
}

/** Drop a message locally — mirrors a delete the user made or received. */
export async function deleteCachedMessage(messageId: string): Promise<void> {
  const db = await getDB();
  await db.execute(`DELETE FROM messages WHERE id = ?`, [messageId]);
}

/**
 * Trim a chat's history to the newest RETAIN_PER_CHAT rows.
 *
 * Unbounded growth is the failure mode nobody notices until the database is
 * hundreds of megabytes, and re-fetching old pages costs one request.
 */
export async function trimCachedChat(chatId: string): Promise<void> {
  const db = await getDB();
  await db.execute(
    `DELETE FROM messages
      WHERE chat_id = ?
        AND server_id IS NOT NULL
        AND server_id NOT IN (
          SELECT server_id FROM messages
           WHERE chat_id = ? AND server_id IS NOT NULL
           ORDER BY server_id DESC LIMIT ?
        )`,
    [chatId, chatId, RETAIN_PER_CHAT],
  );
}

// ── Offline outbox ───────────────────────────────────────────────────────
//
// A message is written here the moment it is submitted, before the network
// is involved at all: it survives the app being closed, and the outbox
// (data/outbox.ts) is what actually retries the send and reconciles the
// result. This file only does the mechanical persistence; retry policy
// (when to give up, when to retry) lives in the outbox module so it can be
// unit tested without a database.

export type PendingSend = {
  /** The optimistic local id — also messages.id until the send succeeds. */
  id: string;
  chatId: string;
  senderId: string | null;
  text: string;
  replyToId: string | null;
  createdAt: string;
  attempts: number;
  status: 'sending' | 'failed';
};

/** Persist a queued text send and its outbox job in one transaction. */
export async function insertPendingMessage(input: {
  id: string;
  chatId: string;
  senderId: string;
  text: string;
  replyToId: string | null;
  createdAt: string;
}): Promise<void> {
  const db = await getDB();
  await db.transaction(async (tx) => {
    await tx.execute(
      `INSERT INTO messages
         (id, server_id, chat_id, sender_id, body, message_type, reply_to_id,
          created_at, status, pending)
       VALUES (?, NULL, ?, ?, ?, 'text', ?, ?, 'sending', 1)`,
      [input.id, input.chatId, input.senderId, input.text, input.replyToId, input.createdAt],
    );
    await tx.execute(
      `INSERT INTO outbox (kind, chat_id, message_id, payload, attempts, created_at)
       VALUES ('send_message', ?, ?, ?, 0, ?)`,
      [input.chatId, input.id, JSON.stringify({ text: input.text }), input.createdAt],
    );
  });
}

type OutboxRow = {
  message_id: string;
  chat_id: string;
  attempts: number;
  sender_id: string | null;
  body: string;
  reply_to_id: string | null;
  created_at: string;
  status: string;
};

function toPendingSend(r: OutboxRow): PendingSend {
  return {
    id: r.message_id,
    chatId: r.chat_id,
    senderId: r.sender_id,
    text: r.body,
    replyToId: r.reply_to_id,
    createdAt: r.created_at,
    attempts: r.attempts,
    status: r.status === 'failed' ? 'failed' : 'sending',
  };
}

/**
 * Every not-yet-sent message in a chat, oldest first — the order the
 * outbox must drain in, and the order the chat screen renders in.
 */
export async function listPendingSends(chatId: string): Promise<PendingSend[]> {
  const db = await getDB();
  const res = await db.execute(
    `SELECT o.id as outbox_id, o.message_id, o.chat_id, o.attempts,
            m.sender_id, m.body, m.reply_to_id, m.created_at, m.status
       FROM outbox o
       JOIN messages m ON m.id = o.message_id
      WHERE o.kind = 'send_message' AND o.chat_id = ?
      ORDER BY o.id ASC`,
    [chatId],
  );
  const rows = (res.rows ?? []) as unknown as OutboxRow[];
  return rows.map(toPendingSend);
}

/** Every chat with at least one queued send — where drainAll resumes. */
export async function listChatsWithPendingSends(): Promise<string[]> {
  const db = await getDB();
  const res = await db.execute(
    `SELECT DISTINCT chat_id FROM outbox WHERE kind = 'send_message'`,
  );
  return ((res.rows ?? []) as unknown as { chat_id: string }[]).map((r) => r.chat_id);
}

/**
 * The send landed. The row's identity moves from the optimistic local id to
 * the server's — the same convention `saveCachedMessages` uses for every
 * other row — so a later history refetch upserts onto this row instead of
 * creating a duplicate.
 */
export async function markSendSucceeded(tempId: string, dto: MessageDTO): Promise<void> {
  const db = await getDB();
  await db.transaction(async (tx) => {
    await tx.execute(
      `UPDATE messages SET
         id = ?, server_id = ?, status = ?, pending = 0, created_at = ?
       WHERE id = ?`,
      [String(dto.id), dto.id, statusOf(dto), dto.created_at, tempId],
    );
    await tx.execute(
      `DELETE FROM outbox WHERE kind = 'send_message' AND message_id = ?`,
      [tempId],
    );
  });
}

/** One failed attempt. Returns the new attempt count so the caller can
 * decide (via the pure policy in data/outbox.ts) whether to give up. */
export async function recordSendAttemptFailed(tempId: string, error: string): Promise<number> {
  const db = await getDB();
  await db.execute(
    `UPDATE outbox SET attempts = attempts + 1, last_error = ?
      WHERE kind = 'send_message' AND message_id = ?`,
    [error, tempId],
  );
  const res = await db.execute(
    `SELECT attempts FROM outbox WHERE kind = 'send_message' AND message_id = ?`,
    [tempId],
  );
  return ((res.rows ?? []) as unknown as { attempts: number }[])[0]?.attempts ?? 0;
}

/** Stop auto-retrying — surfaced to the user as a tap-to-retry bubble. */
export async function markSendGivenUp(tempId: string): Promise<void> {
  const db = await getDB();
  await db.execute(`UPDATE messages SET status = 'failed' WHERE id = ?`, [tempId]);
}

/** A manual retry resets the count and re-enters the automatic queue. */
export async function resetFailedSend(tempId: string): Promise<void> {
  const db = await getDB();
  await db.transaction(async (tx) => {
    await tx.execute(
      `UPDATE outbox SET attempts = 0, last_error = NULL
        WHERE kind = 'send_message' AND message_id = ?`,
      [tempId],
    );
    await tx.execute(`UPDATE messages SET status = 'sending' WHERE id = ?`, [tempId]);
  });
}

/**
 * Erase all local history.
 *
 * Called on logout. The database is one file shared by whoever signs in on
 * this device, so leaving it behind would show the next account the previous
 * one's decrypted conversations.
 */
export async function wipeLocalHistory(): Promise<void> {
  const db = await getDB();
  await db.transaction(async (tx) => {
    await tx.execute('DELETE FROM messages');
    await tx.execute('DELETE FROM chats');
    await tx.execute('DELETE FROM sync_cursors');
    await tx.execute('DELETE FROM outbox');
  });
}
