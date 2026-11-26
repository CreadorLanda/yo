---
title: TypeScript
sidebar_position: 1
---

# TypeScript SDK

`@zwosocial/bot` runs on Bun or Node 22+.

```sh
bun add @zwosocial/bot
```

## The bot

```ts
import { Bot, FileStore } from '@zwosocial/bot';

const bot = new Bot({
  token: process.env.BOT_TOKEN!,
  apiUrl: 'https://yo.alexandrelanda.com',
  store: new FileStore('/var/lib/mybot/state.json'), // optional; default ./.zwosocial-bot.json
});
```

| | |
|---|---|
| `bot.command(name, h)` | `/name`; options are in `ctx.command.options` |
| `bot.onMessage(h)` | any message the bot can read |
| `bot.onInteraction(id \| '*', h)` | clicks; `ctx.componentId`, `ctx.values`, `ctx.messageId` |
| `bot.onAutocomplete(cmd, option, h)` | return up to 25 `{name, value}` |
| `bot.on(type, h)` | raw events, such as `bot.installed` or `user.data_deletion` |
| `bot.setCommands(list, chatId?)` | register commands |
| `bot.start()` / `bot.stop()` | gateway |
| `bot.webhook(secret)` | a `(Request) => Response` handler for webhooks |
| `bot.send(chatId, reply, {isGroup, to})` | post on your own, e.g. on a schedule |
| `bot.store` | the store, also handy for your own state |

The context `ctx` holds `chatId`, `senderId`, `isGroup`, `text` and `messageId`. It answers with:

- `ctx.reply(r)`
- `ctx.replyPrivately(r)`
- `ctx.edit(messageId, r)`
- `ctx.react(emoji)`

A reply `r` is either a string or `{ text, card, components, expires_at }`.

## Examples

All of these live in [`sdk/typescript/examples`](https://github.com/CreadorLanda/yo/tree/dev/sdk/typescript/examples):

- `echo.ts` — the quick start, with a button.
- `reminder.ts` — `/remind`, with stored reminders, a cancel button and private errors.
- `poll.ts` — votes as buttons; the poll message is edited as people vote.
- `github-notifier.ts` — see [Integrations](../guides/integrations.md).
