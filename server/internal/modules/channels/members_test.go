package channels

import (
	"context"
	"errors"
	"os"
	"strings"
	"testing"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/CreadorLanda/zwosocial/server/internal/platform/postgres"
)

func testDB(t *testing.T) *pgxpool.Pool {
	t.Helper()
	url := os.Getenv("TEST_POSTGRES_URL")
	if url == "" {
		t.Skip("TEST_POSTGRES_URL not set — skipping integration test (see make docker-up-local)")
	}
	pool, err := postgres.Open(context.Background(), url)
	if err != nil {
		t.Fatalf("open test db: %v", err)
	}
	t.Cleanup(pool.Close)
	return pool
}

func createUser(t *testing.T, pool *pgxpool.Pool, username string) uuid.UUID {
	t.Helper()
	var id uuid.UUID
	err := pool.QueryRow(context.Background(), `
		INSERT INTO users (phone_hash, username, display_name)
		VALUES (gen_random_bytes(32), $1, $1) RETURNING id
	`, username).Scan(&id)
	if err != nil {
		t.Fatalf("create user %q: %v", username, err)
	}
	t.Cleanup(func() {
		pool.Exec(context.Background(), `DELETE FROM users WHERE id = $1`, id)
	})
	return id
}

// join puts someone in a channel as a plain member, the way following does.
func join(t *testing.T, svc *Service, ch, user uuid.UUID) {
	t.Helper()
	if _, err := svc.Follow(context.Background(), ch, user); err != nil {
		t.Fatalf("follow: %v", err)
	}
}

// TestMemberRolesRespectHierarchy is where the rules live, and each one
// exists because the alternative is someone losing a channel they built.
func TestMemberRolesRespectHierarchy(t *testing.T) {
	pool := testDB(t)
	ctx := context.Background()
	svc := NewService(NewRepository(pool))

	owner := createUser(t, pool, "owner_"+uuid.NewString()[:8])
	admin := createUser(t, pool, "admin_"+uuid.NewString()[:8])
	admin2 := createUser(t, pool, "admin2_"+uuid.NewString()[:8])
	member := createUser(t, pool, "member_"+uuid.NewString()[:8])
	outsider := createUser(t, pool, "out_"+uuid.NewString()[:8])

	ch, err := svc.Create(ctx, owner, CreateChannelRequest{
		Name: "Canal", Handle: "canal_" + uuid.NewString()[:8],
	})
	if err != nil {
		t.Fatalf("Create: %v", err)
	}

	join(t, svc, ch.ID, admin)
	join(t, svc, ch.ID, admin2)
	join(t, svc, ch.ID, member)

	// Only the owner shows, because nobody has been promoted yet — plain
	// followers are not part of this list.
	list, err := svc.Members(ctx, ch.ID, owner)
	if err != nil {
		t.Fatalf("Members: %v", err)
	}
	if len(list) != 1 || list[0].UserID != owner || list[0].Role != RoleOwner {
		t.Fatalf("expected just the owner, got %+v", list)
	}

	// Promotion works, and shows up in the ordering.
	if err := svc.SetMemberRole(ctx, ch.ID, owner, admin, RoleAdmin); err != nil {
		t.Fatalf("promote to admin: %v", err)
	}
	if err := svc.SetMemberRole(ctx, ch.ID, owner, admin2, RoleAdmin); err != nil {
		t.Fatalf("promote second admin: %v", err)
	}
	list, _ = svc.Members(ctx, ch.ID, owner)
	if len(list) != 3 || list[1].Role != RoleAdmin || list[2].Role != RoleAdmin {
		t.Fatalf("admins not sorted after owner: %+v", list)
	}
	// The plain follower is still absent.
	for _, m := range list {
		if m.UserID == member {
			t.Fatal("a follower appeared in the manager list")
		}
	}

	// Nobody may edit the owner's role — not even an admin.
	if err := svc.SetMemberRole(ctx, ch.ID, admin, owner, RoleMember); !errors.Is(err, ErrCannotDemote) {
		t.Fatalf("admin demoting the owner: got %v, want ErrCannotDemote", err)
	}

	// Admins are peers: one may not strip another. Only the owner may.
	if err := svc.SetMemberRole(ctx, ch.ID, admin, admin2, RoleMember); !errors.Is(err, ErrForbidden) {
		t.Fatalf("admin demoting a peer: got %v, want ErrForbidden", err)
	}
	if err := svc.SetMemberRole(ctx, ch.ID, owner, admin2, RoleMember); err != nil {
		t.Fatalf("owner demoting an admin: %v", err)
	}

	// You cannot change your own role in either direction.
	if err := svc.SetMemberRole(ctx, ch.ID, admin, admin, RoleMember); !errors.Is(err, ErrSelfRole) {
		t.Fatalf("self demotion: got %v, want ErrSelfRole", err)
	}

	// Owner is not an assignable role: transferring a channel is a separate
	// act, not one tap inside a role picker.
	if err := svc.SetMemberRole(ctx, ch.ID, owner, member, RoleOwner); !errors.Is(err, ErrInvalidRole) {
		t.Fatalf("assigning owner: got %v, want ErrInvalidRole", err)
	}

	// A plain member manages nothing.
	if err := svc.SetMemberRole(ctx, ch.ID, member, admin, RoleMember); !errors.Is(err, ErrForbidden) {
		t.Fatalf("member promoting: got %v, want ErrForbidden", err)
	}
	// Nor does someone who is not in the channel.
	if err := svc.SetMemberRole(ctx, ch.ID, outsider, member, RolePublisher); !errors.Is(err, ErrForbidden) {
		t.Fatalf("outsider promoting: got %v, want ErrForbidden", err)
	}
}

