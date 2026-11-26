---
description: 'Authentication, error codes and rate limits of the Bot API.'
title: Overview
sidebar_position: 1
---

# API overview

Base URL: `https://yo.alexandrelanda.com/api/bot/v1`. The SDKs wrap all of it. Read this if you are writing your own client.

## Authentication

```http
Authorization: Bot zsb_…
```

The owner can rotate the token from the app (the old one stops at once) or revoke it.

| Error | Meaning |
|---|---|
| `401` | missing, revoked or invalid token |
| `403 bot_suspended` | the bot is suspended (see [Safety](../safety.md)) |
| `503 bots_disabled` | the operators switched all bots off; do not retry |

## Errors

Errors are JSON: `{"error": "scope_missing", "detail": "…"}`. `detail` is optional and meant for people, not for parsing.

| Error | Meaning |
|---|---|
| `404 chat_not_found` | the bot is not in that chat |
| `403 scope_missing` | the installation lacks the scope |
| `400 invalid_e2ee_envelope_for_chat` | the body is not an envelope, or is the wrong kind for the chat |
| `400 stale_group_epoch` | the group's key changed; sync the group keys and seal again |
| `400 invalid_command` | the command set breaks a rule; `detail` says which |

## Limits

| Limit | Value |
|---|---|
| Requests | 600 per minute per bot |
| Writes | 30 per minute per bot in each chat |
| Gateway connections | 5 per bot |
| Commands | 100 per bot, 10 options each |
| Autocomplete answer | within 3 s, at most 25 choices |
| Undelivered updates and events | kept 7 days |

Over a limit you get `429 {"error": "rate_limited", "retry_after": N}` and a `Retry-After` header. Wait that long; the SDKs do. A bot that keeps hitting the per-chat write limit is [suspended automatically](../safety.md).
