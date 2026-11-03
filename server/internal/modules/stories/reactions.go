package stories

import (
	"strings"

	platformreactions "github.com/CreadorLanda/zwosocial/server/internal/platform/reactions"
)

var (
	ErrInvalidEmoji     = platformreactions.ErrInvalidEmoji
	ErrTooManyReactions = platformreactions.ErrTooMany
)

// These remain presentation hints for older clients. Validation is performed
// against the complete Unicode catalogue in platform/reactions.
var (
	StandardReactions = []string{
		"❤️", "😂", "😮", "😢", "😡", "👍", "👎", "🔥", "🎉", "😍", "👏",
	}
	ExtendedReactions = []string{
		"🙌", "💪", "🙏", "😇", "❤️‍🔥", "💯", "⭐", "🌟", "✨", "🆕",
		"😁", "😎", "🥳",
	}
)

// CanonicalReaction validates one Unicode emoji sequence and preserves its
// skin tone and other sequence components.
func CanonicalReaction(emoji string) (string, bool) {
	c, err := platformreactions.Normalize(strings.TrimSpace(emoji))
	return c, err == nil
}

// reactionKey remains available to catalogue tests and older package users;
// it is not used for persistence validation, which must preserve variants.
func reactionKey(emoji string) string {
	return strings.Map(func(r rune) rune {
		if r == '\uFE0F' || (r >= '\U0001F3FB' && r <= '\U0001F3FF') {
			return -1
		}
		return r
	}, emoji)
}

func normalizeReactions(in []string) ([]string, error) {
	return platformreactions.NormalizeSet(in)
}

// requestedReactions reads both the original single-emoji request and the
// replacement-set request used by newer clients.
func requestedReactions(req ReactRequest) ([]string, error) {
	if req.Reactions != nil {
		return normalizeReactions(*req.Reactions)
	}
	if strings.TrimSpace(req.Emoji) == "" {
		return nil, ErrInvalidEmoji
	}
	return normalizeReactions([]string{req.Emoji})
}
