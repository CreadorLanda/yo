# 📱 Armazenamento Local (SQLite + SQLCipher no dispositivo)

> As mensagens vivem no dispositivo do utilizador. O servidor é um relay de ciphertext, não um arquivo de conversas.

Esta é a abordagem WhatsApp aplicada ao ZwoSocial: a fonte da verdade para as conversas do utilizador é a **SQLite do dispositivo**, cifrada em repouso por SQLCipher e desbloqueada por uma chave guardada na keychain do sistema.

---

## Porquê no dispositivo

| Preocupação    | Resultado                                                    |
|----------------|--------------------------------------------------------------|
| Privacidade    | Servidor não lê mensagens mesmo se for comprometido          |
| Offline        | Caixa de entrada completa offline; envios em fila até reconectar |
| Performance    | Listas, pesquisa e reações correm local — sem round trips    |
| Custo          | Servidor só carrega envelopes pendentes                      |
| Soberania      | Utilizadores podem exportar / fazer backup; eliminação é real |

---

## Stack móvel

- **Base de dados**: SQLite via [`expo-sqlite`](https://docs.expo.dev/versions/latest/sdk/sqlite/).
- **Encriptação em repouso**: SQLCipher (plugin community / integração em build) — todo o ficheiro DB cifrado AES-256-CBC.
- **Gestão de chaves**: chave DB de 256 bits gerada aleatoriamente, embrulhada pela keychain do sistema:
  - iOS: item Keychain com `kSecAttrAccessibleWhenUnlockedThisDeviceOnly`.
  - Android: Keystore (StrongBox onde disponível), wrap AES-GCM.
- **Desbloqueio**: app só abre a DB depois de o SO devolver a chave. Porta biométrica opcional (`expo-local-authentication`) antes de desbloquear o item da keychain.
- **Backup**: opt-in, export cifrado para cloud do utilizador (iCloud / Drive) — ver *Backups* abaixo.

Desktop e web espelham com equivalentes da plataforma (Keychain no macOS, DPAPI no Windows, libsecret no Linux; WebCrypto + IndexedDB na web).

---

## Schema (mobile)

```sql
PRAGMA foreign_keys = ON;
PRAGMA journal_mode = WAL;

CREATE TABLE chats (
  id              TEXT PRIMARY KEY,           -- 's:<uuid>' ou 'wa:<jid>'
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
  author_id       TEXT,                       -- null para mensagens de sistema
  body            TEXT,
  media_kind      TEXT,                       -- image | video | audio | document | location | contact | poll | event | game
  media_uri       TEXT,
  media_meta      TEXT,                       -- JSON: opções de poll, campos de evento, etc.
  status          TEXT NOT NULL DEFAULT 'sent', -- sent | delivered | read | failed
  reply_to_id     TEXT,
  is_ai           INTEGER NOT NULL DEFAULT 0,  -- 1 para respostas da Dandara
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
  local_path      TEXT                        -- download em cache
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

-- Estado de sessão Signal, só no dispositivo.
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

-- Contabilidade de sync
CREATE TABLE sync_cursors (kind TEXT PRIMARY KEY, value TEXT, updated_at INTEGER);

-- Filtros (filtros personalizados criados pelo utilizador)
CREATE TABLE custom_filters (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  chat_ids TEXT NOT NULL                       -- JSON array
);
```

Migrações em `mobile/db/migrations/*.sql`, aplicadas no primeiro arranque e em cada upgrade.

---

## Modelo de sincronização

### Push (preferido)

Enquanto a app está conectada:

1. Servidor enfileira um envelope para um dispositivo.
2. Hub realtime empurra um frame WS com o envelope.
3. Cliente decifra (TweetNaCl), persiste em `messages`, ack.
4. Servidor remove o envelope (ou expira após TTL curto).

### Pull (reconexão / catch-up)

Na reconexão, o cliente chama `GET /messages/since?cursor=<last_known>` para drenar envelopes acumulados offline. O mesmo loop decifrar → persistir → ack, em batch.

### Envio

1. App escreve a mensagem em `messages` com `status='sent'` e `created_at=now` (otimista).
2. o cliente cifra para cada dispositivo destinatário; cliente `POST /messages` com os envelopes.
3. Servidor faz ack → cliente atualiza `status='delivered'` em recibos.
4. Em falha (rede, erro de decifrar), `status='failed'`; utilizador pode tentar novamente pela UI.

### Cursores

`sync_cursors` mantém posições por stream (`messages`, `channels:posts`, `stories`, …) para a reconexão ser barata e resumível.

---

## Backups (opt-in)

- Snapshot periódico completo da BD, cifrado com chave derivada de uma passphrase do utilizador (Argon2id) + salt por backup.
- Carregado para a cloud do utilizador (iCloud / Drive) — nunca para o servidor ZwoSocial.
- Restauro é um fluxo explícito que pede a passphrase, nunca automático.
- A chave DB da keychain **não** está incluída; backups carregam o seu próprio envelope.

---

## Orçamento de cache & limpeza

- Ficheiros de média são cacheados em `Library/Caches/yo/`. Utilizador pode limpar em Definições → Armazenamento.
- Linhas de texto nunca são apagadas automaticamente; só anexos são podados.
- Política opcional de retenção por chat (e.g. apagar após 30 dias) — varrimento periódico local.

---

## Modelo de ameaça

- Comprometimento do dispositivo com acesso total ao disco *desbloqueado*: mensagens são legíveis. Mitigação: PIN / biometria, auto-lock quando ecrã desliga.
- Comprometimento *bloqueado*: chave SQLCipher na keychain, gated pelo desbloqueio do dispositivo; mensagens ficam em ciphertext em repouso.
- Dispositivo perdido com backups desativados: mensagens perdem-se — sem recuperação no servidor, por design.
- Comprometimento de operador: servidor só tem envelopes pendentes e envelopes de média; não pode reconstruir conversas.
