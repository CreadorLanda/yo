# Socialize — Server

> Go API. One binary, MVC modules, Postgres + Redis.

This is the **basic scaffold** on the `backend/dev` integration branch — enough to compile, boot, talk to Postgres + Redis, and answer `GET /api/healthz`. The auth module wires the canonical happy-path.

Full design notes:
- [docs/tech/architecture.md](../docs/tech/architecture.md)
- [docs/tech/backend-go.md](../docs/tech/backend-go.md)
- [docs/tech/database.md](../docs/tech/database.md)
- [docs/security/encryption.md](../docs/security/encryption.md)
- [docs/tech/services-and-branches.md](../docs/tech/services-and-branches.md)

---

## Layout

```
server/
├── cmd/api/                       # entry point
├── internal/
│   ├── config/                    # env → typed config
│   ├── middleware/                # request-id, recovery
│   ├── platform/{postgres,redis}/ # connection lifecycle
│   ├── server/                    # bootstrap: wires modules
│   └── modules/                   # MVC, one folder per feature
│       ├── health/
│       ├── auth/                  # phone OTP + JWT skeleton
├── migrations/                    # *.sql, golang-migrate
├── deploy/docker/                 # docker-compose + Dockerfile
├── .env.example
├── Makefile
└── README.md
```

Each `internal/modules/<name>/` keeps `model.go` (entities), `repository.go` (SQL), `service.go` (business logic), `controller.go` (HTTP handlers) and `routes.go` (registration). Modules never import each other's `service`/`repository` — see [docs/tech/backend-go.md](../docs/tech/backend-go.md).

---

## Quick start

```bash
cd server
cp .env.example .env

# 1) Postgres + Redis locally
make docker-up

# 2) (Optional) install golang-migrate, then run schema migrations
make migrate-up

# 3) Run the API
make dev
```

Smoke test:

```bash
curl -s localhost:8080/api/healthz   # → {"status":"ok"}
curl -s localhost:8080/api/readyz    # → 200 when both pg + redis are up

# Auth (dev — the OTP comes back in the response, no SMS):
curl -s -X POST localhost:8080/api/auth/start \
  -H 'Content-Type: application/json' \
  -d '{"phone":"+351912345678"}'
# → {"sent":true,"dev_code":"482915"}

curl -s -X POST localhost:8080/api/auth/verify \
  -H 'Content-Type: application/json' \
  -d '{"phone":"+351912345678","code":"482915","device":"dev-iPhone","platform":"ios"}'
# → { "user": { ... }, "tokens": { ... } }
```

---

## Implemented vs skeleton