func TestRemoveMember(t *testing.T) {
	pool := testDB(t)
	ctx := context.Background()
	svc := NewService(NewRepository(pool))

	owner := createUser(t, pool, "owner_"+uuid.NewString()[:8])
	admin := createUser(t, pool, "admin_"+uuid.NewString()[:8])
	member := createUser(t, pool, "member_"+uuid.NewString()[:8])

	ch, err := svc.Create(ctx, owner, CreateChannelRequest{
		Name: "Canal", Handle: "canal_" + uuid.NewString()[:8],
	})
	if err != nil {
		t.Fatalf("Create: %v", err)
	}
	join(t, svc, ch.ID, admin)
	join(t, svc, ch.ID, member)
	if err := svc.SetMemberRole(ctx, ch.ID, owner, admin, RoleAdmin); err != nil {
		t.Fatalf("promote: %v", err)
	}

	// An admin may remove a plain member.
	if err := svc.RemoveMember(ctx, ch.ID, admin, member); err != nil {
		t.Fatalf("admin removing a member: %v", err)
	}
	list, _ := svc.Members(ctx, ch.ID, owner)
	if len(list) != 2 {
		t.Fatalf("expected 2 left, got %d", len(list))
	}

	// But not the owner, and not themselves.
	if err := svc.RemoveMember(ctx, ch.ID, admin, owner); !errors.Is(err, ErrCannotDemote) {
		t.Fatalf("removing the owner: got %v, want ErrCannotDemote", err)
	}
	if err := svc.RemoveMember(ctx, ch.ID, admin, admin); !errors.Is(err, ErrSelfRole) {
		t.Fatalf("removing yourself: got %v, want ErrSelfRole", err)
	}

	// Someone who was never there.
	ghost := createUser(t, pool, "ghost_"+uuid.NewString()[:8])
	if err := svc.RemoveMember(ctx, ch.ID, owner, ghost); !errors.Is(err, ErrMemberNotFound) {
		t.Fatalf("removing a non-member: got %v, want ErrMemberNotFound", err)
	}
}

