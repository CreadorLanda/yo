/**
 * Local schema.
 *
 * The device is the source of truth for conversation history. The server
 * relays and then forgets: media is swept once delivered, and message
 * bodies are end-to-end encrypted so it never had them in the clear. What
 * is stored here is the decrypted content, which is why the whole file is
 * encrypted with SQLCipher.
 *
 * Migrations are append-only. Each entry runs once, in order, tracked by
 * user_version — never edit a shipped one, add another.
 */

export type Migration = { name: string; sql: string };

export const MIGRATIONS: Migration[] = [
  {
    name: '001_core',
    sql: `
      CREATE TABLE IF NOT EXISTS chats (
        id            TEXT PRIMARY KEY,
        type          TEXT NOT NULL,
        title         TEXT,
        avatar_url    TEXT,
        status        TEXT,
        peer_user_id  TEXT,
        peer_username TEXT,
        unread_count  INTEGER NOT NULL DEFAULT 0,
        pinned_at     TEXT,
        muted_until   TEXT,
        archived_at   TEXT,
        created_at    TEXT NOT NULL,
        -- Server ordering key, mirrored so the list can sort without a fetch.
        last_activity TEXT
      );

      CREATE TABLE IF NOT EXISTS messages (
        -- Server id once known; before that the optimistic local id, so a
        -- message has one identity for its whole life.
        id           TEXT PRIMARY KEY,
        server_id    INTEGER,
        chat_id      TEXT NOT NULL,
        sender_id    TEXT,
        sender_name  TEXT,
        -- Decrypted. The point of the encrypted database.
        body         TEXT NOT NULL DEFAULT '',
        message_type TEXT NOT NULL DEFAULT 'text',
        -- JSON for media/attachment payloads, decrypted keys included.
        payload      TEXT,
        reply_to_id  TEXT,
        created_at   TEXT NOT NULL,
        edited_at    TEXT,
        deleted_at   TEXT,
        status       TEXT NOT NULL DEFAULT 'sent',
        -- Rows written locally that the server has not accepted yet.
        pending      INTEGER NOT NULL DEFAULT 0
      );

      CREATE INDEX IF NOT EXISTS idx_messages_chat_time
        ON messages (chat_id, created_at DESC);
      CREATE INDEX IF NOT EXISTS idx_messages_pending
        ON messages (pending) WHERE pending = 1;
      CREATE UNIQUE INDEX IF NOT EXISTS uq_messages_server_id
        ON messages (server_id) WHERE server_id IS NOT NULL;

      -- Where each stream was last synced, so reconnecting is cheap.
      CREATE TABLE IF NOT EXISTS sync_cursors (
        stream     TEXT PRIMARY KEY,
        cursor     TEXT,
        synced_at  TEXT
      );

      -- Work queued while offline: sends, edits, receipts. Drained in order.
      CREATE TABLE IF NOT EXISTS outbox (
        id         INTEGER PRIMARY KEY AUTOINCREMENT,
        kind       TEXT NOT NULL,
        chat_id    TEXT,
        message_id TEXT,
        payload    TEXT NOT NULL,
        attempts   INTEGER NOT NULL DEFAULT 0,
        last_error TEXT,
        created_at TEXT NOT NULL
      );
    `,
  },
  {
    name: '002_message_search',
    sql: `
      -- FTS5 is a compile-time feature (see the op-sqlite block in
      -- package.json). Search runs over decrypted bodies inside the
      -- encrypted file, so it never leaks plaintext to disk.
      CREATE VIRTUAL TABLE IF NOT EXISTS messages_fts
        USING fts5(body, content='messages', content_rowid='rowid');

      CREATE TRIGGER IF NOT EXISTS messages_fts_insert AFTER INSERT ON messages
      BEGIN
        INSERT INTO messages_fts(rowid, body) VALUES (new.rowid, new.body);
      END;

      CREATE TRIGGER IF NOT EXISTS messages_fts_delete AFTER DELETE ON messages
      BEGIN
        INSERT INTO messages_fts(messages_fts, rowid, body)
        VALUES ('delete', old.rowid, old.body);
      END;

      CREATE TRIGGER IF NOT EXISTS messages_fts_update AFTER UPDATE ON messages
      BEGIN
        INSERT INTO messages_fts(messages_fts, rowid, body)
        VALUES ('delete', old.rowid, old.body);
        INSERT INTO messages_fts(rowid, body) VALUES (new.rowid, new.body);
      END;
    `,
  },
  {
    name: '003_sender_avatar',
    sql: `
      -- Cached rows rebuild the API DTO so the screen can reuse mapApiMessage
      -- unchanged. The avatar is part of that DTO; without it, group bubbles
      -- reloaded from cache would lose their sender pictures.
      ALTER TABLE messages ADD COLUMN sender_avatar TEXT;
    `,
  },
  {
    name: '004_secrets',
    sql: `
      -- Bulk cryptographic material that outgrew the keychain.
      --
      -- SecureStore caps a value at 2048 bytes; the device key blob is ~2500
      -- with a 40-key one-time pool, so the write failed and the identity
      -- silently vanished on restart — every inbound envelope then decrypted
      -- to "missing keys". This file is SQLCipher-encrypted with a key that
      -- *is* small enough for the keychain, which is the right split: the
      -- keychain holds one key, the database holds the volume.
      CREATE TABLE IF NOT EXISTS secrets (
        key   TEXT PRIMARY KEY,
        value TEXT NOT NULL
      );
    `,
  },
  {
    name: '005_notes_and_lists',
    sql: `
      -- Private notes about a conversation.
      --
      -- These never reach the server, and not only for the usual reason: a
      -- note is what *you* think about someone, written without their
      -- knowledge. Syncing it would make the most one-sided thing in the app
      -- the least private. It lives in the encrypted file, like history.
      CREATE TABLE IF NOT EXISTS chat_notes (
        chat_id    TEXT PRIMARY KEY,
        body       TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      -- Named lists of chats, shown as chips above the chat list.
      --
      -- They already existed in the UI but only in memory, so every list a
      -- user built was gone the next time the app started.
      CREATE TABLE IF NOT EXISTS chat_lists (
        id         TEXT PRIMARY KEY,
        name       TEXT NOT NULL,
        created_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS chat_list_members (
        list_id TEXT NOT NULL REFERENCES chat_lists(id) ON DELETE CASCADE,
        chat_id TEXT NOT NULL,
        PRIMARY KEY (list_id, chat_id)
      );

      CREATE INDEX IF NOT EXISTS idx_list_members_chat
        ON chat_list_members (chat_id);

      -- Notes are searchable. Finding someone by what you wrote about them
      -- is often easier than remembering their name.
      CREATE VIRTUAL TABLE IF NOT EXISTS chat_notes_fts
        USING fts5(body, content='chat_notes', content_rowid='rowid');

      CREATE TRIGGER IF NOT EXISTS chat_notes_fts_insert AFTER INSERT ON chat_notes
      BEGIN
        INSERT INTO chat_notes_fts(rowid, body) VALUES (new.rowid, new.body);
      END;

      CREATE TRIGGER IF NOT EXISTS chat_notes_fts_delete AFTER DELETE ON chat_notes
      BEGIN
        INSERT INTO chat_notes_fts(chat_notes_fts, rowid, body)
        VALUES ('delete', old.rowid, old.body);
      END;

      CREATE TRIGGER IF NOT EXISTS chat_notes_fts_update AFTER UPDATE ON chat_notes
      BEGIN
        INSERT INTO chat_notes_fts(chat_notes_fts, rowid, body)
        VALUES ('delete', old.rowid, old.body);
        INSERT INTO chat_notes_fts(rowid, body) VALUES (new.rowid, new.body);
      END;
    `,
  },
  {
    name: '006_message_origin',
    sql: `
      -- Where a message came from.
      --
      -- The cache rebuilds the API DTO, so anything it does not store is
      -- silently dropped on the next read: a forwarded message came back
      -- looking first-hand, and a forwarded channel post lost the link
      -- back to its source. A cache that quietly returns less than it was
      -- given is worse than no cache.
      ALTER TABLE messages ADD COLUMN forward_count INTEGER NOT NULL DEFAULT 0;
      ALTER TABLE messages ADD COLUMN source_channel_id TEXT;
      ALTER TABLE messages ADD COLUMN source_post_id TEXT;
    `,
  },
  {
    name: '007_message_expiry',
    sql: `
      -- The disappearing-message deadline. Cached like everything else the
      -- DTO carries: a countdown that disappears on a cached read would look
      -- exactly like a message that is no longer expiring.
      ALTER TABLE messages ADD COLUMN expires_at TEXT;
    `,
  },
  {
    name: '008_view_limit',
    sql: `
      -- How many opens a limited-view message has left.
      --
      -- Cached like the rest of the DTO: without it a cached read rebuilds
      -- the message as unopened, which is the same bug the feature had
      -- before the server was consulted at all.
      ALTER TABLE messages ADD COLUMN view_limit INTEGER;
      ALTER TABLE messages ADD COLUMN views_left INTEGER;
    `,
  },
  {
    name: '009_themes',
    sql: `
      -- Themes, which until now lived only in memory: the active pack, the
      -- installed set, and anything the person built themselves all died
      -- with the process. The editor was real, the plumbing under it was
      -- not.
      --
      -- Here rather than in SecureStore because a single custom pack is a
      -- few kilobytes of tokens, chrome and layout — well past the 2048
      -- bytes SecureStore stores reliably, and past it silently.
      CREATE TABLE IF NOT EXISTS theme_packs (
        id         TEXT PRIMARY KEY,
        json       TEXT NOT NULL,
        created_at TEXT NOT NULL
      );

      -- Everything that is a choice rather than a pack: active id, installed
      -- and liked sets, light/dark preference, and the always-on personal
      -- overrides. One row per key, JSON in the value, so a new knob needs
      -- no migration of its own.
      CREATE TABLE IF NOT EXISTS theme_prefs (
        key   TEXT PRIMARY KEY,
        value TEXT NOT NULL
      );
    `,
  },
];
