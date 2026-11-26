package bots

import (
	"errors"
	"strings"
	"testing"

	"github.com/google/uuid"
)

func cmd(name string, opts ...CommandOption) Command {
	return Command{Name: name, Description: "does " + name, Options: opts}
}

func TestValidateCommands(t *testing.T) {
	ok := []Command{
		cmd("remind",
			CommandOption{Name: "when", Description: "When", Type: OptDateTime, Required: true},
			CommandOption{Name: "what", Description: "What", Type: OptString, Required: true, Autocomplete: true},
			CommandOption{Name: "who", Description: "Who", Type: OptUser},
			CommandOption{Name: "repeat", Description: "Repeat", Type: OptChoice, Choices: []Choice{{Name: "Daily", Value: "daily"}, {Name: "Weekly", Value: 7.0}}},
		),
		cmd("help"),
	}
	if err := validateCommands(ok); err != nil {
		t.Fatalf("valid set refused: %v", err)
	}

	bad := map[string][]Command{
		"uppercase name":       {cmd("Remind")},
		"duplicate":            {cmd("a"), cmd("a")},
		"no description":       {{Name: "x"}},
		"long description":     {{Name: "x", Description: strings.Repeat("d", 101)}},
		"unknown type":         {cmd("x", CommandOption{Name: "o", Description: "o", Type: "file"})},
		"choice without any":   {cmd("x", CommandOption{Name: "o", Description: "o", Type: OptChoice})},
		"choices on string":    {cmd("x", CommandOption{Name: "o", Description: "o", Type: OptString, Choices: []Choice{{Name: "a", Value: "a"}}})},
		"bool choice value":    {cmd("x", CommandOption{Name: "o", Description: "o", Type: OptChoice, Choices: []Choice{{Name: "a", Value: true}}})},
		"autocomplete on user": {cmd("x", CommandOption{Name: "o", Description: "o", Type: OptUser, Autocomplete: true})},
		"required after optional": {cmd("x",
			CommandOption{Name: "a", Description: "a", Type: OptString},
			CommandOption{Name: "b", Description: "b", Type: OptString, Required: true})},
		"duplicate option": {cmd("x",
			CommandOption{Name: "a", Description: "a", Type: OptString},
			CommandOption{Name: "a", Description: "a", Type: OptString})},
	}
	for name, set := range bad {
		if err := validateCommands(set); !errors.Is(err, ErrInvalidCommand) {
			t.Errorf("%s: accepted", name)
		}
	}
	many := make([]Command, maxCommands+1)
	for i := range many {
		many[i] = cmd(strings.Repeat("c", 1) + uuid.NewString()[:8])
	}
	if err := validateCommands(many); !errors.Is(err, ErrInvalidCommand) {
		t.Error("too many commands accepted")
	}
}

func TestAutocompleteBroker(t *testing.T) {
	var b autocompleteBroker
	bot, other := uuid.New(), uuid.New()
	id, reply := b.open(bot)
	if b.answer(id, other, nil) {
		t.Fatal("another bot answered someone else's request")
	}
	if !b.answer(id, bot, []Choice{{Name: "Lisboa", Value: "lis"}}) {
		t.Fatal("the asked bot could not answer")
	}
	if got := <-reply; len(got) != 1 || got[0].Name != "Lisboa" {
		t.Fatalf("reply: %v", got)
	}
	if b.answer(id, bot, nil) {
		t.Fatal("a request answers once")
	}
	id2, _ := b.open(bot)
	b.close(id2)
	if b.answer(id2, bot, nil) {
		t.Fatal("a closed (timed out) request cannot be answered")
	}
}
