---
description: 'The data rules every bot must follow, deletion requests, suspension and what admins see.'
title: Safety and data rules
sidebar_position: 5
---

# Safety and data rules

## Rules for bot developers

These are the conditions for running a bot on ZwoSocial:

1. **Act on `user.data_deletion` within 30 days.** Delete the person's messages, their identifiers and anything derived from them, including backups once those rotate out.
2. **Keep only what the bot needs** to do what its description says, and say in the description what it stores.
3. **Keep message content no longer than 90 days,** unless the person asked the bot to keep it (a note, or a reminder for next year).
4. **Never sell or share** what people send a bot, and never use it to train models without their explicit consent.
5. **Ask for full read only when the bot cannot work without it.** The group is told when it is granted.
6. **Protect the token and the webhook secret** like passwords, and rotate them if they leak. Never log them, and never log message contents.

A bot that breaks these rules is suspended by the operators.

Answers about someone's own data, or errors about what they typed, belong in a private reply (`replyPrivately`), not in the group.

## Deletion requests

Anyone who shares a chat with a bot can ask it to delete what it holds about them. The bot then gets `user.data_deletion` with `reason: "requested"`.

Deleting an account sends the same event, with `reason: "account_deleted"`, to every bot the person shared a chat with, before the account goes.

```ts
bot.on('user.data_deletion', async (e) => {
  const { user_id, reason } = e.data as { user_id: string; reason: 'requested' | 'account_deleted' };
  await forgetEverythingAbout(user_id);
});
```

## Automatic suspension

The server cannot read what a bot sends, so it judges behaviour, not content. A bot that hits the per-chat write limit **5 times in 10 minutes** is suspended:

- its token stops working (`403 bot_suspended`), and it cannot be added to chats;
- every group it is in records the suspension in its bot activity;
- its owner is told and sees it under **My bots**.

Once the cause is fixed, the owner can lift an automatic suspension from **My bots**. A suspension made by the operators can only be lifted by them.

## Kill switch

The operators can stop every bot at once. The Bot API then answers `503 bots_disabled`, and no bot can be added to a chat. People's chats keep working.

## What group admins see

Group admins see what happened with bots in their group (**Group info → Bots → Bot activity**):

- bots added and removed
- full read given or taken, and other permission changes
- suspensions
- commands that admins ran

The log records who did what and when, never what anyone wrote. It is kept for **one year**.
