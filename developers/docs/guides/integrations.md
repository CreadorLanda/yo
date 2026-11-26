---
description: 'Bridge another service into chats: verify its webhook, post only where asked.'
title: Integrations
sidebar_position: 4
---

# Connecting other services

A bot is also the bridge between ZwoSocial and other services. The pattern is always the same:

1. The other service calls **your** server, usually through a webhook.
2. Your bot posts into the chats that asked for it, encrypted like any other message.

The [GitHub notifier example](https://github.com/CreadorLanda/yo/blob/dev/sdk/typescript/examples/github-notifier.ts) shows the whole loop in about 100 lines:

- `/subscribe` in a chat records the chat in the bot's store;
- GitHub posts to `/github`, and the bot checks `X-Hub-Signature-256`;
- pushes, pull requests, issues and releases become cards with an "Open on GitHub" button.

```ts
bot.command('subscribe', async (ctx) => {
  await bot.store.set('subs', [...(await subs()), { chatId: ctx.chatId, isGroup: ctx.isGroup, by: ctx.senderId }]);
  return ctx.reply('✅ GitHub activity will be posted here.');
});

// later, when GitHub calls
await bot.send(sub.chatId, { text: 'PR #12 merged', card: { title: '#12 Add dark mode', color: 'success' } }, { isGroup: sub.isGroup, to: sub.by });
```

Rules of thumb:

- Verify the other service's signature before you act on anything it sends.
- Keep the third-party tokens your bot needs outside the bot's store, and never send them into a chat.
- Post only to chats that asked, and give them a way to stop, such as `/unsubscribe`.
