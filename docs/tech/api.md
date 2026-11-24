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
