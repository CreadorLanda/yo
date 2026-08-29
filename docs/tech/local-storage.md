# 📱 Local Storage (on-device SQLite + SQLCipher)

> Messages live on the user's device. The server is a relay for ciphertext, not a store of conversations.

This is the WhatsApp approach, applied to Yo: the source of truth for a user's chats is **their device's SQLite database**, encrypted at rest with SQLCipher and unlocked by a key held in the OS keychain.

---

## Why on-device

| Concern       | Outcome                                                      |
|---------------|--------------------------------------------------------------|
| Privacy       | Server cannot read messages even if compromised              |
| Offline       | Full inbox available offline; sends queue until reconnect    |
| Performance   | Lists, search and reactions run locally — no round trips     |
| Cost          | Server only carries pending ciphertext envelopes             |
| Sovereignty   | Users can export / backup their data; deletion is real       |

---

## Stack on mobile

- **Database**: SQLite via [`expo-sqlite`](https://docs.expo.dev/versions/latest/sdk/sqlite/).
- **At-rest encryption**: SQLCipher (community plugin / build-time integration) — every byte of the DB file is AES-256-CBC encrypted.
- **Key management**: a randomly generated 256-bit DB key is wrapped by the OS keychain:
  - iOS: Keychain item with `kSecAttrAccessibleWhenUnlockedThisDeviceOnly`.
  - Android: Android Keystore (StrongBox where available), AES-GCM wrap.
- **Unlock**: app opens the DB only after the OS hands back the key. Optional biometric gate (`expo-local-authentication`) before unlocking the keychain item.
- **Backup**: opt-in, encrypted export to user-controlled cloud (iCloud / Drive) — see *Backups* below.

Desktop and web mirror this with platform equivalents (Keychain on macOS, DPAPI on Windows, libsecret on Linux; WebCrypto + IndexedDB on web).

---

## Schema (mobile)

```sql
PRAGMA foreign_keys = ON;
PRAGMA journal_mode = WAL;

CREATE TABLE chats (
  id              TEXT PRIMARY KEY,           -- 's:<uuid>' or 'wa:<jid>'
  name            TEXT NOT NULL,
  username        TEXT,
  avatar_uri      TEXT,
  last_message_at INTEGER,
  unread_count    INTEGER NOT NULL DEFAULT 0,
  pinned          INTEGER NOT NULL DEFAULT 0,
  archived        INTEGER NOT NULL DEFAULT 0,
  is_group        INTEGER NOT NULL DEFAULT 0,
);

CREATE TABLE messages (
  id              TEXT PRIMARY KEY,
  chat_id         TEXT NOT NULL REFERENCES chats(id) ON DELETE CASCADE,
  author_id       TEXT,                       -- null for system messages
  body            TEXT,
  media_kind      TEXT,                       -- image | video | audio | document | location | contact | poll | event | game
  media_uri       TEXT,
  media_meta      TEXT,                       -- JSON for poll options, event fields, etc.
  status          TEXT NOT NULL DEFAULT 'sent', -- sent | delivered | read | failed
  reply_to_id     TEXT,
  is_ai           INTEGER NOT NULL DEFAULT 0,  -- 1 for Dandara replies
  created_at      INTEGER NOT NULL,
  edited_at       INTEGER,
  deleted_at      INTEGER
);
CREATE INDEX idx_messages_chat_created ON messages(chat_id, created_at);

CREATE TABLE reactions (
  message_id      TEXT NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
  emoji           TEXT NOT NULL,
  count           INTEGER NOT NULL DEFAULT 0,
  mine            INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (message_id, emoji)
);

CREATE TABLE attachments (
  id              TEXT PRIMARY KEY,
  message_id      TEXT NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
  kind            TEXT NOT NULL,
  uri             TEXT,
  size            INTEGER,
  duration_sec    INTEGER,
  width           INTEGER,
  height          INTEGER,
  local_path      TEXT                        -- cached download
);

CREATE TABLE contacts (
  id              TEXT PRIMARY KEY,
  display_name    TEXT NOT NULL,
  username        TEXT,
  phone_hash      BLOB,
  avatar_uri      TEXT,
);

CREATE TABLE drafts (
  chat_id         TEXT PRIMARY KEY REFERENCES chats(id) ON DELETE CASCADE,
  body            TEXT,
  reply_to_id     TEXT,
  attachment_meta TEXT,
  updated_at      INTEGER NOT NULL
);

-- Signal session state, on-device only.
CREATE TABLE signal_identity (peer_id TEXT PRIMARY KEY, key BLOB, trust INTEGER NOT NULL DEFAULT 1);
CREATE TABLE signal_sessions (
  peer_id     TEXT NOT NULL,
  device_id   TEXT NOT NULL,
  state       BLOB NOT NULL,
  PRIMARY KEY (peer_id, device_id)
);
CREATE TABLE signal_prekeys (
  key_id      INTEGER PRIMARY KEY,
  pub         BLOB NOT NULL,
  priv        BLOB NOT NULL,
  used        INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE signal_signed_prekey (
  key_id      INTEGER PRIMARY KEY,
  pub         BLOB NOT NULL,
  priv        BLOB NOT NULL,
  signature   BLOB NOT NULL,
  created_at  INTEGER NOT NULL
);
CREATE TABLE signal_sender_keys (
  group_id    TEXT NOT NULL,
  sender_id   TEXT NOT NULL,
  state       BLOB NOT NULL,
  PRIMARY KEY (group_id, sender_id)
);

-- Sync bookkeeping
CREATE TABLE sync_cursors (kind TEXT PRIMARY KEY, value TEXT, updated_at INTEGER);

-- Filters (custom message filters created by the user)
CREATE TABLE custom_filters (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  chat_ids TEXT NOT NULL                       -- JSON array
);

-- Themes the user made. Bundled packs ship with the app and are not stored.
CREATE TABLE theme_packs (
  id         TEXT PRIMARY KEY,
  json       TEXT NOT NULL,                    -- tokens + chat chrome + layout + icons
  created_at TEXT NOT NULL
);

-- Theme choices: active pack, installed and liked sets, light/dark preference,
-- personal overrides. Here rather than in SecureStore, which does not reliably
-- store values over 2048 bytes.
CREATE TABLE theme_prefs (key TEXT PRIMARY KEY, value TEXT NOT NULL);
```

Migrations live in [`mobile/data/db/schema.ts`](../../mobile/data/db/schema.ts),
append-only and tracked by `user_version`, applied when the database is opened.

Photo wallpapers and custom icons are files, not rows: the picker hands back a
URI in the OS cache, so the bytes are copied into the app's document directory
by [`mobile/data/theme-assets.ts`](../../mobile/data/theme-assets.ts) before the
path is stored, and orphans are swept at launch.

---

## Sync model

### Push (preferred)

While the app is connected:

1. Server enqueues an envelope addressed to a device.
2. Realtime hub pushes a WS frame with the envelope.
3. Client decrypts (TweetNaCl), persists into `messages`, acks back.
4. Server removes the envelope (or expires it after a short TTL).

### Pull (reconnect / catch-up)

On reconnect, the client calls `GET /messages/since?cursor=<last_known>` to drain envelopes accumulated while offline. The same decrypt → persist → ack loop applies, batched.

### Send

1. App writes the message into `messages` with `status='sent'` and `created_at=now` (optimistic).
2. the client encrypts to each recipient device; client `POST /messages` with the envelopes.
3. Server acks → client updates `status='delivered'` on read receipts.
4. On failure (network, decrypt error), `status='failed'`; the user can retry from the UI.

### Cursors

`sync_cursors` tracks per-stream positions (`messages`, `channels:posts`, `stories`, …) so reconnect is cheap and resumable.

---

## Backups (opt-in)

- Periodic full-database snapshot, encrypted with a key derived from a user passphrase (Argon2id) plus a per-backup salt.
- Uploaded to the user's cloud (iCloud / Drive) — never to Yo servers.
- Restore is an explicit flow that asks for the passphrase, never automatic.
- The OS-keychain DB key is **not** included; backups carry their own envelope.

---

## Cache budget & cleanup

- Media files are cached under `Library/Caches/yo/`. The user can clear cache from Settings → Storage.
- Message text rows are never auto-deleted; only attachments are pruned.
- Optional retention policy per chat (e.g. delete after 30 days) — implemented as a periodic local sweep.

---

## Threat model

- Device compromise with full disk access *while the device is unlocked*: messages are readable. Mitigation: PIN / biometric, screen-off auto-lock.
- Device compromise *while locked*: SQLCipher key is in the keychain, gated by device unlock; messages stay at rest as ciphertext.
- Lost device with backups disabled: messages are gone — no server-side recovery, by design.
- Operator compromise: server holds only pending ciphertext envelopes and media envelopes; cannot reconstruct conversations.
