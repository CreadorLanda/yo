# 📡 API Specifications

> Complete REST API documentation for ZwoSocial.

---

## Base URL

```
Production: https://yo.alexandrelanda.com
Development: http://localhost:3000
```

## Authentication

### JWT Tokens

```http
Authorization: Bearer <jwt_token>
```

### Token Response

```json
{
  "token": "eyJhbGciOiJIUzI1NiIs...",
  "refresh_token": "eyJhbGciOiJIUzI1NiIs...",
  "expires_in": 3600
}
```

---

## Endpoints

### 1. Authentication

#### POST /auth/register

Register a new user.

```http
POST /api/auth/register
Content-Type: application/json
```

**Request:**

```json
{
  "phone": "+5511999999999",
  "password": "securePassword123",
  "display_name": "John Doe",
  "device_id": "device_abc123"
}
```

**Response (201):**

```json
{
  "user": {
    "id": "uuid",
    "phone": "+5511999999999",
    "display_name": "John Doe",
    "username": null,
    "username_discoverable": null,
    "created_at": "2026-05-14T12:00:00Z"
  },
  "token": "eyJhbGci...",
  "refresh_token": "eyJhbGci..."
}
```

**Username (Optional):**

```json
{
  "phone": "+5511999999999",
  "password": "securePassword123",
  "display_name": "John Doe",
  "username": "johndoe",
  "username_discoverable": true
}
```

---

#### POST /auth/login

Login with phone and password.

```http
POST /api/auth/login
Content-Type: application/json
```

**Request:**

```json
{
  "phone": "+5511999999999",
  "password": "securePassword123",
  "device_id": "device_abc123"
}
```

**Response (200):**

```json
{
  "user": {
    "id": "uuid",
    "phone": "+5511999999999",
    "display_name": "John Doe"
  },
  "token": "eyJhbGci...",
  "refresh_token": "eyJhbGci..."
}
```

---

#### POST /auth/refresh

Refresh access token.

```http
POST /api/auth/refresh
Content-Type: application/json
```

**Request:**

```json
{
  "refresh_token": "eyJhbGci..."
}
```

**Response (200):**

```json
{
  "token": "eyJhbGci...",
  "refresh_token": "eyJhbGci...",
  "expires_in": 3600
}
```

---

### 2. Users

#### GET /users/me

Get current user profile.

```http
GET /api/users/me
Authorization: Bearer <token>
```

**Response (200):**

```json
{
  "id": "uuid",
  "phone": "+5511999999999",
  "email": "john@example.com",
  "username": "johndoe",
  "username_discoverable": true,
  "display_name": "John Doe",
  "avatar_url": "https://cdn.yo.alexandrelanda.com/avatars/abc.jpg",
  "bio": "Hello! 👋",
  "status": "online",
  "last_seen_at": "2026-05-14T12:00:00Z"
}
```

---

#### PUT /users/me

Update current user profile.

```http
PUT /api/users/me
Authorization: Bearer <token>
Content-Type: application/json
```

**Request:**

```json
{
  "display_name": "John Doe",
  "bio": "Software developer",
  "avatar_url": "https://cdn.yo.alexandrelanda.com/avatars/new.jpg"
}
```

**Response (200):**

```json
{
  "id": "uuid",
  "display_name": "John Doe",
  "bio": "Software developer",
  "avatar_url": "https://cdn.yo.alexandrelanda.com/avatars/new.jpg"
}
```

---

#### PUT /users/me/username

Update username settings.

```http
PUT /api/users/me/username
Authorization: Bearer <token>
Content-Type: application/json
```

**Request:**

```json
{
  "username": "johndoe",
  "username_discoverable": true
}
```

**Response (200):**

```json
{
  "username": "johndoe",
  "username_discoverable": true
}
```

---

#### GET /users/search

Search users by username or display name.

```http
GET /api/users/search?q=john&limit=20
Authorization: Bearer <token>
```

**Query Parameters:**

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `q` | string | required | Search query |
| `limit` | int | 20 | Max results |
| `offset` | int | 0 | Pagination offset |

**Response (200):**

```json
{
  "users": [
    {
      "id": "uuid",
      "username": "johndoe",
      "display_name": "John Doe",
      "avatar_url": "https://cdn.yo.alexandrelanda.com/avatars/abc.jpg",
      "username_discoverable": true
    },
    {
      "id": "uuid2",
      "username": "johnsmith",
      "display_name": "John Smith",
      "username_discoverable": true
    }
  ],
  "total": 2
}
```

