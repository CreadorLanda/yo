package users

import (
	"encoding/json"
	"strings"
	"testing"
)

// TestPublicViewHidesPrivacySettings is the leak this type exists to close.
//
// `GET /users/search` serialised the whole `User`, so searching for somebody
// told you whether they had read receipts off, whether they were in ghost
// mode, and whether their last seen was frozen — the exact facts those
// settings exist to withhold. Knowing a person is in ghost mode is itself
// the signal they turned it on to avoid giving.
func TestPublicViewHidesPrivacySettings(t *testing.T) {
	u := &User{
		Username:           "ana",
		DisplayName:        "Ana",
		AvatarURI:          "https://example.test/a.png",
		LastSeenVisibility: VisEveryone,
		PhotoVisibility:    VisEveryone,
		ReadReceipts:       false,
	}

	// Marshalling is the test: the leak was serialisation, not a field read,
	// so inspecting the struct would have missed it entirely.
	raw, err := json.Marshal(u.PublicViewFor(true))
	if err != nil {
		t.Fatalf("marshal: %v", err)
	}

	var got map[string]any
	if err := json.Unmarshal(raw, &got); err != nil {
		t.Fatalf("unmarshal: %v", err)
	}

	// An allowlist, asserted as one. Enumerating the fields that must *not*
	// appear would pass for every setting added after this test was written,
	// which is exactly how the original leak grew: `ghost_mode` and
	// `last_seen_frozen` were added to `User` later and joined the leak
	// without anybody choosing to publish them.
	allowed := map[string]bool{
		"id": true, "username": true, "display_name": true,
		"bio": true, "avatar_uri": true,
	}
	for key := range got {
		if !allowed[key] {
			t.Errorf("public view exposes %q: %s", key, raw)
		}
	}
	for _, expected := range []string{"ana", "Ana", "a.png"} {
		if !strings.Contains(string(raw), expected) {
			t.Errorf("public view dropped %s: %s", expected, raw)
		}
	}
}

// TestPhotoVisibilityIsEnforced: the setting existed since 0029 and was read
// by nothing. Choosing "nobody" left the avatar being served to everybody.
func TestPhotoVisibilityIsEnforced(t *testing.T) {
	withPhoto := func(v Visibility) *User {
		return &User{Username: "ana", AvatarURI: "https://example.test/a.png", PhotoVisibility: v}
	}

	cases := []struct {
		name  string
		vis   Visibility
		share bool
		want  bool // avatar visible
	}{
		{"everyone, stranger", VisEveryone, false, true},
		{"nobody, even a contact", VisNobody, true, false},
		{"contacts, sharing a chat", VisContacts, true, true},
		{"contacts, no chat shared", VisContacts, false, false},
	}

	for _, c := range cases {
		got := withPhoto(c.vis).PublicViewFor(c.share).AvatarURI != ""
		if got != c.want {
			t.Errorf("%s: avatar visible = %v, want %v", c.name, got, c.want)
		}
	}
}

// The name, unlike the photo, is not hidden by photo_visibility. Someone who
// hid their picture is still findable by the username they made public —
// silently hiding the name too would break search for a setting that never
// claimed to touch it.
func TestPhotoVisibilityDoesNotHideTheName(t *testing.T) {
	u := &User{Username: "ana", DisplayName: "Ana", PhotoVisibility: VisNobody}
	view := u.PublicViewFor(false)
	if view.Username != "ana" || view.DisplayName != "Ana" {
		t.Fatalf("hiding a photo hid the person: %+v", view)
	}
}
