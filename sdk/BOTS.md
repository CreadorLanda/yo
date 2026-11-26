# Building a ZwoSocial bot — guide for coding agents

You are writing a bot for ZwoSocial, an end-to-end encrypted messenger. Follow this recipe. The full documentation is at <https://creadorlanda.github.io/yo/llms-full.txt>.

## Recipe

1. **Use an SDK.** Never call the Bot API by hand to send messages: every message must be encrypted (`soc1.` or `soc1g.` envelopes), and the SDKs do that.
   - TypeScript: `bun add @zwosocial/bot`
   - Go: `go get github.com/CreadorLanda/yo/sdk/go`
2. **Configure from the environment.** Read `BOT_TOKEN` and `API_URL` (default `https://yo.alexandrelanda.com`). Never hard-code the token.
3. **Register commands** with `setCommands` before starting. Each command has a `name` (`a-z0-9_-`, at most 32 characters), a `description` (at most 100 characters), an optional `description_pt`, and `options`. Option types are `string`, `number`, `user`, `datetime` (RFC 3339) and `choice`; required options come first.
4. **Write handlers:**
   - `command(name)` for slash commands, with options already parsed in `ctx.command.options`;
   - `onMessage` for other messages;
   - `onInteraction(componentId)` for button, menu and form clicks;
   - `on('user.data_deletion')` for deletion requests.
5. **Reply** with `ctx.reply(...)`, which works in direct chats and groups. Use `ctx.replyPrivately(...)` for anything only that person should see.
6. **Start** with `bot.start()` (TypeScript) or `bot.Run(ctx)` (Go), or serve `bot.webhook(secret)` / `WebhookHandler` behind HTTPS.
7. **Keep state** in `bot.store`, or in your own database for real volume.

## Minimal template (TypeScript)

```ts
import { Bot } from '@zwosocial/bot';

const bot = new Bot({ token: process.env.BOT_TOKEN!, apiUrl: process.env.API_URL ?? 'https://yo.alexandrelanda.com' });

await bot.setCommands([
  { name: 'ping', description: 'Check the bot is alive', description_pt: 'Ver se o bot está vivo', options: [] },
]);

bot.command('ping', (ctx) => ctx.reply('pong 🏓'));

bot.onMessage((ctx) =>
  ctx.reply({
    text: `You said: ${ctx.text}`,
    components: [[{ type: 'button', id: 'again', label: 'Say it again', style: 'primary' }]],
  }),
);

bot.onInteraction('again', (ctx) => ctx.reply('Again! 🔁'));

bot.on('user.data_deletion', async (e) => {
  const { user_id } = e.data as { user_id: string };
  // delete everything stored about user_id
});

await bot.start();
```

## Minimal template (Go)

```go
package main

import (
	"context"
	"log"
	"os"
	"os/signal"

	zwosocial "github.com/CreadorLanda/yo/sdk/go"
)

func main() {
	api := os.Getenv("API_URL")
	if api == "" {
		api = "https://yo.alexandrelanda.com"
	}
	bot := zwosocial.New(os.Getenv("BOT_TOKEN"), api, nil)
	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt)
	defer stop()

	bot.Command("ping", func(c *zwosocial.Context) error { return c.Reply(zwosocial.Text("pong 🏓")) })
	bot.OnMessage(func(c *zwosocial.Context) error {
		return c.Reply(zwosocial.Reply{
			Text:       "You said: " + c.Text,
			Components: [][]zwosocial.Component{{zwosocial.Button("again", "Say it again", "primary")}},
		})
	})
	bot.OnInteraction("again", func(c *zwosocial.Context) error { return c.Reply(zwosocial.Text("Again! 🔁")) })

	if err := bot.Init(ctx); err != nil {
		log.Fatal(err)
	}
	if err := bot.SetCommands(ctx, []zwosocial.Command{{Name: "ping", Description: "Check the bot is alive"}}); err != nil {
		log.Fatal(err)
	}
	if err := bot.Run(ctx); err != nil && ctx.Err() == nil {
		log.Fatal(err)
	}
}
```

## Constraints

- **Never log** the token, the webhook secret, the store file or message contents.
- **Keep `.zwosocial-bot.json` out of version control.** It holds the bot's keys; losing it means the bot can no longer read its existing conversations.
- **Respect privacy mode.** In groups the bot only gets what is addressed to it. Do not ask for full read (`messages.read.all`) unless the bot cannot work without it.
- **Personal data goes in private replies** (`replyPrivately`), never into the group.
- **Honour `user.data_deletion` within 30 days.** Store only what the bot needs, and keep message content no longer than 90 days unless the person asked.
- **Respect the limits:** 30 writes a minute per chat. A bot that keeps hitting them is suspended. Do not post in loops.
- **Treat components as a contract.** Ids match `[A-Za-z0-9_:.-]{1,64}`. A message has at most 5 rows of up to 5 buttons each, and labels are at most 80 characters. Text is plain, never HTML or Markdown.

## Common mistakes

| Mistake | Instead |
|---|---|
| Posting to `/chats/{id}/messages` with plain text | Use `ctx.reply` or `bot.send`; the API refuses plaintext with `400`. |
| Expecting every group message in a handler | In privacy mode only commands, mentions, replies and clicks arrive. |
| Parsing the command text yourself | Use `ctx.command.options`; the app already split it. |
| A new store on every start (e.g. a temp dir or a container without a volume) | Persist the store file, or the bot loses its sessions. |
| Answering autocomplete slowly | Answer within 3 seconds, with at most 25 choices. |
| Calling `setCommands` with an invalid set | The whole set is refused with `400 invalid_command`; read `detail`. |
| Ignoring `ctx.isGroup` when sending later | Store `{chatId, isGroup, to}` with what you schedule, and pass it to `bot.send`. |

## Check your bot

From a clone of the repository, with a dev server running (`APP_ENV=dev`):

```sh
cd sdk/typescript
E2E_API_URL=http://127.0.0.1:8080 bun test/e2e.ts ts path/to/your-bot.ts
```

This runs the same end-to-end test as CI against your bot. A person signs up, sends a message, clicks the `again` button, and uses `/ping` in a group. The test expects the echo behaviour from the template above.