---

### 3. Chats

#### POST /chats

Create a new chat (direct or group).

```http
POST /api/chats
Authorization: Bearer <token>
Content-Type: application/json
```

**Direct Chat:**

```json
{
  "type": "direct",
  "participants": ["user_uuid_2"]
}
```

**Group:**

```json
{
  "type": "group",
  "name": "Family Group",
  "description": "Family chat",
  "participants": ["user_uuid_2", "user_uuid_3"],
  "avatar_url": "https://cdn.yo.alexandrelanda.com/groups/family.jpg"
}
```

**Response (201):**

```json
{
  "id": "chat_uuid",
  "type": "group",
  "name": "Family Group",
  "participants": ["user_uuid_1", "user_uuid_2", "user_uuid_3"],
  "created_at": "2026-05-14T12:00:00Z"
}
```

---

#### GET /chats

List chats for current user.

```http
GET /api/chats?limit=20&offset=0
Authorization: Bearer <token>
```

**Response (200):**

```json
{
  "chats": [
    {
      "id": "chat_uuid",
      "type": "direct",
      "participants": [...],
      "last_message": {
        "content": "Hello!",
        "created_at": "2026-05-14T12:00:00Z"
      }
    }
  ],
  "total": 15
}
```

---

#### GET /chats/:id

Get chat details.

```http
GET /api/chats/chat_uuid
Authorization: Bearer <token>
```

---

### 4. Messages

#### POST /chats/:id/messages

Send a message to a chat.

```http
POST /api/chats/chat_uuid/messages
Authorization: Bearer <token>
Content-Type: application/json
```

**Text Message:**

```json
{
  "content": "Hello! 👋",
  "content_type": "text"
}
```

**Image Message:**

```json
{
  "content": "https://cdn.yo.alexandrelanda.com/media/abc.jpg",
  "content_type": "image",
  "thumbnail": "https://cdn.yo.alexandrelanda.com/thumbs/abc.jpg"
}
```

**Response (201):**

```json
{
  "id": "message_uuid",
  "chat_id": "chat_uuid",
  "sender_id": "user_uuid",
  "content": "Hello! 👋",
  "content_type": "text",
  "created_at": "2026-05-14T12:00:00Z"
}
```

---

#### GET /chats/:id/messages

Get messages from a chat.

```http
GET /api/chats/chat_uuid/messages?limit=50&before=message_uuid
Authorization: Bearer <token>
```

**Query Parameters:**

| Parameter | Type | Description |
|-----------|------|-------------|
| `limit` | int | Max messages (default: 50) |
| `before` | string | Cursor for pagination |
| `after` | string | Get messages after cursor |

**Response (200):**

```json
{
  "messages": [
    {
      "id": "message_uuid",
      "chat_id": "chat_uuid",
      "sender_id": "user_uuid",
      "content": "Hello!",
      "content_type": "text",
      "created_at": "2026-05-14T12:00:00Z",
      "read_at": "2026-05-14T12:01:00Z"
    }
  ],
  "pagination": {
    "next": "message_cursor",
    "has_more": true
  }
}
```

---

#### DELETE /chats/:id/messages/:message_id

Delete a message.

```http
DELETE /api/chats/chat_uuid/messages/message_uuid
Authorization: Bearer <token>
Content-Type: application/json
```

**Request:**

```json
{
  "delete_for": "everyone"
}
```

---

#### POST /chats/:id/messages/:message_id/reactions

Add reaction to a message.

```http
POST /api/chats/chat_uuid/messages/message_uuid/reactions
Authorization: Bearer <token>
Content-Type: application/json
```

```json
{
  "reaction": "❤️"
}
```

#### POST /chats/:id/messages/:message_id/star

Star a message for the authenticated participant. This operation is
idempotent and returns `204 No Content`.

#### DELETE /chats/:id/messages/:message_id/star

Remove the authenticated participant's star from a message. This operation
is idempotent and returns `204 No Content`. Message history includes
`is_starred` for the requesting participant.

---

### 5. WebSocket (Real-time)

#### Connect

```javascript
// WebSocket URL
const ws = new WebSocket('wss://yo.alexandrelanda.com/ws?token=YOUR_TOKEN');
```

#### Events

**Incoming:**

