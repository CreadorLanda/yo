---
title: Changelog
sidebar_position: 6
---

# Changelog

## Bot API v1

- **SDKs:** `@zwosocial/bot` (TypeScript) and `github.com/CreadorLanda/yo/sdk/go`. Both have examples, and an end-to-end test runs them against a real server.
- **`GET /chats/{id}`** tells a bot whether a chat is direct or a group. Bots now also receive `message.created` for their own direct chats.
- **Safety:** automatic suspension, operator kill switch, group audit log and `user.data_deletion`.
- **Interactive messages:** cards, buttons, menus, person pickers, forms and private replies.
- **Slash commands:** options, per-chat sets and autocomplete.
- **Events:** websocket gateway with resume, and signed webhooks with retries.
- **Basics:** bot accounts and tokens, privacy mode enforced by the server, and the core Bot API.
