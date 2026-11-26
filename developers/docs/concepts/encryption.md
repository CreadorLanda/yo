---
description: 'Why a bot is a device with its own keys, which envelope each event uses, and what the server can see.'
title: Encryption
sidebar_position: 1
---

# How a bot fits end-to-end encryption

A bot is a device like any other. It publishes keys, people's apps start sessions with it, and the server only ever stores and forwards ciphertext. The server never decrypts for a bot: there is no "server-side bot" shortcut that would weaken everyone else's encryption.

## Envelopes

Every message body is an envelope:

| Prefix | Used for | Sealed with |
|---|---|---|
| `soc1.` | direct chats, and anything addressed to one participant | a pairwise session (X25519, X3DH-style handshake) |
| `soc1g.` | group messages | the sender's group key for the current epoch |

Plaintext is refused with `400`. A bot's reply in a direct chat is pairwise. In a group, the bot seals with its own sender key and hands that key to each member, pairwise, the first time in each key epoch.

## What arrives where

| What happened | Event | How it is sealed |
|---|---|---|
| A message in a direct chat with the bot | `message.created` | pairwise session |
| A command, mention or reply aimed at the bot | `command.invoked`, or `message.created` with an `update_id` | an envelope for the bot alone |
| A click on the bot's button, menu or form | `interaction.created` | an envelope for the bot alone |
| An autocomplete request | `command.autocomplete` | an envelope for the bot alone |
| Any group message, if the bot has full read | `message.created` | the group key the members gave the bot |

## Keys and the store

On first start the SDK creates an identity key, a signed pre-key and 40 one-time keys. It uploads them, and adds more when fewer than 10 are left. Keys, sessions and group keys live in the store (`.zwosocial-bot.json` by default, mode 0600).

Losing the store means a new identity. The bot can still read new conversations, but not the sessions it had before. Treat the file like the token.

## What the server can see

The server sees who is in which chat, when messages are sent, and the registered commands with their descriptions. It does not see what anyone typed, the options of a command, which button was clicked, or what the bot answered.