| Event | Payload |
|-------|---------|
| `message.new` | `{chat_id, message}` |
| `message.update` | `{message_id, content}` |
| `message.delete` | `{message_id}` |
| `typing.start` | `{chat_id, user_id}` |
| `typing.stop` | `{chat_id, user_id}` |
| `chat.read` | `{chat_id, user_id}` |

**Outgoing:**

```javascript
// Send typing indicator
ws.send(JSON.stringify({
  type: 'typing.start',
  chat_id: 'chat_uuid'
}));

// Send read receipt
ws.send(JSON.stringify({
  type: 'chat.read',
  chat_id: 'chat_uuid'
}));
```

---

### 6. Posts and reels

Permanent posts on a profile. A `post` is a carousel of 1 to 10 photos or
videos; a `reel` is exactly one video. Media is uploaded first with
`POST /media/upload`, and the post refers to it by id.

#### POST /posts

```json
{
  "kind": "post",
  "caption": "Sunday",
  "visibility": "contacts",
  "media_ids": ["<media id>", "<media id>"]
}
```

`kind` is `post` or `reel`. `visibility` is `contacts` (default: people the
author has an active direct chat with) or `public`. `caption` is at most 2200
characters. `media_ids` are in slide order and must be image or video objects
the caller uploaded.

Returns `201` with the post:

```json
{
  "id": "…",
  "author_id": "…",
  "author_name": "Ana",
  "author_username": "ana",
  "kind": "post",
  "caption": "Sunday",
  "visibility": "contacts",
  "media": [
    { "id": "…", "kind": "image", "url": "/api/media/…/file", "width": 1080, "height": 1350 },
    { "id": "…", "kind": "video", "url": "/api/media/…/file", "duration_ms": 8200 }
  ],
  "is_own": true,
  "created_at": "2026-11-11T20:00:00Z"
}
```

Publishing takes the media off the upload deadline, so it is kept for as long
as a post shows it. Deleting the last post that shows it releases it again.

| Error | Status | Meaning |
|-------|--------|---------|
| `invalid_kind`, `invalid_visibility` | 400 | Unknown value |
| `media_required`, `too_many_media`, `duplicate_media` | 400 | 1 to 10 distinct ids |
| `reel_needs_one_video` | 400 | A reel is exactly one video |
| `unsupported_media_type` | 400 | Not an image or a video |
| `caption_too_long` | 400 | Over 2200 characters |
| `media_not_owned` | 403 | An id the caller did not upload, or already expired |

#### GET /posts?author=&kind=&before=&limit=

One page of one author's grid, newest first. `author` is a user id or `me`
(the default). `kind` narrows to `post` or `reel`. `before` is the
`created_at` of the last post already shown. `limit` defaults to 30, at most
60. Posts the caller may not see are left out; a block in either direction
hides all of them.

#### GET /posts/:id

One post. `404 post_not_found` when it does not exist or the caller may not
see it.

#### DELETE /posts/:id

Author only; `204`. Anyone else gets `404`.

---

### 7. Bots

How bots fit end-to-end encryption is decided in [ADR 0002](../decisions/0002-bots-and-e2ee.md): a bot is a participant with its own device keys, and the server never decrypts for it. Everything a bot sends is a `soc1.`/`soc1g.` envelope, exactly like a person's client; plaintext is refused with `400`.

#### Managing bots (user session)

| Method | Path | Notes |
|---|---|---|
| `POST` | `/bots` | `{username, display_name, description?}`. `username` is 4–32 of `a-z0-9_` and must end in `bot`. Returns `201 {bot, token}` — `token.token` is the secret, shown this once. Max 20 bots per owner. |
| `GET` | `/bots` | Your bots. |
| `GET` | `/bots/:idOrUsername` | A bot's public profile. |
| `PATCH` | `/bots/:id` | Owner only: `display_name`, `description`, `avatar_url`, `privacy_mode`. Someone else's bot is `404`. |
| `DELETE` | `/bots/:id` | Owner only. Removes the bot's account, memberships and keys. |
| `GET` | `/bots/:id/tokens` | Live tokens (prefix and last use, never the secret). |
| `POST` | `/bots/:id/tokens` | Rotate: a new secret, every previous one revoked. `201`. |
| `DELETE` | `/bots/:id/tokens` | Revoke all; the bot stops until a new token is rotated in. |
| `POST` | `/bots/:id/dm` | Open your direct chat with the bot (`201` new, `200` existing) → `{chat_id}`. Active at once, no request. |

#### Bots in a chat (user session)