// TestPostMutationPermissions: who may edit or delete a channel post.
//
// Edit and delete share one rule on purpose — two copies of a permission
// check drift, and the direction they drift in is always "more allowed".
func TestPostMutationPermissions(t *testing.T) {
	pool := testDB(t)
	ctx := context.Background()
	svc := NewService(NewRepository(pool))

	owner := createUser(t, pool, "owner_"+uuid.NewString()[:8])
	admin := createUser(t, pool, "admin_"+uuid.NewString()[:8])
	author := createUser(t, pool, "author_"+uuid.NewString()[:8])
	stranger := createUser(t, pool, "stranger_"+uuid.NewString()[:8])

	ch, err := svc.Create(ctx, owner, CreateChannelRequest{
		Name: "Canal", Handle: "canal_" + uuid.NewString()[:8],
		// Publishers must be able to post, or there is no non-manager author
		// to test the "author edits their own" rule against.
		WhoCanPost: PostPublishers,
	})
	if err != nil {
		t.Fatalf("Create: %v", err)
	}
	join(t, svc, ch.ID, admin)
	join(t, svc, ch.ID, author)
	if err := svc.SetMemberRole(ctx, ch.ID, owner, admin, RoleAdmin); err != nil {
		t.Fatalf("promote: %v", err)
	}
	if err := svc.SetMemberRole(ctx, ch.ID, owner, author, RolePublisher); err != nil {
		t.Fatalf("promote publisher: %v", err)
	}

	newPost := func(by uuid.UUID) Post {
		t.Helper()
		p, err := svc.CreatePost(ctx, ch.ID, by, CreatePostRequest{Text: "original"})
		if err != nil {
			t.Fatalf("CreatePost: %v", err)
		}
		return p
	}

	// The author edits their own.
	p := newPost(author)
	if err := svc.EditPost(ctx, p.ID, author, "corrigido"); err != nil {
		t.Fatalf("author editing own: %v", err)
	}

	// A manager edits anyone's — they answer for what the channel publishes.
	if err := svc.EditPost(ctx, p.ID, admin, "moderado"); err != nil {
		t.Fatalf("admin editing: %v", err)
	}
	if err := svc.EditPost(ctx, p.ID, owner, "do dono"); err != nil {
		t.Fatalf("owner editing: %v", err)
	}

	// Someone who is not in the channel but can see it — this one is public —
	// is refused, plainly. Hiding the post's existence from them would be
	// theatre: they can already read it in the feed.
	if err := svc.EditPost(ctx, p.ID, stranger, "invadido"); !errors.Is(err, ErrForbidden) {
		t.Fatalf("stranger editing a public channel's post: got %v, want ErrForbidden", err)
	}
	if err := svc.DeletePost(ctx, p.ID, stranger); !errors.Is(err, ErrForbidden) {
		t.Fatalf("stranger deleting: got %v, want ErrForbidden", err)
	}

	// Where the channel itself is hidden, the post is reported missing —
	// "forbidden" would confirm that it exists.
	privateCh, err := svc.Create(ctx, owner, CreateChannelRequest{
		Name: "Privado", Handle: "priv_" + uuid.NewString()[:8],
		Visibility: VisPrivate,
	})
	if err != nil {
		t.Fatalf("Create(private): %v", err)
	}
	hidden, err := svc.CreatePost(ctx, privateCh.ID, owner, CreatePostRequest{Text: "segredo"})
	if err != nil {
		t.Fatalf("CreatePost(private): %v", err)
	}
	if err := svc.EditPost(ctx, hidden.ID, stranger, "x"); !errors.Is(err, ErrNotFound) {
		t.Fatalf("stranger editing a hidden post: got %v, want ErrNotFound", err)
	}

	// Emptying a text post is a delete wearing a disguise.
	if err := svc.EditPost(ctx, p.ID, author, "   "); !errors.Is(err, ErrInvalidName) {
		t.Fatalf("emptying a text post: got %v, want ErrInvalidName", err)
	}

	// A plain follower cannot touch someone else's post.
	follower := createUser(t, pool, "follower_"+uuid.NewString()[:8])
	join(t, svc, ch.ID, follower)
	if err := svc.EditPost(ctx, p.ID, follower, "não"); !errors.Is(err, ErrForbidden) {
		t.Fatalf("follower editing: got %v, want ErrForbidden", err)
	}

	// Delete works, and twice is not found rather than a different failure.
	if err := svc.DeletePost(ctx, p.ID, author); err != nil {
		t.Fatalf("author deleting own: %v", err)
	}
	if err := svc.DeletePost(ctx, p.ID, author); !errors.Is(err, ErrNotFound) {
		t.Fatalf("second delete: got %v, want ErrNotFound", err)
	}

	// And a manager can delete a post they did not write.
	q := newPost(author)
	if err := svc.DeletePost(ctx, q.ID, owner); err != nil {
		t.Fatalf("owner deleting another's post: %v", err)
	}
}

