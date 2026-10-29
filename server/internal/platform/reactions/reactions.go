// Package reactions owns the reaction contract shared by every content type.
//
// The catalogue is generated from Unicode's Emoji Test Data and embedded in
// the server so validation does not depend on a mutable filesystem at runtime.
package reactions

import (
	_ "embed"
	"encoding/json"
	"errors"
	"strings"
)

const MaxPerUser = 2

var (
	ErrInvalidEmoji = errors.New("invalid_emoji")
	ErrTooMany      = errors.New("too_many_reactions")
)

//go:embed emoji-catalogue.json
var catalogueData []byte

var catalogue, catalogueList = loadCatalogue()

// Old clients sent a text-presentation heart. Keep accepting it while storing
// the fully-qualified sequence used by the catalogue and newer clients.
var compatibilityAliases = map[string]string{
	"❤": "❤️",
}

func loadCatalogue() (map[string]struct{}, []string) {
	var entries []string
	if err := json.Unmarshal(catalogueData, &entries); err != nil {
		panic("reactions: invalid embedded catalogue: " + err.Error())
	}
	out := make(map[string]struct{}, len(entries))
	for _, emoji := range entries {
		out[emoji] = struct{}{}
	}
	return out, entries
}

// Catalogue returns a copy so callers cannot mutate the process-wide set.
func Catalogue() []string {
	return append([]string(nil), catalogueList...)
}

// Normalize validates one supported Unicode emoji sequence and preserves skin
// tones and other sequence components instead of collapsing them together.
func Normalize(raw string) (string, error) {
	emoji := strings.TrimSpace(raw)
	if canonical, ok := compatibilityAliases[emoji]; ok {
		emoji = canonical
	}
	if _, ok := catalogue[emoji]; !ok {
		return "", ErrInvalidEmoji
	}
	return emoji, nil
}

// NormalizeSet validates, canonicalizes, deduplicates, and caps a requested
// set before any repository mutation occurs.
func NormalizeSet(raw []string) ([]string, error) {
	out := make([]string, 0, len(raw))
	seen := make(map[string]struct{}, len(raw))
	for _, item := range raw {
		emoji, err := Normalize(item)
		if err != nil {
			return nil, err
		}
		if _, exists := seen[emoji]; exists {
			continue
		}
		if len(out) >= MaxPerUser {
			return nil, ErrTooMany
		}
		seen[emoji] = struct{}{}
		out = append(out, emoji)
	}
	return out, nil
}

// Toggle returns the caller's next set. Selecting an existing emoji removes
// it; selecting a third distinct emoji is refused without changing the set.
func Toggle(current []string, raw string) ([]string, error) {
	emoji, err := Normalize(raw)
	if err != nil {
		return nil, err
	}
	current, err = NormalizeSet(current)
	if err != nil {
		return nil, err
	}
	for i, existing := range current {
		if existing == emoji {
			return append(append([]string(nil), current[:i]...), current[i+1:]...), nil
		}
	}
	if len(current) >= MaxPerUser {
		return nil, ErrTooMany
	}
	return append(append([]string(nil), current...), emoji), nil
}
