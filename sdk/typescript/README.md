# @zwosocial/bot

Build ZwoSocial bots in TypeScript. The SDK covers:

- end-to-end encryption
- slash commands
- buttons and forms
- the gateway and webhooks
- retries when rate-limited

```sh
bun add @zwosocial/bot
```

```ts
import { Bot } from '@zwosocial/bot';

const bot = new Bot({ token: process.env.BOT_TOKEN!, apiUrl: 'https://yo.alexandrelanda.com' });

await bot.setCommands([{ name: 'ping', description: 'Check the bot is alive', options: [] }]);
bot.command('ping', (ctx) => ctx.reply('pong 🏓'));

bot.onMessage((ctx) =>
  ctx.reply({
    text: `You said: ${ctx.text}`,
    components: [[{ type: 'button', id: 'again', label: 'Say it again', style: 'primary' }]],
  }),
);
bot.onInteraction('again', (ctx) => ctx.reply('Again! 🔁'));

await bot.start(); // gateway; or serve bot.webhook(secret) from your HTTP server
```

To get a token, create a bot in the app under **Settings → Developers → My bots**.

## What it does for you

- **Keys.** On first start the bot creates its identity, signed pre-key and one-time keys, and publishes them. It tops up the one-time keys when they run low.
- **Storage.** Keys and sessions are kept in `.zwosocial-bot.json` (mode 0600). Pass `store` to keep them somewhere else. Treat the file as a secret: if you lose it, the bot can no longer read its existing conversations.
- **Decryption.** Commands, mentions, replies and clicks arrive as envelopes sealed for the bot alone. Messages in a direct chat, or in a group where the bot has full read, use the pairwise or group key.
- **Replies.** Each reply is sealed for the chat: pairwise in a direct chat, with the bot's own sender key in a group.
- **Gateway.** It sends heartbeats and reconnects with backoff (1 s up to 30 s). It resumes from the last handled event and skips duplicates.
- **Webhooks.** `bot.webhook(secret)` and `verifySignature()` check the HMAC and reject deliveries older than 5 minutes.
- **Rate limits.** A `429` waits for `Retry-After`. A `5xx` or network error is retried with backoff.

## API

| | |
|---|---|
| `bot.command(name, h)` | `/name`; `ctx.command.options` holds the options, already split |
| `bot.onMessage(h)` | any message the bot can read |
| `bot.onInteraction(id \| '*', h)` | clicks; `ctx.componentId`, `ctx.values` |
| `bot.onAutocomplete(cmd, option, h)` | return up to 25 `{name, value}` |
| `bot.on(type, h)` | raw events: `bot.installed`, `member.joined`, `user.data_deletion`… |
| `ctx.reply(r)` / `ctx.replyPrivately(r)` / `ctx.edit(id, r)` / `ctx.react(e)` | answer |
| `bot.send(chatId, r, {isGroup, to})` | post on your own, e.g. on a schedule |

A reply `r` is either a string or `{ text, card, components, expires_at }`.

## Examples

Run any of them with `BOT_TOKEN=… API_URL=… bun examples/<name>.ts`:

- [`echo.ts`](examples/echo.ts): repeats what it is told and shows a button.
- [`reminder.ts`](examples/reminder.ts): `/remind when:10m what:"…"`. Reminders are stored, so they survive a restart.
- [`poll.ts`](examples/poll.ts): `/poll`, with votes as buttons; the poll message updates as people vote.
- [`github-notifier.ts`](examples/github-notifier.ts): posts pushes, pull requests, issues and releases from a GitHub webhook.

## Development

```sh
bun install
bun test
bun run typecheck
E2E_API_URL=http://127.0.0.1:8080 bun test/e2e.ts ts   # against a dev server (APP_ENV=dev)
```
