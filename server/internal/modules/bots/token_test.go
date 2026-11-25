package bots

import (
	"bytes"
	"errors"
	"strings"
	"testing"
)

func TestTokenSecretShapeAndHash(t *testing.T) {
	secret, hash, err := newTokenSecret()
	if err != nil {
		t.Fatalf("newTokenSecret: %v", err)
	}
	if !strings.HasPrefix(secret, TokenPrefix) || !tokenShape.MatchString(secret) {
		t.Fatalf("secret %q does not have the zsb_ shape", secret)
	}
	if !bytes.Equal(hash, hashToken(secret)) {
		t.Fatal("stored hash is not the hash of the secret")
	}
	other, _, _ := newTokenSecret()
	if other == secret {
		t.Fatal("two tokens collided")
	}
	if got := tokenDisplayPrefix(secret); got != secret[:10] || strings.Contains(got, secret[10:]) {
		t.Fatalf("display prefix %q reveals too much or too little", got)
	}
}

func TestParseBotAuthorization(t *testing.T) {
	secret, _, _ := newTokenSecret()
	cases := []struct {
		header string
		ok     bool
	}{
		{"Bot " + secret, true},
		{"Bot   " + secret + "  ", true},
		{"Bearer " + secret, false},
		{"bot " + secret, false},
		{"Bot zsb_short", false},
		{"Bot " + strings.TrimPrefix(secret, TokenPrefix), false},
		{"", false},
	}
	for _, c := range cases {
		got, ok := parseBotAuthorization(c.header)
		if ok != c.ok || (ok && got != secret) {
			t.Errorf("parseBotAuthorization(%q) = %q, %v; want ok=%v", c.header, got, ok, c.ok)
		}
	}
}

func TestBotUsernameMustEndInBot(t *testing.T) {
	valid := []string{"remindbot", "tasks_bot", "a1bot", "my_calendar_bot"}
	invalid := []string{"reminder", "bot", "Remindbot", "remind-bot", "_hiddenbot", "botremind",
		strings.Repeat("a", 31) + "bot"}
	for _, u := range valid {
		if !validBotUsername(u) {
			t.Errorf("%q should be a valid bot username", u)
		}
	}
	for _, u := range invalid {
		if validBotUsername(u) {
			t.Errorf("%q should be rejected", u)
		}
	}
}

func TestNormalizeScopes(t *testing.T) {
	got, err := normalizeScopes(nil)
	if err != nil || len(got) != len(DefaultScopes) {
		t.Fatalf("empty request should get the defaults, got %v %v", got, err)
	}
	if hasScope(got, ScopeReadAll) {
		t.Fatal("defaults must never include full read (ADR 0002)")
	}
	got, err = normalizeScopes([]Scope{ScopeSend, ScopeSend, ScopeReadAll})
	if err != nil || len(got) != 2 || got[0] != ScopeSend || got[1] != ScopeReadAll {
		t.Fatalf("dedupe kept order wrong: %v %v", got, err)
	}
	if _, err := normalizeScopes([]Scope{"messages.read.everything"}); !errors.Is(err, ErrInvalidScope) {
		t.Fatalf("unknown scope err = %v, want ErrInvalidScope", err)
	}
}