| Method | Path | Notes |
|---|---|---|
| `GET` | `/chats/:id/bots` | Any member: installed bots and their scopes. |
| `POST` | `/chats/:id/bots` | Group admin only: `{bot_id | username, scopes?}`. Adds the bot as a member and posts a `bot:added:<actor>:<bot>` system message. |
| `PATCH` | `/chats/:id/bots/:botId` | Group admin only: `{scopes}`. Turning `messages.read.all` on or off posts `bot:read_all:<actor>:<bot>:on|off`. |
| `DELETE` | `/chats/:id/bots/:botId` | Group admin only. Posts `bot:removed:<actor>:<bot>`. |
| `POST` | `/chats/:id/bots/:botId/updates` | Any member: `{kind: command\|mention\|reply\|interaction, content, message_id?}`. `content` is a pairwise `soc1.` envelope encrypted to the bot. The bot must be installed with `messages.read.commands`; a full-read bot is not sent copies (`403`). |

**Privacy mode, enforced by the server.** Group sender keys addressed to a bot without `messages.read.all` are dropped on upload, so such a bot can never open ordinary group messages. Granting full read (on install or later), revoking it, or removing a full-read bot advances the group's key epoch: the bot gets keys only from the next epoch, never history, and stops being able to read after it leaves.

**Telling bots apart.** Group members carry `is_bot`, a direct chat with a bot carries `peer_is_bot`, and a bot's messages carry `sender_is_bot`, so clients badge a bot wherever its name appears. Adding, removing and granting or revoking full read leave `bot:added|removed|read_all:<actor>:<bot>[:on|off]` system messages that clients render in the reader's language.

Scopes: `messages.read.commands` (privacy mode — commands, mentions, replies and interactions only), `messages.read.all` (everything, admin-granted and announced), `messages.send`, `members.read`, `members.manage`, `events.manage`. With none given, a bot gets `messages.read.commands`, `messages.send` and `members.read`.

#### Bot API (`/api/bot/v1`, bot token)

Authenticate with `Authorization: Bot zsb_…`. Routes under `/chats/:id` answer `404 chat_not_found` when the bot is not installed there and `403 scope_missing` when the installation lacks the scope.

