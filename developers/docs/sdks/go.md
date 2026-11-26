---
title: Go
sidebar_position: 2
---

# Go SDK

```sh
go get github.com/CreadorLanda/yo/sdk/go
```

```go
import zwosocial "github.com/CreadorLanda/yo/sdk/go"

bot := zwosocial.New(os.Getenv("BOT_TOKEN"), "https://yo.alexandrelanda.com", nil) // nil: ./.zwosocial-bot.json

bot.Command("ping", func(c *zwosocial.Context) error {
	return c.Reply(zwosocial.Text("pong 🏓"))
})
bot.OnMessage(func(c *zwosocial.Context) error {
	return c.Reply(zwosocial.Reply{
		Text:       "You said: " + c.Text,
		Components: [][]zwosocial.Component{{zwosocial.Button("again", "Say it again", "primary")}},
	})
})
bot.OnInteraction("again", func(c *zwosocial.Context) error { return c.Reply(zwosocial.Text("Again! 🔁")) })

log.Fatal(bot.Run(ctx))
```

It mirrors the TypeScript SDK:

- `Command`, `OnMessage`, `OnInteraction`, `OnAutocomplete` and `On` register handlers.
- `SetCommands` registers commands.
- `Run` opens the gateway; `Handle` processes events from `WebhookHandler`.
- `Send` and `Edit` post and change messages.
- `Context.Reply` answers, and `Context.ReplyPrivately` answers only the person.

Both SDKs use the same store format, so a bot can move between them. The Go tests decrypt messages that the TypeScript SDK encrypted, so the two cannot drift apart.

Examples are in [`sdk/go/examples`](https://github.com/CreadorLanda/yo/tree/dev/sdk/go/examples): `echo` and `poll`.
