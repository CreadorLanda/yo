// Echo bot: repeats what it is told, with a button to say it again.
//
//	BOT_TOKEN=zsb_… API_URL=https://api.zwosocial.com go run ./examples/echo
package main

import (
	"context"
	"log"
	"os"
	"os/signal"

	zwosocial "github.com/CreadorLanda/yo/sdk/go"
)

func main() {
	bot := zwosocial.New(os.Getenv("BOT_TOKEN"), os.Getenv("API_URL"), nil)
	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt)
	defer stop()

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

	if err := bot.Init(ctx); err != nil {
		log.Fatal(err)
	}
	if err := bot.SetCommands(ctx, []zwosocial.Command{{Name: "ping", Description: "Check the bot is alive", DescriptionPT: "Ver se o bot está vivo"}}); err != nil {
		log.Fatal(err)
	}
	if err := bot.Run(ctx); err != nil && ctx.Err() == nil {
		log.Fatal(err)
	}
}