// TestMemberListIsManagersOnly pins both halves of the privacy rule: who may
// read the list, and who appears on it.
func TestMemberListIsManagersOnly(t *testing.T) {
	pool := testDB(t)
	ctx := context.Background()
	svc := NewService(NewRepository(pool))

	owner := createUser(t, pool, "owner_"+uuid.NewString()[:8])
	admin := createUser(t, pool, "admin_"+uuid.NewString()[:8])
	publisher := createUser(t, pool, "pub_"+uuid.NewString()[:8])
	follower := createUser(t, pool, "follower_"+uuid.NewString()[:8])
	outsider := createUser(t, pool, "out_"+uuid.NewString()[:8])

	ch, err := svc.Create(ctx, owner, CreateChannelRequest{
		Name: "Canal", Handle: "canal_" + uuid.NewString()[:8],
	})
	if err != nil {
		t.Fatalf("Create: %v", err)
	}
	join(t, svc, ch.ID, admin)
	join(t, svc, ch.ID, publisher)
	join(t, svc, ch.ID, follower)
	if err := svc.SetMemberRole(ctx, ch.ID, owner, admin, RoleAdmin); err != nil {
		t.Fatalf("promote admin: %v", err)
	}
	if err := svc.SetMemberRole(ctx, ch.ID, owner, publisher, RolePublisher); err != nil {
		t.Fatalf("promote publisher: %v", err)
	}

	// Managers see the management team, and only the management team.
	for _, who := range []uuid.UUID{owner, admin} {
		list, err := svc.Members(ctx, ch.ID, who)
		if err != nil {
			t.Fatalf("Members(%s): %v", who, err)
		}
		if len(list) != 3 {
			t.Fatalf("expected owner+admin+publisher, got %d: %+v", len(list), list)
		}
		for _, m := range list {
			if m.UserID == follower {
				t.Fatal("a follower leaked into the manager list")
			}
		}
	}

	// A publisher can post but does not manage, so the list is closed to them.
	if _, err := svc.Members(ctx, ch.ID, publisher); !errors.Is(err, ErrForbidden) {
		t.Fatalf("publisher reading the list: got %v, want ErrForbidden", err)
	}
	// And so is it to a follower and to a stranger.
	if _, err := svc.Members(ctx, ch.ID, follower); !errors.Is(err, ErrForbidden) {
		t.Fatalf("follower reading the list: got %v, want ErrForbidden", err)
	}
	if _, err := svc.Members(ctx, ch.ID, outsider); !errors.Is(err, ErrForbidden) {
		t.Fatalf("outsider reading the list: got %v, want ErrForbidden", err)
	}
}

