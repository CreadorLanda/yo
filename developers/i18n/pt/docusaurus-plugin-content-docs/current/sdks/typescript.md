---
title: TypeScript
sidebar_position: 1
---

# SDK de TypeScript

O `@zwosocial/bot` corre em Bun ou Node 22+.

```sh
bun add @zwosocial/bot
```

## O bot

```ts
import { Bot, FileStore } from '@zwosocial/bot';

const bot = new Bot({
  token: process.env.BOT_TOKEN!,
  apiUrl: 'https://yo.alexandrelanda.com',
  store: new FileStore('/var/lib/mybot/state.json'), // opcional; por omissão ./.zwosocial-bot.json
});
```

| | |
|---|---|
| `bot.command(nome, h)` | `/nome`; as opções estão em `ctx.command.options` |
| `bot.onMessage(h)` | qualquer mensagem que o bot possa ler |
| `bot.onInteraction(id \| '*', h)` | cliques; `ctx.componentId`, `ctx.values`, `ctx.messageId` |
| `bot.onAutocomplete(cmd, opção, h)` | devolve até 25 `{name, value}` |
| `bot.on(tipo, h)` | eventos em bruto, como `bot.installed` ou `user.data_deletion` |
| `bot.setCommands(lista, chatId?)` | registar comandos |
| `bot.start()` / `bot.stop()` | gateway |
| `bot.webhook(segredo)` | um handler `(Request) => Response` para webhooks |
| `bot.send(chatId, resposta, {isGroup, to})` | publicar por iniciativa própria, por exemplo a uma hora marcada |
| `bot.store` | o armazenamento, útil também para o teu próprio estado |

O contexto `ctx` tem `chatId`, `senderId`, `isGroup`, `text` e `messageId`. Responde com:

- `ctx.reply(r)`
- `ctx.replyPrivately(r)`
- `ctx.edit(messageId, r)`
- `ctx.react(emoji)`

Uma resposta `r` é uma string ou `{ text, card, components, expires_at }`.

## Exemplos

Estão todos em [`sdk/typescript/examples`](https://github.com/CreadorLanda/yo/tree/dev/sdk/typescript/examples):

- `echo.ts` — o início rápido, com um botão.
- `reminder.ts` — `/remind`, com lembretes guardados, botão para cancelar e erros privados.
- `poll.ts` — votos em botões; a mensagem da sondagem é editada à medida que as pessoas votam.
- `github-notifier.ts` — ver [Integrações](../guides/integrations.md).
