# 💾 Database

> Where each piece of data lives, and why.

ZwoSocial splits data across three stores with different guarantees:

| Store        | Where        | Holds                                              | Encryption       |
|--------------|--------------|----------------------------------------------------|------------------|
| PostgreSQL   | Server       | Authoritative metadata, public content, pending envelopes | At rest (disk/KMS) |
| Redis        | Server       | Queues, cache, presence, pub/sub                  | At rest (disk)   |
| SQLite       | User device  | Full chat history, drafts, contacts cache          | SQLCipher (per-user) |

No MongoDB — Postgres handles the structured data; documents that need flexible shape are stored as JSONB columns.

---

## PostgreSQL — server, authoritative

Naming: `snake_case`, UUIDv7 primary keys, `created_at` / `updated_at` on every table.

### Identity

```sql
CREATE TABLE users (
  id              UUID PRIMARY KEY,
  phone_hash      BYTEA UNIQUE NOT NULL,         -- hashed phone, never plaintext
  username        VARCHAR(50) UNIQUE NOT NULL,
  username_public BOOLEAN NOT NULL DEFAULT TRUE,
  display_name    VARCHAR(100) NOT NULL,
  bio             TEXT,
  avatar_uri      TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE devices (
  id              UUID PRIMARY KEY,
  user_id         UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name            TEXT NOT NULL,                 -- "iPhone 15 Pro"
  platform        TEXT NOT NULL,                 -- ios | android | web | desktop
  push_token_enc  BYTEA,                         -- FCM/APNs, encrypted at rest
  signal_identity BYTEA NOT NULL,                -- public identity key
  registered_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_seen_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE sessions (
  id              UUID PRIMARY KEY,
  user_id         UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  device_id       UUID NOT NULL REFERENCES devices(id) ON DELETE CASCADE,
  token_hash      BYTEA UNIQUE NOT NULL,
  refresh_hash    BYTEA UNIQUE NOT NULL,
  expires_at      TIMESTAMPTZ NOT NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
```

### Signal pre-key bundles

```sql
CREATE TABLE signed_pre_keys (
  device_id    UUID REFERENCES devices(id) ON DELETE CASCADE,
  key_id       INT  NOT NULL,
  public_key   BYTEA NOT NULL,
  signature    BYTEA NOT NULL,
  rotated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (device_id, key_id)
);

CREATE TABLE one_time_pre_keys (
  device_id    UUID REFERENCES devices(id) ON DELETE CASCADE,
  key_id       INT  NOT NULL,
  public_key   BYTEA NOT NULL,
  consumed     BOOLEAN NOT NULL DEFAULT FALSE,
  PRIMARY KEY (device_id, key_id)
);
```

Clients top up one-time pre-keys in batches; the server warns when stock falls low.

### Messages

Server only stores **ciphertext envelopes pending delivery** — never plaintext, never long-term.

```sql
CREATE TABLE message_envelopes (
  id              UUID PRIMARY KEY,
  recipient_id    UUID NOT NULL REFERENCES devices(id) ON DELETE CASCADE,
  sender_id       UUID NOT NULL REFERENCES users(id),
  ciphertext      BYTEA NOT NULL,                -- Signal session ciphertext
  envelope_type   SMALLINT NOT NULL,             -- pre-key vs regular
  inserted_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at      TIMESTAMPTZ NOT NULL           -- short TTL, e.g. 30 days
);
CREATE INDEX ON message_envelopes (recipient_id, inserted_at);
```

When a recipient acks delivery, the envelope is deleted.

### Groups

```sql
CREATE TABLE groups (
  id              UUID PRIMARY KEY,
  name            TEXT NOT NULL,
  description     TEXT,
  avatar_uri      TEXT,
  owner_id        UUID NOT NULL REFERENCES users(id),
  history_mode    TEXT NOT NULL DEFAULT 'off',   -- off | view-only | full
  history_limit   INT,                            -- null = all
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE group_members (
  group_id        UUID REFERENCES groups(id) ON DELETE CASCADE,
  user_id         UUID REFERENCES users(id) ON DELETE CASCADE,
  role            TEXT NOT NULL DEFAULT 'member', -- owner | admin | member
  joined_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (group_id, user_id)
);
```

### Channels (public broadcast)