// TestAddMemberByUsername covers the path that replaced browsing a follower
// list: naming someone directly.
func TestAddMemberByUsername(t *testing.T) {
	pool := testDB(t)
	ctx := context.Background()
	svc := NewService(NewRepository(pool))

	ownerName := "owner_" + uuid.NewString()[:8]
	adminName := "admin_" + uuid.NewString()[:8]
	pubName := "pub_" + uuid.NewString()[:8]
	strangerName := "stranger_" + uuid.NewString()[:8]

	owner := createUser(t, pool, ownerName)
	admin := createUser(t, pool, adminName)
	createUser(t, pool, pubName)
	stranger := createUser(t, pool, strangerName)

	ch, err := svc.Create(ctx, owner, CreateChannelRequest{
		Name: "Canal", Handle: "canal_" + uuid.NewString()[:8],
	})
	if err != nil {
		t.Fatalf("Create: %v", err)
	}

	// A publisher is invited, not granted — the role waits on them.
	if _, err := svc.AddMemberByUsername(ctx, ch.ID, owner, pubName, RolePublisher); !errors.Is(err, ErrInvitePending) {
		t.Fatalf("add publisher: got %v, want ErrInvitePending", err)
	}
	// And nothing has changed on the channel yet.
	if list, _ := svc.Members(ctx, ch.ID, owner); len(list) != 1 {
		t.Fatalf("an invitation granted the role immediately: %+v", list)
	}

	// Plain membership needs no agreement — that is just following.
	m, err := svc.AddMemberByUsername(ctx, ch.ID, owner, pubName, RoleMember)
	if err != nil {
		t.Fatalf("add member: %v", err)
	}
	if m.Role != RoleMember {
		t.Fatalf("role not applied: %+v", m)
	}
	// And now they are a plain member, so they drop off the manager list.
	list, _ := svc.Members(ctx, ch.ID, owner)
	for _, x := range list {
		if x.Username == pubName {
			t.Fatal("a plain member stayed on the manager list")
		}
	}

	// Handles are matched case-insensitively and with the @ stripped.
	if _, err := svc.AddMemberByUsername(ctx, ch.ID, owner, "@"+strings.ToUpper(pubName), RoleMember); err != nil {
		t.Fatalf("decorated handle: %v", err)
	}

	// Only the owner may invite an admin. The check happens before the
	// invitation is created, so a refused attempt leaves nothing behind.
	if _, err := svc.AddMemberByUsername(ctx, ch.ID, owner, adminName, RoleAdmin); !errors.Is(err, ErrInvitePending) {
		t.Fatalf("owner inviting an admin: got %v, want ErrInvitePending", err)
	}
	// The invited admin has not accepted, so they are not in the channel at
	// all. Join and promote directly to get a real admin for the rest.
	join(t, svc, ch.ID, admin)
	if err := svc.SetMemberRole(ctx, ch.ID, owner, admin, RoleAdmin); err != nil {
		t.Fatalf("promote admin: %v", err)
	}
	if _, err := svc.AddMemberByUsername(ctx, ch.ID, admin, strangerName, RoleAdmin); !errors.Is(err, ErrForbidden) {
		t.Fatalf("admin inviting an admin: got %v, want ErrForbidden", err)
	}
	// But an admin may invite a publisher.
	if _, err := svc.AddMemberByUsername(ctx, ch.ID, admin, strangerName, RolePublisher); !errors.Is(err, ErrInvitePending) {
		t.Fatalf("admin inviting a publisher: got %v, want ErrInvitePending", err)
	}

	// An unknown handle is reported the same as a member that does not
	// exist — this endpoint is not a way to probe which usernames are taken.
	if _, err := svc.AddMemberByUsername(ctx, ch.ID, owner, "nobody_"+uuid.NewString()[:8], RoleMember); !errors.Is(err, ErrMemberNotFound) {
		t.Fatalf("unknown handle: got %v, want ErrMemberNotFound", err)
	}
	// Owner is not assignable here either.
	if _, err := svc.AddMemberByUsername(ctx, ch.ID, owner, pubName, RoleOwner); !errors.Is(err, ErrInvalidRole) {
		t.Fatalf("assigning owner: got %v, want ErrInvalidRole", err)
	}
	// You cannot add yourself.
	if _, err := svc.AddMemberByUsername(ctx, ch.ID, owner, ownerName, RoleAdmin); !errors.Is(err, ErrSelfRole) {
		t.Fatalf("adding yourself: got %v, want ErrSelfRole", err)
	}
	// And a stranger manages nothing.
	if _, err := svc.AddMemberByUsername(ctx, ch.ID, stranger, pubName, RoleMember); !errors.Is(err, ErrForbidden) {
		t.Fatalf("stranger adding: got %v, want ErrForbidden", err)
	}
}

