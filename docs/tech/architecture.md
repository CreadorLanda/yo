# 🏗️ Architecture

> How ZwoSocial is shaped: a security-first messaging platform with an on-device store and a thin server.

---

## Goals

1. **End-to-end encryption by default.** The server must not be able to read user content.
2. **Messages live on the device.** The server is a relay for ciphertext envelopes and authoritative metadata.
4. **Modular monolith** in Go organised as MVC modules — easy to split later, fast to build now.
5. **Operational simplicity.** PostgreSQL + Redis only. No MongoDB.

---

## High-level shape

```
   Mobile / Web client
   ├─ SQLite (SQLCipher, encrypted)   ← full chat history, on device
   └─ TweetNaCl                       ← E2E sessions
            │
            │  HTTPS / WSS (TLS 1.3, certificate pinning)
            ▼
┌─────────────────────────────────────────────────────────────┐
│                    ZwoSocial API (Go)                       │
│  ┌────────────┐  ┌────────────┐  ┌────────────────────────┐ │
│  │ Controllers│→ │ Services   │→ │ Repositories           │ │
│  │ (HTTP/WS)  │  │ (logic)    │  │ (pgx → Postgres)       │ │
│  └────────────┘  └────────────┘  └────────────────────────┘ │
│         │                                                   │
│         ▼                                                   │
│   Realtime hub (WebSocket) ── Redis pub/sub fan-out         │
└──────┬──────────────────────────────────────────────────────┘
       │                  │                    │
       ▼                  ▼                    ▼
   PostgreSQL          Redis              Object Storage
   (authoritative)     (queues, cache,    (encrypted media
                        presence, pub/sub) blobs)
```

---

## Components

### Mobile client
- Holds the full chat history in **SQLite (SQLCipher)**.
- Uses **TweetNaCl (X25519)** in a construction written for this project; group chats use a per-epoch sender key. This is **not** the Signal Protocol and has no Double Ratchet — see [security/encryption](../security/encryption.md).
- Talks to the API over HTTPS for request/response and WSS for real-time.
- Stores the database key in the **OS keychain** (iOS Keychain / Android Keystore); optional biometric unlock on launch.

### API server (Go, modular monolith)
- One process, organised as MVC modules per feature (`auth`, `users`, `messages`, `groups`, `channels`, `stories`, `media`, `badges`, `notifications`, `ai`).
- HTTP via Gin/Echo, real-time via a WebSocket hub with Redis pub/sub fan-out (so the server can scale horizontally).
- Authoritative for **metadata** (users, devices, groups, channels, public stories, badges, push tokens, key bundles) — not for message content.

### PostgreSQL
- Users, devices, key bundles (identity / signed pre-keys / one-time pre-keys), group membership, channel content, public stories, badges, audit logs.
- Holds **only ciphertext** for pending message envelopes (deleted after delivery).

### Redis
- **Queues** (Redis Streams): message delivery, push notifications, media processing.
- **Cache**: session tokens, rate limit counters.
- **Presence**: `presence:{user_id}` with short TTL.
- **Typing**: `typing:{chat_id}` (TTL 5 s).
- **Pub/sub**: cross-instance real-time fan-out.

### Object storage (S3-compatible)
- Encrypted media (images, video, voice, documents).
- Per-file Data Encryption Key (DEK) wrapped by a Key Encryption Key (KEK) in KMS/Vault.
- Server cannot read media in plaintext.

---

## Request lifecycle (text message, native chat)

1. Client A composes a message, encrypts to each recipient device with TweetNaCl, produces N ciphertext envelopes.
2. Client A `POST /messages` with the envelopes + addressing metadata.
3. Controller validates auth → Service persists envelopes in Postgres → enqueues delivery on `q:messages.deliver`.
4. Workers fan envelopes out: push WS frames to online recipients via Redis pub/sub, schedule push notifications for offline ones.
5. Client B receives the envelope over WS, decrypts with TweetNaCl, persists to its local SQLite, acks.
6. Server deletes the envelope (or expires it after a short TTL if no ack).

The server never sees plaintext.

---

## Why a modular monolith (and not microservices yet)

The earlier draft of this document showed five services. We start with **one** Go binary for these reasons:

- The whole team / contributors can run one process locally.
- Cross-module transactions (signing up a user, granting a badge, etc.) stay simple.
- Real-time fan-out is easier within one address space.
- We get the *organisational* benefits of services (clear module boundaries, MVC layering) without the operational cost of many deployments, service meshes, and distributed tracing.
- Splitting is a refactor, not a rewrite, because each module owns its package and its tables. When a module needs to scale independently, we extract it.

---

## Branch strategy

- `backend/base` — base branch (scaffold, docs, shared platform code).
- `backend/<feature>` — one branch per backend issue (see [services-and-branches.md](./services-and-branches.md)).
- PRs go into `backend/base`; `backend/base` merges into `main` when the backend MVP is stable.

---

## Related documents

- [Database](./database.md) — Postgres + Redis schema, on-device SQLite.
- [Backend (Go, MVC)](./backend-go.md) — code layout and conventions.
- [Local storage](./local-storage.md) — on-device SQLite + SQLCipher.
- [Services & branches](./services-and-branches.md) — feature → branch → issue map.
- [Encryption](../security/encryption.md) — Signal Protocol, at-rest, in-transit.
