# ZwoSocial bot SDK for Go

```sh
go get github.com/CreadorLanda/yo/sdk/go
```

```go
bot := zwosocial.New(os.Getenv("BOT_TOKEN"), "https://api.zwosocial.com", nil)

bot.Command("ping", func(c *zwosocial.Context) error {
	return c.Reply(zwosocial.Text("pong 🏓"))
})
bot.OnMessage(func(c *zwosocial.Context) error {
	return c.Reply(zwosocial.Reply{
		Text:       "You said: " + c.Text,
		Components: [][]zwosocial.Component{{zwosocial.Button("again", "Say it again", "primary")}},
	})
})
bot.OnInteraction("again", func(c *zwosocial.Context) error {
	return c.Reply(zwosocial.Text("Again! 🔁"))
})

log.Fatal(bot.Run(ctx)) // gateway; or mount zwosocial.WebhookHandler(secret, …)
```

This SDK is a port of [`@zwosocial/bot`](../typescript/README.md) and does the same work for you:

- key generation and storage, in `.zwosocial-bot.json` by default (mode 0600) and in the same format
- decrypting envelopes and encrypting replies, pairwise or with a group sender key
- gateway reconnects with resume
- webhook signature checks (HMAC with a 5-minute window)
- retries on `429` and `5xx`

`testdata/interop.json` is written by the TypeScript SDK (`bun test/make-interop-fixture.ts`), and the Go tests decrypt it. If the two SDKs ever drift apart, the build fails.

Examples: [`examples/echo`](examples/echo/main.go) and [`examples/poll`](examples/poll/main.go).
