package lives

import (
	"testing"

	"github.com/livekit/protocol/auth"

	"github.com/CreadorLanda/zwosocial/server/internal/platform/livekit"
)

// assertPublish opens the token and checks the one claim that separates a
// broadcaster from an audience.
//
// Read from the signed JWT rather than from the Grant, because the JWT is what
// the SFU reads. A struct field saying "viewer" while the token says otherwise
// is precisely the bug this guards against.
func assertPublish(t *testing.T, token string, want bool, who string) {
	t.Helper()
	verifier, err := auth.ParseAPIToken(token)
	if err != nil {
		t.Fatalf("parse %s token: %v", who, err)
	}
	_, claims, err := verifier.Verify(testSecret)
	if err != nil {
		t.Fatalf("verify %s token: %v", who, err)
	}
	v := claims.Video
	got := v.CanPublish != nil && *v.CanPublish
	if got != want {
		t.Fatalf("%s CanPublish = %v, want %v", who, got, want)
	}
	if !v.RoomJoin {
		t.Fatalf("%s token does not grant joining the room it names", who)
	}
	// Administration stays on the server for everyone. A participant who could
	// create rooms or evict others would be an admin of every broadcast they
	// open.
	if v.RoomAdmin || v.RoomCreate || v.RoomList {
		t.Fatalf("%s token carries admin rights: admin=%v create=%v list=%v",
			who, v.RoomAdmin, v.RoomCreate, v.RoomList)
	}
}

// TestTokenIsShortLived: the token is fetched immediately before joining, so
// it has no reason to outlive that. A long one sits in every log the request
// passed through, still valid.
func TestTokenIsShortLived(t *testing.T) {
	if livekit.TTL.Minutes() > 15 {
		t.Fatalf("TTL is %v — too long for a join credential", livekit.TTL)
	}
}

// TestRolesAreWhatTheySay guards the two package-level roles. They are the
// entire access model of a broadcast, and a stray edit to either is silent.
func TestRolesAreWhatTheySay(t *testing.T) {
	if !livekit.Broadcaster.Publish {
		t.Fatal("a broadcaster cannot publish")
	}
	if livekit.Viewer.Publish {
		t.Fatal("a viewer can publish — the audience can appear in the broadcast")
	}
	if !livekit.Viewer.Subscribe {
		t.Fatal("a viewer cannot receive anything")
	}
}
