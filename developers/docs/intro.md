---
description: 'Create a bot in the app, write it in TypeScript or Go, and talk to it.'
title: Quick start
slug: /
sidebar_position: 1
---

# Build a ZwoSocial bot

ZwoSocial is an end-to-end encrypted messenger, and its bots are encrypted end to end too. A bot is a participant with its own device keys. The server carries only ciphertext, and your bot decrypts on your machine. The SDKs handle the encryption, so a bot is a few handlers.

## 1. Create the bot

In the app, go to **Settings → Developer → My bots → Create a bot**. Pick a name and a username ending in `bot`, then copy the token. It is shown **once**: if you lose it, rotate it from the same screen.

## 2. Write it

TypeScript (Bun or Node 22+):

```sh
bun add @zwosocial/bot
```

```ts title="bot.ts"
import { Bot } from '@zwosocial/bot';

const bot = new Bot({ token: process.env.BOT_TOKEN!, apiUrl: 'https://yo.alexandrelanda.com' });

await bot.setCommands([{ name: 'ping', description: 'Check the bot is alive', options: [] }]);
bot.command('ping', (ctx) => ctx.reply('pong 🏓'));
bot.onMessage((ctx) => ctx.reply(`You said: ${ctx.text}`));

await bot.start();
```

Go:

```sh
go get github.com/CreadorLanda/yo/sdk/go
```

```go title="main.go"
bot := zwosocial.New(os.Getenv("BOT_TOKEN"), "https://yo.alexandrelanda.com", nil)
bot.Command("ping", func(c *zwosocial.Context) error { return c.Reply(zwosocial.Text("pong 🏓")) })
bot.OnMessage(func(c *zwosocial.Context) error { return c.Reply(zwosocial.Text("You said: " + c.Text)) })
log.Fatal(bot.Run(context.Background()))
```

## 3. Run it and talk to it

```sh
BOT_TOKEN=zsb_… bun bot.ts
```

Open your bot in the app (**My bots → your bot → Open chat with bot**) and say hi. To use it in a group, a group admin adds it from the group's info. It joins in [privacy mode](concepts/privacy-mode.md), so it only sees commands, mentions and replies meant for it.

The first run creates `.zwosocial-bot.json`, which holds the bot's keys and sessions. Keep it out of git and keep it safe: it is what lets the bot read its conversations.

## Next

- [How encryption works for a bot](concepts/encryption.md)
- [Slash commands](guides/commands.md) and [buttons, menus and forms](guides/interactive-messages.md)
- [Events: gateway or webhooks](guides/events.md)
- [API reference](api/reference.md)