| Route                                    | Auth     | State                              |
|------------------------------------------|----------|------------------------------------|
| `GET  /api/healthz`                      | public   | ✅                                  |
| `GET  /api/readyz`                       | public   | ✅ (pings pg + redis)               |
| `POST /api/auth/start`                   | public   | ✅ OTP via Redis (5 min TTL)        |
| `POST /api/auth/verify`                  | public   | ✅ creates user + issues JWT pair   |
| `POST /api/auth/refresh`                 | public   | ✅ family rotation + replay detection |
| `POST /api/auth/logout`                  | public   | ✅ revokes the refresh-token family |
| `GET  /api/users/me`                     | required | ✅                                  |
| `PATCH /api/users/me`                    | required | ✅ partial updates (username, name, bio, avatar, privacy) |
| `GET  /api/users/availability?username=` | required | ✅ validates + checks uniqueness    |
| `GET  /api/users/by-username/:username`  | required | ✅ honours username_public          |
| `PUT  /api/users/me/keys`                | required | ✅ identity + signed + OTK upload   |
| `GET  /api/users/me/keys/count`          | required | ✅ OTK reservoir gauge              |
| `GET  /api/users/by-username/:username/keys` | required | ✅ X3DH bundle, consumes one OTK |
| `POST   /api/chats`                      | required | ✅ create direct (pending) chat     |
| `GET    /api/chats`                      | required | ✅ list chats + unread              |
| `POST   /api/chats/:id/messages`         | required | ✅ send (+ WS `message.new`)        |
| `GET    /api/chats/:id/messages`         | required | ✅ cursor pagination                |
| `PATCH  /api/chats/:id/messages/:mid`    | required | ✅ edit (sender)                    |
| `DELETE /api/chats/:id/messages/:mid`    | required | ✅ soft-delete (sender)             |
| `POST   /api/chats/:id/receipts`         | required | ✅ delivered/read batch             |
| `POST   /api/chats/:id/read`             | required | ✅ mark read cursor                 |
| `POST   /api/chats/:id/typing`           | required | ✅ typing indicator (WS)            |
| `POST   /api/chats/:id/messages/:mid/reactions` | required | ✅ add reaction               |
| `DELETE /api/chats/:id/messages/:mid/reactions?emoji=` | required | ✅ remove reaction |
| `POST   /api/chats/:id/messages/:mid/star` | required | ✅ star for current participant |
| `DELETE /api/chats/:id/messages/:mid/star` | required | ✅ remove participant's star |
| `GET    /api/ws?token=`                  | token    | ✅ WebSocket realtime hub           |
| `POST   /api/media/upload`               | required | ✅ multipart file upload            |
| `GET    /api/media/:id`                  | required | ✅ media metadata                   |
| `GET    /api/media/:id/file`             | public*  | ✅ stream bytes (*UUID-gated)      |
| `DELETE /api/media/:id`                  | required | ✅ owner delete                     |
| `POST   /api/groups`                     | required | ✅ create group chat                |
| `GET    /api/groups`                     | required | ✅ list my groups                   |
| `GET    /api/groups/:id`                 | required | ✅ group + members                  |
| `PATCH  /api/groups/:id`                 | required | ✅ admin settings                   |
| `POST   /api/groups/:id/members`         | required | ✅ add members                      |
| `DELETE /api/groups/:id/members/:userId` | required | ✅ remove / kick                    |
| `PATCH  /api/groups/:id/members/:userId` | required | ✅ set role                         |
| `POST   /api/groups/:id/leave`           | required | ✅ leave group                      |
| `PUT    /api/notifications/devices`      | required | ✅ register push token              |
| `DELETE /api/notifications/devices`      | required | ✅ unregister device                |
| `GET    /api/notifications/prefs`        | required | ✅ notification toggles             |
| `PATCH  /api/notifications/prefs`        | required | ✅ update toggles                   |
| `POST   /api/notifications/test`         | required | ✅ enqueue smoke push               |
| push worker (`q:push.send`)              | internal | ✅ Expo + FCM HTTP v1 + webhook     |
| `POST   /api/stories`                    | required | ✅ create story (TTL 24h)           |
| `GET    /api/stories`                    | required | ✅ feed                             |
| `GET    /api/stories/:id`                | required | ✅ one story                        |
| `POST   /api/stories/:id/view`           | required | ✅ mark viewed                      |
| `POST   /api/stories/:id/react`          | required | ✅ react                            |
| `DELETE /api/stories/:id`                | required | ✅ delete own                       |
| `POST   /api/channels`                   | required | ✅ create channel                   |
| `GET    /api/channels`                   | required | ✅ discover list                    |
| `GET    /api/channels/:id`               | required | ✅ detail + posts                   |
| `POST   /api/channels/:id/follow`        | required | ✅ follow/join                      |
| `DELETE /api/channels/:id/follow`        | required | ✅ unfollow                         |
| `POST   /api/channels/:id/posts`         | required | ✅ publish post                     |
| `POST   /api/channel-posts/:id/react`    | required | ✅ react to post                    |
| `POST   /api/channel-posts/:id/comments` | required | ✅ comment                          |

Token shape: HS256 JWT with `sub` (user id), `dev` (device id), `typ`
(`access` or `refresh`), `iat`, `exp`. Verify with `cfg.JWT.Secret`.

The skeletons exist so the route surface is real and the mobile client can be wired against them while the implementations are written on their dedicated branches.

---

## Conventions, briefly

- **No ORM.** `pgx` + hand-rolled SQL in `repository.go`.
- **Errors are values.** Wrap with `fmt.Errorf("...: %w", err)`. Public errors are sentinels in the module (`ErrInvalidCode`…) translated to HTTP by the controller.
- **Context first.** Every service / repo method takes `context.Context` first.
- **Time in UTC, RFC 3339 in JSON.**
- **JSON in `snake_case`, Go in `CamelCase`.**

See [docs/tech/backend-go.md](../docs/tech/backend-go.md) for the long version.
