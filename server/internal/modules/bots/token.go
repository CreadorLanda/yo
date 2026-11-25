package bots

import (
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"fmt"
	"regexp"
	"strings"
)

// TokenPrefix marks a ZwoSocial bot token, so secret scanners (GitHub's,
// gitleaks) can recognise a leaked one by shape.
const TokenPrefix = "zsb_"

const tokenRandomBytes = 32

var tokenShape = regexp.MustCompile(`^zsb_[A-Za-z0-9_-]{43}$`)

// newTokenSecret returns a fresh secret and the hash to store.
//
// The secret is 256 random bits. It is not a JWT: nothing in it is
// meaningful, it cannot be decoded, and revoking it is deleting its hash.
func newTokenSecret() (secret string, hash []byte, err error) {
	buf := make([]byte, tokenRandomBytes)
	if _, err := rand.Read(buf); err != nil {
		return "", nil, fmt.Errorf("bot token entropy: %w", err)
	}
	secret = TokenPrefix + base64.RawURLEncoding.EncodeToString(buf)
	return secret, hashToken(secret), nil
}

// hashToken is SHA-256. The secret already has 256 bits of entropy, so a
// slow password hash would add cost without adding resistance.
func hashToken(secret string) []byte {
	sum := sha256.Sum256([]byte(secret))
	return sum[:]
}

// tokenDisplayPrefix is what an owner sees to tell tokens apart.
func tokenDisplayPrefix(secret string) string {
	if len(secret) < len(TokenPrefix)+6 {
		return secret
	}
	return secret[:len(TokenPrefix)+6]
}

// parseBotAuthorization extracts the secret from `Authorization: Bot <token>`.
func parseBotAuthorization(header string) (string, bool) {
	const scheme = "Bot "
	if !strings.HasPrefix(header, scheme) {
		return "", false
	}
	secret := strings.TrimSpace(strings.TrimPrefix(header, scheme))
	if !tokenShape.MatchString(secret) {
		return "", false
	}
	return secret, true
}

var usernameShape = regexp.MustCompile(`^[a-z0-9_]{3,32}$`)

// validBotUsername is the people rule, longer, and ending in "bot" — so a
// bot can never pass for a person in a mention or a member list.
func validBotUsername(u string) bool {
	return usernameShape.MatchString(u) && len(u) > len("bot") &&
		strings.HasSuffix(u, "bot") && !strings.HasPrefix(u, "_")
}

// normalizeScopes validates and de-duplicates, keeping the given order.
func normalizeScopes(in []Scope) ([]Scope, error) {
	if len(in) == 0 {
		return append([]Scope(nil), DefaultScopes...), nil
	}
	seen := make(map[Scope]bool, len(in))
	out := make([]Scope, 0, len(in))
	for _, s := range in {
		if !knownScopes[s] {
			return nil, fmt.Errorf("%w: %s", ErrInvalidScope, s)
		}
		if seen[s] {
			continue
		}
		seen[s] = true
		out = append(out, s)
	}
	return out, nil
}

func hasScope(scopes []Scope, want Scope) bool {
	for _, s := range scopes {
		if s == want {
			return true
		}
	}
	return false
}
