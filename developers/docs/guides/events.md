---
title: Events — gateway or webhooks
sidebar_position: 3
---

# Events: gateway or webhooks

A bot receives events in one of two ways: over a websocket it keeps open (the **gateway**), or as signed POSTs to a URL (**webhooks**). Both carry the same JSON:

```json
{"id": 42, "type": "command.invoked", "chat_id": "…", "data": {"…": "…"}, "created_at": "2026-11-25T12:00:00Z"}
```

Events are kept for 7 days and can repeat after a resume or a retried webhook, so dedupe on `id`. The SDKs do this for you.

## Event types

| Type | When |
|---|---|
| `message.created` | a message the bot can read: its direct chats, anything addressed to it, or every group message with full read |
| `message.updated`, `message.deleted`, `message.reaction` | full-read bots only |
| `command.invoked` | someone used one of its commands |
| `interaction.created` | someone clicked one of its components |
| `command.autocomplete` | someone is typing an option that autocompletes |
| `members.changed` | members joined or left (`members.read`) |
| `bot.installed`, `bot.removed` | added to or removed from a group |
| `user.data_deletion` | someone asked the bot to delete their data (see [Safety](../safety.md)) |
| `ping` | the owner's test event, always delivered |

Payloads carry only ids and ciphertext.

## Gateway

With the SDK, `bot.start()` (TypeScript) or `bot.Run(ctx)` (Go) opens the gateway. It sends heartbeats, reconnects with backoff from 1 s to 30 s, and resumes from the last event it handled.

The protocol, at `GET /api/bot/v1/gateway` (websocket, bot token, at most 5 connections per bot):

| Direction | Frame |
|---|---|
| server → | `{"op":"hello","d":{"heartbeat_interval":30000}}` |
| → server | `{"op":"identify","d":{"intents":["command.invoked"],"resume_from":41}}` within 10 s. No intents means all of them. |
| server → | the missed `dispatch` frames, then `{"op":"ready","d":{"bot_id":"…","resumed":1}}` |
| server → | `{"op":"dispatch","t":"command.invoked","s":42,"d":{…}}` |
| → server | `{"op":"heartbeat"}` every interval, answered by `{"op":"heartbeat_ack"}` |

Close codes:

| Code | Meaning |
|---|---|
| `4000` | unknown op |
| `4001` | not identified |
| `4002` | invalid intents (final; do not reconnect) |
| `4003` | heartbeat missed |
| `4008` | too many connections |
| `4009` | too slow; resume from your last `s` |

## Webhooks

Set the URL in the app (**My bots → your bot → Webhook**). It must be `https` on a public host. The signing secret is shown once.

Every delivery is a `POST` with these headers:

- `X-ZwoSocial-Event` and `X-ZwoSocial-Delivery`
- `X-ZwoSocial-Timestamp`, in Unix seconds
- `X-ZwoSocial-Signature: sha256=<hex HMAC-SHA256(secret, timestamp + "." + body)>`

Check the signature, and reject any timestamp more than 5 minutes away from your clock. That check is what stops a captured delivery from being replayed. The SDKs do both:

```ts
Bun.serve({ port: 3000, fetch: bot.webhook(process.env.WEBHOOK_SECRET!) });
```

```go
http.Handle("/zwosocial", zwosocial.WebhookHandler(secret, func(e zwosocial.Event) error { return bot.Handle(ctx, e) }))
```

Any `2xx` within 10 s counts as delivered, and redirects are not followed. A failed delivery is retried after 10 s, 30 s, 2 min, 10 min and 1 h. After 6 attempts it is marked dead. The app shows the last 100 deliveries and can send a test `ping`.
