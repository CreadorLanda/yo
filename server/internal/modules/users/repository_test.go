package users

import (
	"context"
	"encoding/json"
	"testing"
)

// TestCanSeePresence is the whole privacy contract for presence in one
// table: three gates, two of which are the *viewer's* own doing.
//
// It is a pure function precisely so this can be exhaustive without a
// database — the parts that need one are covered separately.
func TestCanSeePresence(t *testing.T) {
	plain := func() *User { return &User{LastSeenVisibility: VisEveryone} }

	cases := []struct {
		name   string
		viewer *User
		subj   *User
		share  bool
		want   bool
	}{
		{"strangers, everyone", plain(), plain(), false, true},
		{"nobody hides from all", plain(), &User{LastSeenVisibility: VisNobody}, true, false},
		{"contacts, sharing a chat", plain(), &User{LastSeenVisibility: VisContacts}, true, true},
		{"contacts, no chat shared", plain(), &User{LastSeenVisibility: VisContacts}, false, false},
		{"ghost leaves no trace", plain(), &User{LastSeenVisibility: VisEveryone, GhostMode: true}, true, false},

		// Reciprocity — the viewer's own settings closing the door on them.
		{
			"frozen viewer sees nobody",
			&User{LastSeenVisibility: VisEveryone, LastSeenFrozen: true}, plain(), true, false,
		},
		{
			"ghost viewer sees nobody",
			&User{LastSeenVisibility: VisEveryone, GhostMode: true}, plain(), true, false,
		},
		// Premium buys the exception, and only this one.
		{
			"premium frozen viewer still sees",
			&User{LastSeenVisibility: VisEveryone, LastSeenFrozen: true, IsPremium: true}, plain(), true, true,
		},
		// But it does not buy past someone else's choice to hide.
		{
			"premium does not override the subject",
			&User{LastSeenVisibility: VisEveryone, LastSeenFrozen: true, IsPremium: true},
			&User{LastSeenVisibility: VisNobody}, true, false,
		},
		{
			"premium does not override ghost",
			&User{LastSeenVisibility: VisEveryone, LastSeenFrozen: true, IsPremium: true},
			&User{LastSeenVisibility: VisEveryone, GhostMode: true}, true, false,
		},

		{"nil viewer", nil, plain(), true, false},
		{"nil subject", plain(), nil, true, false},
	}

	for _, c := range cases {
		if got := CanSeePresence(c.viewer, c.subj, c.share); got != c.want {
			t.Errorf("%s: got %v, want %v", c.name, got, c.want)
		}
	}
}

// TestTouchLastSeenRespectsFreeze is the other half, and it needs the
// database because the freeze is enforced in the WHERE clause — the point
// being that no caller can forget to apply it.
func TestTouchLastSeenRespectsFreeze(t *testing.T) {
	pool := deleteDB(t)
	ctx := context.Background()
	repo := NewRepository(pool)

	id := mkUser(t, pool)

	if err := repo.TouchLastSeen(ctx, id); err != nil {
		t.Fatalf("TouchLastSeen: %v", err)
	}
	u, err := repo.ByID(ctx, id)
	if err != nil {
		t.Fatalf("ByID: %v", err)
	}
	if u.LastSeenAt == nil {
		t.Fatal("last seen not recorded")
	}
	first := *u.LastSeenAt

	// Freeze, then be seen again. The stored moment must not move.
	on := true
	if _, err := repo.Patch(ctx, id, PatchRequest{LastSeenFrozen: &on}); err != nil {
		t.Fatalf("patch: %v", err)
	}
	if err := repo.TouchLastSeen(ctx, id); err != nil {
		t.Fatalf("TouchLastSeen(frozen): %v", err)
	}
	u, err = repo.ByID(ctx, id)
	if err != nil {
		t.Fatalf("ByID: %v", err)
	}
	if !u.LastSeenAt.Equal(first) {
		t.Fatalf("a frozen last seen moved: %v -> %v", first, *u.LastSeenAt)
	}

	// Unfreeze and it starts moving again.
	off := false
	if _, err := repo.Patch(ctx, id, PatchRequest{LastSeenFrozen: &off}); err != nil {
		t.Fatalf("patch off: %v", err)
	}
	if err := repo.TouchLastSeen(ctx, id); err != nil {
		t.Fatalf("TouchLastSeen(thawed): %v", err)
	}
	u, _ = repo.ByID(ctx, id)
	if u.LastSeenAt.Equal(first) {
		t.Fatal("last seen stayed frozen after being turned off")
	}
}

// TestPremiumIsNotPatchable: the entitlement that buys the exception to
// reciprocity cannot be granted by the client that benefits from it.
func TestPremiumIsNotPatchable(t *testing.T) {
	pool := deleteDB(t)
	ctx := context.Background()
	repo := NewRepository(pool)

	id := mkUser(t, pool)

	// There is no PatchRequest field for it — this test exists so that
	// adding one is a deliberate act with a failing test attached, rather
	// than a convenience someone adds while wiring a settings screen.
	raw, err := json.Marshal(map[string]any{"is_premium": true})
	if err != nil {
		t.Fatal(err)
	}
	var p PatchRequest
	if err := json.Unmarshal(raw, &p); err != nil {
		t.Fatalf("unmarshal: %v", err)
	}
	if _, err := repo.Patch(ctx, id, p); err != nil {
		t.Fatalf("patch: %v", err)
	}
	u, err := repo.ByID(ctx, id)
	if err != nil {
		t.Fatalf("ByID: %v", err)
	}
	if u.IsPremium {
		t.Fatal("a client granted itself premium through PATCH /users/me")
	}
}