```sql
CREATE TABLE channels (
  id              UUID PRIMARY KEY,
  handle          TEXT UNIQUE NOT NULL,
  name            TEXT NOT NULL,
  bio             TEXT,
  avatar_uri      TEXT,
  owner_id        UUID NOT NULL REFERENCES users(id),
  verified        BOOLEAN NOT NULL DEFAULT FALSE,
  category        TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE channel_posts (
  id              UUID PRIMARY KEY,
  channel_id      UUID NOT NULL REFERENCES channels(id) ON DELETE CASCADE,
  body            TEXT,
  media_uri       TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE channel_comments (
  id              UUID PRIMARY KEY,
  post_id         UUID NOT NULL REFERENCES channel_posts(id) ON DELETE CASCADE,
  parent_id       UUID REFERENCES channel_comments(id) ON DELETE CASCADE,
  author_id       UUID REFERENCES users(id),
  anonymous       BOOLEAN NOT NULL DEFAULT FALSE,
  body            TEXT NOT NULL,
  pending         BOOLEAN NOT NULL DEFAULT TRUE,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
```

### Stories

```sql
CREATE TABLE stories (
  id              UUID PRIMARY KEY,
  owner_id        UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  media_uri       TEXT NOT NULL,
  visibility      TEXT NOT NULL,                 -- contacts | except | close | public
  expires_at      TIMESTAMPTZ NOT NULL,          -- 24h–72h
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
```

### Badges

```sql
CREATE TABLE badges (
  id              UUID PRIMARY KEY,
  code            TEXT UNIQUE NOT NULL,
  name            TEXT NOT NULL,
  icon            TEXT NOT NULL,
  criteria        JSONB NOT NULL
);

CREATE TABLE user_badges (
  user_id         UUID REFERENCES users(id) ON DELETE CASCADE,
  badge_id        UUID REFERENCES badges(id) ON DELETE CASCADE,
  granted_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (user_id, badge_id)
);
```



---

## Redis — server, ephemeral / hot-path

### Keys

| Key pattern              | Type     | TTL    | Purpose                                  |
|--------------------------|----------|--------|------------------------------------------|
| `session:{token_hash}`   | hash     | session lifetime | Auth token cache                |
| `presence:{user_id}`     | string   | 60 s   | Online / last-seen heartbeat             |
| `typing:{chat_id}`       | set      | 5 s    | Currently typing users                   |
| `rl:{ip}:{action}`       | counter  | window | Rate limit windows                       |

### Streams (queues)

| Stream                  | Producer            | Consumers              |
|-------------------------|---------------------|------------------------|
| `q:messages.deliver`    | Messages controller | Realtime workers       |
| `q:push.send`           | Notifications svc   | Push workers (FCM/APNs)|
| `q:media.process`       | Media controller    | Media workers          |

### Pub/sub

Real-time fan-out across API instances: `rt:user:{user_id}` channels carry serialised WS frames.

---

## SQLite — on the device, the source of truth for the user

The mobile app holds **the full chat history** in `db.sqlite` encrypted by SQLCipher with a key kept in the OS keychain. The server cannot reconstruct it.

Tables (abbreviated):

```sql
chats (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  avatar_uri TEXT,
  last_message_at INTEGER,
  unread_count INTEGER NOT NULL DEFAULT 0,
  pinned INTEGER NOT NULL DEFAULT 0,
);

messages (
  id TEXT PRIMARY KEY,
  chat_id TEXT NOT NULL REFERENCES chats(id) ON DELETE CASCADE,
  author_id TEXT,
  body TEXT,
  media_kind TEXT,                -- image | video | audio | document | location | contact | poll | event | game
  media_uri TEXT,
  status TEXT NOT NULL,           -- sent | delivered | read
  reply_to_id TEXT,
  created_at INTEGER NOT NULL
);

reactions (
  message_id TEXT NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
  emoji TEXT NOT NULL,
  count INTEGER NOT NULL,
  mine INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (message_id, emoji)
);

attachments (
  id TEXT PRIMARY KEY,
  message_id TEXT NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
  kind TEXT NOT NULL,
  data BLOB                       -- small payloads inline (location, contact, poll, event)
);

signal_sessions (peer_id TEXT, device_id TEXT, state BLOB, PRIMARY KEY (peer_id, device_id));
signal_identity (peer_id TEXT PRIMARY KEY, key BLOB, trust INTEGER);

drafts (chat_id TEXT PRIMARY KEY, body TEXT, reply_to_id TEXT, updated_at INTEGER);
sync_cursors (kind TEXT PRIMARY KEY, value TEXT);
```

Full schema and sync model in [local-storage.md](./local-storage.md).

---

## Migrations

- One SQL file per change, applied in order, in `server/migrations/`.
- Tooling: [golang-migrate](https://github.com/golang-migrate/migrate) at startup and in CI.
- Rolling, backwards-compatible migrations only. No destructive change without a deprecation window.
