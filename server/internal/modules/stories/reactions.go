package stories

import "strings"

// The emoji a story reaction may be.
//
// A closed set rather than free text: `emoji` is a TEXT column, so a client
// allowed to write anything into it can put anything in front of the author.
// The split into two groups is presentation only — the server treats every
// entry alike.
var (
	StandardReactions = []string{
		"❤️", "😂", "😮", "😢", "😡", "👍", "👎", "🔥", "🎉", "😍", "👏",
	}
	ExtendedReactions = []string{
		"🙌", "💪", "🙏", "😇", "❤️‍🔥", "💯", "⭐", "🌟", "✨", "🆕",
		"😁", "😎", "🥳",
	}
)

const (
	variationSelector16 = '\uFE0F'
	skinToneFirst       = '\U0001F3FB'
	skinToneLast        = '\U0001F3FF'
)

// reactionKeys maps a loosely written emoji to the form that gets stored.
var reactionKeys = buildReactionKeys()

func buildReactionKeys() map[string]string {
	m := make(map[string]string, len(StandardReactions)+len(ExtendedReactions))
	for _, group := range [][]string{StandardReactions, ExtendedReactions} {
		for _, e := range group {
			m[reactionKey(e)] = e
		}
	}
	return m
}

// reactionKey drops the parts of an emoji that do not change which one was
// meant: the variation selector asking for the colour glyph (❤ vs ❤️), and a
// skin tone on the hands (👍🏽 vs 👍).
//
// Both are folded away because keyboards disagree about them and the sender
// cannot see the difference. Folding also keeps the counts honest: 👍 and
// 👍🏽 are one tally, not two that each look small.
func reactionKey(emoji string) string {
	return strings.Map(func(r rune) rune {
		if r == variationSelector16 || (r >= skinToneFirst && r <= skinToneLast) {
			return -1
		}
		return r
	}, emoji)
}

// CanonicalReaction resolves one written emoji to the stored form, or
// reports that this server does not accept it as a reaction.
func CanonicalReaction(emoji string) (string, bool) {
	c, ok := reactionKeys[reactionKey(strings.TrimSpace(emoji))]
	return c, ok
}

// normalizeReactions turns what a client sent into the exact set to store:
// canonical, deduplicated, in the order it was listed.
//
// The order is the order the person tapped, and it is read straight back.
func normalizeReactions(in []string) ([]string, error) {
	out := make([]string, 0, len(in))
	seen := make(map[string]struct{}, len(in))
	for _, raw := range in {
		e, ok := CanonicalReaction(raw)
		if !ok {
			return nil, ErrInvalidEmoji
		}
		if _, dup := seen[e]; dup {
			continue
		}
		seen[e] = struct{}{}
		out = append(out, e)
	}
	return out, nil
}

// requestedReactions reads the set a react call is asking for.
//
// Two shapes because the single-emoji form shipped first: `{"emoji":"🔥"}`
// is what older clients send, `{"reactions":[…]}` is the one that can carry
// more than one, and the array wins when both arrive. An explicit empty
// array clears; a request carrying neither field is refused rather than read
// as a clear, so a client bug cannot wipe someone's reactions.
func requestedReactions(req ReactRequest) ([]string, error) {
	if req.Reactions != nil {
		return normalizeReactions(*req.Reactions)
	}
	if strings.TrimSpace(req.Emoji) == "" {
		return nil, ErrInvalidEmoji
	}
	return normalizeReactions([]string{req.Emoji})
}