// TestRoleInviteFlow covers the whole exchange: a request is made, it grants
// nothing on its own, and the person decides.
func TestRoleInviteFlow(t *testing.T) {
	pool := testDB(t)
	ctx := context.Background()
	svc := NewService(NewRepository(pool))

	ownerName := "owner_" + uuid.NewString()[:8]
	inviteeName := "invitee_" + uuid.NewString()[:8]
	owner := createUser(t, pool, ownerName)
	invitee := createUser(t, pool, inviteeName)
	outsider := createUser(t, pool, "out_"+uuid.NewString()[:8])

	ch, err := svc.Create(ctx, owner, CreateChannelRequest{
		Name: "Canal", Handle: "canal_" + uuid.NewString()[:8],
	})
	if err != nil {
		t.Fatalf("Create: %v", err)
	}

	// Nobody starts with pending requests.
	if list, _ := svc.PendingInvites(ctx, invitee); len(list) != 0 {
		t.Fatalf("unexpected invites: %+v", list)
	}

	if _, err := svc.AddMemberByUsername(ctx, ch.ID, owner, inviteeName, RoleAdmin); !errors.Is(err, ErrInvitePending) {
		t.Fatalf("invite: got %v, want ErrInvitePending", err)
	}

	// It shows up for the invitee, with enough to decide on.
	list, err := svc.PendingInvites(ctx, invitee)
	if err != nil {
		t.Fatalf("PendingInvites: %v", err)
	}
	if len(list) != 1 {
		t.Fatalf("expected one invite, got %d", len(list))
	}
	inv := list[0]
	if inv.Role != RoleAdmin || inv.ChannelID != ch.ID {
		t.Fatalf("wrong invite: %+v", inv)
	}
	if inv.InvitedByUser != ownerName {
		t.Fatalf("inviter not named: %+v", inv)
	}
	if inv.ChannelName == "" {
		t.Fatal("channel not described")
	}

	// And on nobody else's list.
	if l, _ := svc.PendingInvites(ctx, outsider); len(l) != 0 {
		t.Fatalf("invite leaked to an outsider: %+v", l)
	}

	// It has granted nothing yet.
	members, _ := svc.Members(ctx, ch.ID, owner)
	for _, m := range members {
		if m.UserID == invitee {
			t.Fatal("the role was granted before acceptance")
		}
	}

	// Only the person it was sent to may act on it.
	if _, err := svc.AcceptInvite(ctx, inv.ID, outsider); !errors.Is(err, ErrInviteNotFound) {
		t.Fatalf("outsider accepting: got %v, want ErrInviteNotFound", err)
	}
	if err := svc.DeclineInvite(ctx, inv.ID, outsider); !errors.Is(err, ErrInviteNotFound) {
		t.Fatalf("outsider declining: got %v, want ErrInviteNotFound", err)
	}

	// Accepting grants exactly the role that was offered.
	chID, err := svc.AcceptInvite(ctx, inv.ID, invitee)
	if err != nil {
		t.Fatalf("AcceptInvite: %v", err)
	}
	if chID != ch.ID {
		t.Fatalf("wrong channel returned: %s", chID)
	}
	members, _ = svc.Members(ctx, ch.ID, owner)
	var found bool
	for _, m := range members {
		if m.UserID == invitee {
			found = m.Role == RoleAdmin
		}
	}
	if !found {
		t.Fatalf("role not granted after acceptance: %+v", members)
	}

	// The request is consumed, not left lying around.
	if l, _ := svc.PendingInvites(ctx, invitee); len(l) != 0 {
		t.Fatalf("invite survived acceptance: %+v", l)
	}
	if _, err := svc.AcceptInvite(ctx, inv.ID, invitee); !errors.Is(err, ErrInviteNotFound) {
		t.Fatalf("second accept: got %v, want ErrInviteNotFound", err)
	}
}

// TestRoleInviteDecline: refusing leaves nothing behind, and does not put the
// person in the channel.
func TestRoleInviteDecline(t *testing.T) {
	pool := testDB(t)
	ctx := context.Background()
	svc := NewService(NewRepository(pool))

	owner := createUser(t, pool, "owner_"+uuid.NewString()[:8])
	inviteeName := "invitee_" + uuid.NewString()[:8]
	invitee := createUser(t, pool, inviteeName)

	ch, _ := svc.Create(ctx, owner, CreateChannelRequest{
		Name: "Canal", Handle: "canal_" + uuid.NewString()[:8],
	})
	if _, err := svc.AddMemberByUsername(ctx, ch.ID, owner, inviteeName, RolePublisher); !errors.Is(err, ErrInvitePending) {
		t.Fatalf("invite: %v", err)
	}
	list, _ := svc.PendingInvites(ctx, invitee)
	if err := svc.DeclineInvite(ctx, list[0].ID, invitee); err != nil {
		t.Fatalf("DeclineInvite: %v", err)
	}

	if l, _ := svc.PendingInvites(ctx, invitee); len(l) != 0 {
		t.Fatalf("declined invite still listed: %+v", l)
	}
	members, _ := svc.Members(ctx, ch.ID, owner)
	for _, m := range members {
		if m.UserID == invitee {
			t.Fatal("declining put them in the channel anyway")
		}
	}

	// Re-inviting after a refusal is allowed — a "no" is about this request,
	// not a permanent block — and replaces rather than stacks.
	if _, err := svc.AddMemberByUsername(ctx, ch.ID, owner, inviteeName, RoleAdmin); !errors.Is(err, ErrInvitePending) {
		t.Fatalf("re-invite: %v", err)
	}
	if _, err := svc.AddMemberByUsername(ctx, ch.ID, owner, inviteeName, RolePublisher); !errors.Is(err, ErrInvitePending) {
		t.Fatalf("re-invite again: %v", err)
	}
	l, _ := svc.PendingInvites(ctx, invitee)
	if len(l) != 1 {
		t.Fatalf("invitations stacked: %d", len(l))
	}
	if l[0].Role != RolePublisher {
		t.Fatalf("role not replaced: %+v", l[0])
	}
}
