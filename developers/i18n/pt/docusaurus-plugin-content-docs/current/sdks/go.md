---
title: Go
sidebar_position: 2
---

# SDK de Go

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
		Text:       "Disseste: " + c.Text,
		Components: [][]zwosocial.Component{{zwosocial.Button("again", "Outra vez", "primary")}},
	})
})
bot.OnInteraction("again", func(c *zwosocial.Context) error { return c.Reply(zwosocial.Text("Outra vez! 🔁")) })

log.Fatal(bot.Run(ctx))
```

Funciona como o SDK de TypeScript:

- `Command`, `OnMessage`, `OnInteraction`, `OnAutocomplete` e `On` registam handlers.
- `SetCommands` regista comandos.
- `Run` abre o gateway; `Handle` processa os eventos vindos de `WebhookHandler`.
- `Send` e `Edit` publicam e alteram mensagens.
- `Context.Reply` responde, e `Context.ReplyPrivately` responde só à pessoa.

Os dois SDKs usam o mesmo formato de armazenamento, por isso um bot pode passar de um para o outro. Os testes de Go decifram mensagens que o SDK de TypeScript cifrou, para que os dois não possam divergir.

Os exemplos estão em [`sdk/go/examples`](https://github.com/CreadorLanda/yo/tree/dev/sdk/go/examples): `echo` e `poll`.
