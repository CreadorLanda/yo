# 💾 Database

> Onde cada peça de dados vive, e porquê.

O ZwoSocial divide os dados por três stores com garantias diferentes:

| Store        | Onde         | O que guarda                                          | Encriptação        |
|--------------|--------------|--------------------------------------------------------|--------------------|
| PostgreSQL   | Servidor     | Metadados autoritativos, conteúdo público, envelopes pendentes | Em repouso (disco/KMS) |
| Redis        | Servidor     | Filas, cache, presença, pub/sub                        | Em repouso (disco) |
| SQLite       | Dispositivo  | Histórico completo, drafts, cache de contactos         | SQLCipher (por utilizador) |

Sem MongoDB — o Postgres trata dos dados estruturados; conteúdo com forma flexível vai como JSONB.

---

## PostgreSQL — servidor, autoritativo

Convenção: `snake_case`, PK UUIDv7, `created_at` / `updated_at` em todas as tabelas.

### Identidade

```sql
CREATE TABLE users (
  id              UUID PRIMARY KEY,
  phone_hash      BYTEA UNIQUE NOT NULL,         -- hash do telefone, nunca em claro
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
  push_token_enc  BYTEA,                         -- FCM/APNs, cifrado em repouso
  signal_identity BYTEA NOT NULL,                -- chave pública de identidade
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

### Bundles de pre-keys (Signal)

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

Os clientes repõem one-time pre-keys em batches; o servidor avisa quando o stock baixa.

### Mensagens

O servidor só guarda **envelopes ciphertext pendentes de entrega** — nunca texto em claro, nunca a longo prazo.

```sql
CREATE TABLE message_envelopes (
  id              UUID PRIMARY KEY,
  recipient_id    UUID NOT NULL REFERENCES devices(id) ON DELETE CASCADE,
  sender_id       UUID NOT NULL REFERENCES users(id),
  ciphertext      BYTEA NOT NULL,                -- ciphertext da sessão Signal
  envelope_type   SMALLINT NOT NULL,             -- pre-key vs normal
  inserted_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at      TIMESTAMPTZ NOT NULL           -- TTL curto, e.g. 30 dias
);
CREATE INDEX ON message_envelopes (recipient_id, inserted_at);
```

Quando o destinatário faz ack, o envelope é apagado.

### Grupos

```sql
CREATE TABLE groups (
  id              UUID PRIMARY KEY,
  name            TEXT NOT NULL,
  description     TEXT,
  avatar_uri      TEXT,
  owner_id        UUID NOT NULL REFERENCES users(id),
  history_mode    TEXT NOT NULL DEFAULT 'off',   -- off | view-only | full
  history_limit   INT,                            -- null = todas
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

### Canais (broadcast público)

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

## Redis — servidor, efémero / hot-path

### Chaves

| Padrão de chave          | Tipo     | TTL    | Função                                   |
|--------------------------|----------|--------|------------------------------------------|
| `session:{token_hash}`   | hash     | sessão | Cache de token de autenticação           |
| `presence:{user_id}`     | string   | 60 s   | Online / heartbeat                       |
| `typing:{chat_id}`       | set      | 5 s    | Utilizadores a escrever                  |
| `rl:{ip}:{action}`       | counter  | janela | Rate limit                               |

### Streams (filas)

| Stream                  | Produtor              | Consumidores            |
|-------------------------|-----------------------|--------------------------|
| `q:messages.deliver`    | Controller messages   | Workers de tempo real    |
| `q:push.send`           | Notifications svc     | Workers de push (FCM/APNs) |
| `q:media.process`       | Controller media      | Workers de média         |

### Pub/sub

Fan-out de tempo real entre instâncias da API: canais `rt:user:{user_id}` transportam frames WS serializados.

---

## SQLite — no dispositivo, fonte da verdade para o utilizador

O cliente móvel mantém **todo o histórico** em `db.sqlite` cifrado por SQLCipher, com chave guardada na keychain do sistema. O servidor não pode reconstruir o histórico.

Tabelas (resumido):

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
  created_at INTEGER NOT NULL,
  encrypted_blob BLOB
);

reactions (message_id TEXT, emoji TEXT, count INTEGER, mine INTEGER DEFAULT 0, PRIMARY KEY (message_id, emoji));

attachments (
  id TEXT PRIMARY KEY,
  message_id TEXT NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
  kind TEXT NOT NULL,
  data BLOB                       -- payloads pequenos inline (location, contact, poll, event)
);

signal_sessions (peer_id TEXT, device_id TEXT, state BLOB, PRIMARY KEY (peer_id, device_id));
signal_identity (peer_id TEXT PRIMARY KEY, key BLOB, trust INTEGER);

drafts (chat_id TEXT PRIMARY KEY, body TEXT, reply_to_id TEXT, updated_at INTEGER);
sync_cursors (kind TEXT PRIMARY KEY, value TEXT);
```

Schema completo e modelo de sincronização em [local-storage.md](./local-storage.md).

---

## Migrações

- Um ficheiro SQL por mudança, aplicado por ordem, em `server/migrations/`.
- Ferramenta: [golang-migrate](https://github.com/golang-migrate/migrate) no arranque e em CI.
- Apenas migrações rolling, retrocompatíveis. Nenhuma mudança destrutiva sem janela de deprecação.
