---
title: Privacy mode and scopes
sidebar_position: 2
---

# Privacy mode and scopes

A bot joins a group in **privacy mode**. In that mode the bot can never open ordinary group messages. It receives only what is addressed to it: commands, mentions, replies to its messages, and clicks on its components. People's apps seal each of these in an envelope for the bot alone.

The server enforces this. Group keys addressed to a bot without full read are dropped on upload, so the bot cannot decrypt group traffic even if it tries.

## Full read

A group admin can grant `messages.read.all`, which the app calls "Let it read every message". The whole group is told, and the group's key epoch advances:

- the bot gets keys only from that point on, never the history;
- revoking full read, or removing the bot, advances the epoch again, so the bot stops being able to read.

Ask for full read only if the bot cannot work without it, for example to moderate or summarise a group.

## Scopes

| Scope | Lets the bot |
|---|---|
| `messages.read.commands` | receive commands, mentions, replies and interactions (privacy mode) |
| `messages.read.all` | read every message (admin-granted and announced) |
| `messages.send` | send, edit, delete and react to its own messages, and distribute its group key |
| `members.read` | list the members of the chat |
| `members.manage` | manage members |
| `events.manage` | manage the chat's events |

With no scopes given, a bot is installed with `messages.read.commands`, `messages.send` and `members.read`. A call without the scope fails with `403 scope_missing`. A call in a chat the bot is not in fails with `404 chat_not_found`.

## Direct chats

Anyone can open a direct chat with a bot (**Open chat with bot**). There, the bot reads every message, because each one is addressed to it. No installation is needed.

Bots cannot start chats with people, join calls, or be added to anonymous conversations.
