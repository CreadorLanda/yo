package stories

import (
	"encoding/json"
	"strings"
)

type pollCaption struct {
	Question string   `json:"q"`
	LegacyA  string   `json:"a"`
	LegacyB  string   `json:"b"`
	Options  []string `json:"options"`
}

func validatePollCaption(caption string) bool {
	var poll pollCaption
	if json.Unmarshal([]byte(caption), &poll) != nil || strings.TrimSpace(poll.Question) == "" {
		return false
	}
	options := poll.Options
	if options == nil {
		options = []string{poll.LegacyA, poll.LegacyB}
	}
	if len(options) < 2 || len(options) > 3 {
		return false
	}
	for _, option := range options {
		if strings.TrimSpace(option) == "" {
			return false
		}
	}
	return true
}
