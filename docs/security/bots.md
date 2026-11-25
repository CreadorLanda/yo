# Bots: abuse, limits and data

Bots must not become the easiest way to spam a group or leak what people write. This is how the platform keeps them honest (#343). How bots fit end-to-end encryption is in [ADR 0002](../decisions/0002-bots-and-e2ee.md).

## Limits

- **600 requests a minute** per bot, across the API.
- **30 writes a minute** per bot in each chat (messages, edits, reactions, ephemeral replies).
- Over a limit: `429 rate_limited` with `retry_after` and a `Retry-After` header. Limits live in Redis, so they hold across API instances; if Redis is unreachable, requests pass rather than stopping every bot.

## Automatic suspension

The server cannot read what a bot sends, so it judges behaviour, not content. A bot that hits the per-chat write limit **5 times in 10 minutes** is suspended:

- its token stops working (`403 bot_suspended`) and it cannot be added to chats;
- every group it is in logs `bot.suspended` in its bot activity;
- its owner is told live (`bot.suspended`) and sees it under My bots.

The owner can lift an automatic suspension (`POST /bots/:id/reactivate`) once the cause is fixed. Suspensions made by operators (any other reason) are not the owner's to lift.

## Kill switch

`BOTS_DISABLED=true` stops every bot at once: the Bot API answers `503 bots_disabled` and no bot can be added to a chat. People's chats keep working.

## Group bot activity

Admins see what happened with bots in their group (`GET /chats/:id/bots/audit`, Group info → Bots → Bot activity): bots added and removed, full read given or taken, other permission changes, suspensions, and commands admins ran. It holds who and when, never what anyone wrote, and is kept for **one year**.

## People's data

- Anyone who shares a chat with a bot can ask it to delete what it holds about them (`POST /bots/:id/forget-me`, or Group info → Bots → the bot). The bot gets a `user.data_deletion` event with `reason: "requested"`.
- Deleting an account sends `user.data_deletion` with `reason: "account_deleted"` to every bot the person shared a chat with, before the account goes.

## Rules for bot developers

These are conditions of running a bot on ZwoSocial, checked when a bot asks for verification:

1. **Act on `user.data_deletion` within 30 days**: delete the person's messages, identifiers and anything derived from them, including backups once they rotate out.
2. **Keep only what the bot needs** to do what its description says, and say in the description what it stores.
3. **Keep message content no longer than 90 days** unless the person asked the bot to keep it (a note, a reminder for next year).
4. **Never sell or share** what people send a bot, and never use it to train models without their explicit consent.
5. **Ask for full read only when the bot cannot work without it**; a group is told when it is granted.
6. **Protect the token and webhook secret** like passwords; rotate them if they leak.

A bot that breaks these rules is suspended by operators.