| Method | Path | Scope |
|---|---|---|
| `GET` | `/me` | — |
| `GET` | `/updates?offset=&limit=` | — Envelopes addressed to the bot, oldest first (max 100). Asking with `offset` confirms and deletes everything before it. Uncollected updates expire after 7 days. |
| `PUT` | `/keys`, `GET /keys/count` | — (publish and top up the bot device's keys) |
| `GET` | `/users/by-username/:username/keys` and `/identity` | — |
| `POST` | `/media/upload` | — |
| `GET` | `/chats/:id` | installed (or the bot's own direct chat) — `{id, type}`, `type` is `direct` or `group` |
| `GET` | `/chats/:id/members` | `members.read` |
| `POST` | `/chats/:id/messages` | `messages.send` |
| `PATCH`, `DELETE` | `/chats/:id/messages/:mid` | `messages.send` (own messages only) |
| `POST`, `DELETE` | `/chats/:id/messages/:mid/reactions` | `messages.send` |
| `GET` | `/chats/:id/messages` | `messages.read.all` |
| `POST` | `/groups/:id/sender-keys` | `messages.send` (distribute the bot's own key to send into the group) |
| `GET` | `/groups/:id/sender-keys` | installed (only keys addressed to the bot — none unless it has full read) |

Limits: 600 requests per minute per bot, 30 writes per minute per bot per chat. Over a limit: `429 {error: "rate_limited", retry_after}` and a `Retry-After` header. Bots cannot open chats with people, join calls, or be added to anonymous conversations.

SDKs that do all of this for you: [bots-sdk.md](bots-sdk.md).

#### Slash commands

A bot registers what it answers to; typing `/` in a chat lists the commands of the bots there.

| Method | Path | Notes |
|---|---|---|
| `PUT` | `/api/bot/v1/commands` | Bot token. `{commands: [...]}` replaces the bot's global set (max 100). |
| `PUT` | `/api/bot/v1/chats/:id/commands` | Bot token, installed in the chat. A chat's own set; a command there replaces the global one of the same name. |
| `GET` | `/api/bot/v1/commands`, `/api/bot/v1/chats/:id/commands` | The bot's sets. |
| `GET` | `/chats/:id/commands` | Any member: the commands of the bots in the chat that listen for commands (every bot in a direct chat with it), each with `bot {id, username, display_name, avatar_url}`. |
| `POST` | `/chats/:id/bots/:botId/autocomplete` | Any member: `{command, option, content}` where `content` is the typed value as a `soc1.` envelope for the bot. The bot gets a `command.autocomplete` event and answers within 3 s. `{choices}`, `504 autocomplete_timeout` otherwise. |
| `POST` | `/api/bot/v1/autocomplete/:request_id` | Bot token: `{choices: [{name, value}]}` (max 25). |

A command: `{name, description, description_pt?, options: [{name, description, description_pt?, type, required?, choices?, autocomplete?}]}`. `name` is 1–32 of `a-z0-9_-`; descriptions up to 100 characters; up to 10 options, required ones first; `type` is `string`, `number`, `user`, `datetime` (RFC 3339) or `choice` (1–25 `{name, value}`); `autocomplete` only on `string` and `number`. Invalid sets are refused whole (`400 invalid_command` with a `detail`).

People invoke a command as text — `/remind when:2026-11-26T09:00:00Z what:"drink water"`, with `@bot` when two bots share the name — so the group sees it. In privacy mode the bot's copy (`command.invoked`) carries `command {name, options}` already parsed. The registry and autocomplete answers are visible to the server; what a person types is not.

#### Safety

| Method | Path | Notes |
|---|---|---|
| `GET` | `/chats/:id/bots/audit` | Group admins: the last 100 bot events in the group — `{action, actor_id, actor_name, bot_id, bot_name, detail, created_at}`. |
| `POST` | `/bots/:id/reactivate` | Owner: lift an automatic (`rate_limit`) suspension. Others are `403 suspended_by_operators`. |
| `POST` | `/bots/:id/forget-me` | Anyone sharing a chat with the bot: it gets `user.data_deletion`. `202`. |

A suspended bot gets `403 bot_suspended`; `BOTS_DISABLED=true` makes the Bot API answer `503 bots_disabled`. Bots carry `suspended` and `suspended_reason`. Details and the rules for bot developers: [Bots: abuse, limits and data](../security/bots.md).

#### Interactive messages

A bot's card, buttons, menus and forms travel inside its end-to-end encrypted message — the server cannot see or check them, so the app does. The plaintext body is:

```json
{"zi1": {"text": "Lunch?", "card": {"title": "…", "description": "…", "color": "success",
  "fields": [{"name": "When", "value": "13:00", "inline": true}], "thumbnail": "data:image/jpeg;base64,…", "footer": "…"},
  "components": [[{"type": "button", "id": "yes", "label": "Yes", "style": "primary"},
                  {"type": "button", "label": "Menu", "style": "link", "url": "https://…"}],
                 [{"type": "select", "id": "where", "options": [{"label": "Sushi", "value": "sushi"}], "max": 1}],
                 [{"type": "user_select", "id": "who", "max": 1}],
                 [{"type": "form", "id": "rsvp", "title": "RSVP", "submit_label": "Send",
                   "fields": [{"id": "name", "label": "Name", "type": "text", "required": true}]}]],
  "expires_at": "2026-12-01T00:00:00Z"}}
```

Button styles: `primary`, `secondary`, `danger`, `link` (https only, opened under the chat's link rules). Card colours are theme tokens: `primary`, `success`, `warning`, `danger`, `info`. Form fields: `text`, `number`, `date`, `choice`. Limits: 5 rows, 5 buttons a row (a menu or form takes a row alone), 25 options, 5 form fields, 10 card fields, labels 80 characters, ids `[A-Za-z0-9_:.-]{1,64}` and unique. Anything else is dropped; text is plain, never HTML or markdown. Past `expires_at`, or with `disabled: true`, components show disabled — a bot disables them by editing its message.

A click is an `interaction` update (`POST /chats/:id/bots/:botId/updates`, also in a direct chat with the bot) whose envelope carries `{v: 1, kind: "interaction", message_id, component_id, values?}` — `values` is the picked options or user ids, or a form's `{field: value}`. The bot gets it as `interaction.created`.

| Method | Path | Notes |
|---|---|---|
| `POST` | `/api/bot/v1/chats/:id/ephemeral` | Bot token: `{user_id, content}` — a `soc1.` envelope for that member, pushed live as `bot.ephemeral` and never stored. Installed with `messages.send`, or the bot's direct chat. `202`; `404 not_chat_member`. |

#### Events: gateway and webhooks


A bot receives events two ways, like Discord: a websocket it keeps open, or a webhook the server POSTs to. Every event is recorded once with an increasing `id`; both channels carry the same JSON:

```json
{"id": 42, "type": "command.invoked", "chat_id": "…", "data": {…}, "created_at": "2026-11-25T12:00:00Z"}
```

Event types (intents): `message.created`, `message.updated`, `message.deleted`, `message.reaction` (full-read bots only), `command.invoked`, `interaction.created` (from `/updates` envelopes; mentions and replies arrive as `message.created`), `members.changed` (`members.read`), `bot.installed`, `bot.removed`, and `ping` (the owner's test event, always delivered). Payloads carry ciphertext and ids only. Events are kept 7 days and may repeat (resume, retries): dedupe on `id`.

**Gateway** — `GET /api/bot/v1/gateway` (websocket, bot token, no `Origin`). Up to 5 connections per bot.

| Direction | Frame |
|---|---|
| server → | `{"op":"hello","d":{"heartbeat_interval":30000}}` |
| → server | `{"op":"identify","d":{"intents":["command.invoked"],"resume_from":41}}` within 10 s. No intents = all. `resume_from` replays what came after it (up to 1000). |
| server → | replayed `dispatch` frames, then `{"op":"ready","d":{"bot_id":"…","resumed":1}}` |
| server → | `{"op":"dispatch","t":"command.invoked","s":42,"d":{…event…}}` |
| → server | `{"op":"heartbeat"}` every interval → `{"op":"heartbeat_ack"}` |

Close codes: `4000` unknown op, `4001` not identified, `4002` invalid intents, `4003` heartbeat missed, `4008` too many connections, `4009` too slow (resume from your last `s`).

**Webhooks** (user session, owner only):

| Method | Path | Notes |
|---|---|---|
| `GET` | `/bots/:id/webhook` | `{url, intents, has_secret}`. The secret is never read back. |
| `PUT` | `/bots/:id/webhook` | `{url, intents?}`. `https` to a public host only (private, loopback and metadata addresses are refused, also after DNS). The first time, the reply carries `secret` — shown once. |
| `DELETE` | `/bots/:id/webhook` | Stop webhook deliveries. |
| `POST` | `/bots/:id/webhook/secret` | Rotate the signing secret; the reply carries the new one. |
| `GET` | `/bots/:id/deliveries` | The last 100 attempts: `status` (`pending`, `delivered`, `dead`), `attempts`, `last_status`, `last_error`. |
| `POST` | `/bots/:id/test-event` | Send a `ping` over the gateway and the webhook. `202`. |

Each delivery is a `POST` with `X-ZwoSocial-Event`, `X-ZwoSocial-Delivery`, `X-ZwoSocial-Timestamp` (unix seconds) and `X-ZwoSocial-Signature: sha256=<hex HMAC-SHA256(secret, timestamp + "." + body)>`. A receiver must check the signature and reject a timestamp more than 5 minutes from its clock — that is the replay protection (`bots.VerifySignature` in Go does both). Any `2xx` within 10 s is success; redirects are not followed. Failures retry after 10 s, 30 s, 2 min, 10 min and 1 h; after 6 attempts the delivery is dead.

## Error Handling

### Error Response

```json
{
  "error": {
    "code": "AUTH_INVALID_CREDENTIALS",
    "message": "Invalid phone or password",
    "details": {}
  }
}
```

### HTTP Codes

| Code | Description |
|------|-------------|
| 200 | Success |
| 201 | Created |
| 400 | Bad Request |
| 401 | Unauthorized |
| 403 | Forbidden |
| 404 | Not Found |
| 409 | Conflict |
| 429 | Too Many Requests |
| 500 | Internal Error |

### Error Codes

| Code | Description |
|------|-------------|
| AUTH_INVALID_CREDENTIALS | Invalid phone/password |
| AUTH_TOKEN_EXPIRED | Token expired |
| CHAT_NOT_FOUND | Chat doesn't exist |
| CHAT_NO_PERMISSION | No access to chat |
| USER_NOT_FOUND | User doesn't exist |
| MESSAGE_TOO_LONG | Content exceeds limit |
| RATE_LIMITED | Too many requests |

---

## Rate Limiting

| Endpoint | Limit |
|----------|-------|
| Auth | 5/minute |
| Messages | 60/minute |
| Search | 30/minute |
| Other | 100/minute |

Headers:

```http
X-RateLimit-Limit: 100
X-RateLimit-Remaining: 99
X-RateLimit-Reset: 1620000000
```
