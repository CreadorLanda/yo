---
title: Início rápido
slug: /
sidebar_position: 1
---

# Criar um bot do ZwoSocial

O ZwoSocial é um mensageiro cifrado ponta a ponta, e os bots também o são. Um bot é um participante com as suas próprias chaves de dispositivo. O servidor só transporta texto cifrado, e o bot decifra na tua máquina. Os SDKs tratam da cifra, por isso um bot reduz-se a alguns handlers.

## 1. Criar o bot

Na app, vai a **Definições → Programadores → Os meus bots → Criar um bot**. Escolhe um nome e um username que acabe em `bot` e copia o token. Ele só é mostrado **uma vez**: se o perderes, roda-o no mesmo ecrã.

## 2. Escrevê-lo

TypeScript (Bun ou Node 22+):

```sh
bun add @zwosocial/bot
```

```ts title="bot.ts"
import { Bot } from '@zwosocial/bot';

const bot = new Bot({ token: process.env.BOT_TOKEN!, apiUrl: 'https://yo.alexandrelanda.com' });

await bot.setCommands([{ name: 'ping', description: 'Check the bot is alive', description_pt: 'Ver se o bot está vivo', options: [] }]);
bot.command('ping', (ctx) => ctx.reply('pong 🏓'));
bot.onMessage((ctx) => ctx.reply(`Disseste: ${ctx.text}`));

await bot.start();
```

Go:

```sh
go get github.com/CreadorLanda/yo/sdk/go
```

```go title="main.go"
bot := zwosocial.New(os.Getenv("BOT_TOKEN"), "https://yo.alexandrelanda.com", nil)
bot.Command("ping", func(c *zwosocial.Context) error { return c.Reply(zwosocial.Text("pong 🏓")) })
bot.OnMessage(func(c *zwosocial.Context) error { return c.Reply(zwosocial.Text("Disseste: " + c.Text)) })
log.Fatal(bot.Run(context.Background()))
```

## 3. Corrê-lo e falar com ele

```sh
BOT_TOKEN=zsb_… bun bot.ts
```

Abre o bot na app (**Os meus bots → o teu bot → Abrir conversa com o bot**) e diz olá. Para o usar num grupo, um admin do grupo adiciona-o na informação do grupo. O bot entra em [modo privado](concepts/privacy-mode.md), por isso só vê os comandos, menções e respostas que lhe são dirigidos.

O primeiro arranque cria o ficheiro `.zwosocial-bot.json`, com as chaves e sessões do bot. Mantém-no fora do git e em segurança: é ele que permite ao bot ler as suas conversas.

## A seguir

- [Como funciona a cifra para um bot](concepts/encryption.md)
- [Comandos com /](guides/commands.md) e [botões, menus e formulários](guides/interactive-messages.md)
- [Eventos: gateway ou webhooks](guides/events.md)
- [Referência da API](api/reference.md)
