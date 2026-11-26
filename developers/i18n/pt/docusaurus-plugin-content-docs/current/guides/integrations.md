---
title: Integrações
sidebar_position: 4
---

# Ligar outros serviços

Um bot é também a ponte entre o ZwoSocial e outros serviços. O padrão é sempre o mesmo:

1. O outro serviço chama o **teu** servidor, normalmente por um webhook.
2. O teu bot publica nas conversas que o pediram, cifrado como qualquer outra mensagem.

O [exemplo de notificações do GitHub](https://github.com/CreadorLanda/yo/blob/dev/sdk/typescript/examples/github-notifier.ts) mostra o ciclo inteiro em cerca de 100 linhas:

- `/subscribe` numa conversa guarda essa conversa no armazenamento do bot;
- o GitHub faz POST para `/github`, e o bot verifica `X-Hub-Signature-256`;
- pushes, pull requests, issues e releases passam a cartões com um botão "Open on GitHub".

```ts
bot.command('subscribe', async (ctx) => {
  await bot.store.set('subs', [...(await subs()), { chatId: ctx.chatId, isGroup: ctx.isGroup, by: ctx.senderId }]);
  return ctx.reply('✅ A actividade do GitHub vai ser publicada aqui.');
});

// mais tarde, quando o GitHub chama
await bot.send(sub.chatId, { text: 'PR #12 merged', card: { title: '#12 Add dark mode', color: 'success' } }, { isGroup: sub.isGroup, to: sub.by });
```

Regras práticas:

- Verifica a assinatura do outro serviço antes de agir sobre o que ele envia.
- Guarda os tokens de terceiros de que o bot precisa fora do armazenamento do bot, e nunca os envies para uma conversa.
- Publica só nas conversas que o pediram, e dá-lhes forma de parar, como `/unsubscribe`.
