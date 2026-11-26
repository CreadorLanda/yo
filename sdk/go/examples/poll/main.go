// Poll bot: `/poll question:… options:"Pizza, Sushi, Tacos"` posts buttons;
// each click counts (one vote per person, changeable) and updates the poll.
//
//	BOT_TOKEN=zsb_… API_URL=https://api.zwosocial.com go run ./examples/poll
package main

import (
	"context"
	"fmt"
	"log"
	"os"
	"os/signal"
	"strconv"
	"strings"

	zwosocial "github.com/CreadorLanda/yo/sdk/go"
)

type poll struct {
	Question string         `json:"question"`
	Options  []string       `json:"options"`
	Votes    map[string]int `json:"votes"`
	By       string         `json:"by"`
	IsGroup  bool           `json:"is_group"`
}

func (p poll) render() zwosocial.Reply {
	counts := make([]int, len(p.Options))
	for _, v := range p.Votes {
		counts[v]++
	}
	fields := make([]zwosocial.CardField, len(p.Options))
	row := []zwosocial.Component{}
	for i, o := range p.Options {
		fields[i] = zwosocial.CardField{Name: o, Value: strconv.Itoa(counts[i])}
		row = append(row, zwosocial.Button("vote:"+strconv.Itoa(i), o, "secondary"))
	}
	return zwosocial.Reply{
		Text:       "📊 " + p.Question,
		Card:       &zwosocial.Card{Title: p.Question, Fields: fields, Footer: fmt.Sprintf("%d votes", len(p.Votes)), Color: "primary"},
		Components: [][]zwosocial.Component{row},
	}
}

func key(chatID string, messageID int64) string { return fmt.Sprintf("poll:%s:%d", chatID, messageID) }

func main() {
	bot := zwosocial.New(os.Getenv("BOT_TOKEN"), os.Getenv("API_URL"), nil)
	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt)
	defer stop()

	bot.Command("poll", func(c *zwosocial.Context) error {
		var options []string
		for _, o := range strings.Split(c.Command.Options["options"], ",") {
			if o = strings.TrimSpace(o); o != "" && len(options) < 5 {
				options = append(options, o)
			}
		}
		q := strings.TrimSpace(c.Command.Options["question"])
		if q == "" || len(options) < 2 {
			return c.ReplyPrivately(zwosocial.Text(`Try /poll question:"Lunch?" options:"Pizza, Sushi"`))
		}
		p := poll{Question: q, Options: options, Votes: map[string]int{}, By: c.SenderID, IsGroup: c.IsGroup}
		id, err := bot.Send(c.Ctx, c.ChatID, p.render(), c.IsGroup, c.SenderID, c.MessageID)
		if err != nil {
			return err
		}
		return bot.Store.Set(key(c.ChatID, id), p)
	})

	bot.OnInteraction("*", func(c *zwosocial.Context) error {
		if c.MessageID == nil || !strings.HasPrefix(c.ComponentID, "vote:") {
			return nil
		}
		var p poll
		if ok, err := bot.Store.Get(key(c.ChatID, *c.MessageID), &p); err != nil || !ok {
			return err
		}
		choice, err := strconv.Atoi(strings.TrimPrefix(c.ComponentID, "vote:"))
		if err != nil || choice < 0 || choice >= len(p.Options) {
			return nil
		}
		p.Votes[c.SenderID] = choice
		if err := bot.Store.Set(key(c.ChatID, *c.MessageID), p); err != nil {
			return err
		}
		return bot.Edit(c.Ctx, c.ChatID, *c.MessageID, p.render(), c.IsGroup, c.SenderID)
	})

	if err := bot.Init(ctx); err != nil {
		log.Fatal(err)
	}
	err := bot.SetCommands(ctx, []zwosocial.Command{{
		Name: "poll", Description: "Ask the chat a question", DescriptionPT: "Fazer uma pergunta à conversa",
		Options: []zwosocial.CommandOption{
			{Name: "question", Description: "The question", DescriptionPT: "A pergunta", Type: "string", Required: true},
			{Name: "options", Description: "Answers, comma-separated (2–5)", DescriptionPT: "Respostas, separadas por vírgulas (2–5)", Type: "string", Required: true},
		},
	}})
	if err != nil {
		log.Fatal(err)
	}
	if err := bot.Run(ctx); err != nil && ctx.Err() == nil {
		log.Fatal(err)
	}
}
