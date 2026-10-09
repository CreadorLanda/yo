package lives

import (
	"context"
	"errors"
	"os"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/CreadorLanda/zwosocial/server/internal/platform/livekit"
	"github.com/CreadorLanda/zwosocial/server/internal/platform/postgres"
)

const (
	testKey    = "devkey"
	testSecret = "a-secret-long-enough-to-sign-with"
)

func liveDB(t *testing.T) *pgxpool.Pool {
	t.Helper()
	url := os.Getenv("TEST_POSTGRES_URL")
	if url == "" {
		t.Skip("TEST_POSTGRES_URL not set — skipping integration test")
	}
	pool, err := postgres.Open(context.Background(), url)
	if err != nil {
		t.Fatalf("open test db: %v", err)
	}
	t.Cleanup(pool.Close)
	return pool
}

func mkUser(t *testing.T, pool *pgxpool.Pool) uuid.UUID {
	t.Helper()
	var id uuid.UUID
	name := "live_" + uuid.NewString()[:8]
	if err := pool.QueryRow(context.Background(), `
		INSERT INTO users (phone_hash, username, display_name)
		VALUES (gen_random_bytes(32), $1, $1) RETURNING id
	`, name).Scan(&id); err != nil {
		t.Fatalf("create user: %v", err)
	}
	t.Cleanup(func() { pool.Exec(context.Background(), `DELETE FROM users WHERE id = $1`, id) })
	return id
}

func mkChat(t *testing.T, pool *pgxpool.Pool, members ...uuid.UUID) uuid.UUID {
	t.Helper()
	ctx := context.Background()
	var id uuid.UUID
	if err := pool.QueryRow(ctx, `
		INSERT INTO chats (type, created_by, status) VALUES ('group', $1, 'active') RETURNING id
	`, members[0]).Scan(&id); err != nil {
		t.Fatalf("create chat: %v", err)
	}
	for _, m := range members {
		if _, err := pool.Exec(ctx,
			`INSERT INTO chat_participants (chat_id, user_id) VALUES ($1, $2)`, id, m); err != nil {
			t.Fatalf("add participant: %v", err)
		}
	}
	t.Cleanup(func() { pool.Exec(ctx, `DELETE FROM chats WHERE id = $1`, id) })
	return id
}

// ── fakes for the seams ─────────────────────────────────────────────────────

type fakeAudience struct {
	broadcasters map[uuid.UUID]bool
	watchers     map[uuid.UUID]bool
	inChat       map[uuid.UUID]bool
	members      []uuid.UUID
}

func (f fakeAudience) CanBroadcastToChannel(_ context.Context, _, u uuid.UUID) (bool, error) {
	return f.broadcasters[u], nil
}

func (f fakeAudience) CanWatchChannel(_ context.Context, _, u uuid.UUID) (bool, error) {
	return f.watchers[u], nil
}

func (f fakeAudience) InChat(_ context.Context, _, u uuid.UUID) (bool, error) {
	return f.inChat[u], nil
}

func (f fakeAudience) ChatMembers(context.Context, uuid.UUID) ([]uuid.UUID, error) {
	return f.members, nil
}

func (f fakeAudience) ChannelFollowers(context.Context, uuid.UUID) ([]uuid.UUID, error) {
	return f.members, nil
}

type fakeUsers struct{ name string }

func (f fakeUsers) DisplayName(context.Context, uuid.UUID) (string, error) { return f.name, nil }

type fakeAnnouncer struct {
	started, ended int
	lastViewers    int
	viewerCalls    int
}

func (f *fakeAnnouncer) Started(context.Context, []uuid.UUID, Live)    { f.started++ }
func (f *fakeAnnouncer) Ended(context.Context, []uuid.UUID, uuid.UUID) { f.ended++ }
func (f *fakeAnnouncer) Viewers(_ context.Context, _ []uuid.UUID, _ uuid.UUID, n int) {
	f.viewerCalls++
	f.lastViewers = n
}

func newSvc(pool *pgxpool.Pool, aud fakeAudience, ann *fakeAnnouncer) *Service {
	return NewService(
		livekit.NewSigner(livekit.Config{
			URL: "wss://live.example", APIKey: testKey, APISecret: testSecret,
		}),
		NewRepo(pool), aud, fakeUsers{name: "Host"}, ann,
	)
}

// ── the tests ───────────────────────────────────────────────────────────────

// TestViewerCannotPublish is the whole point of a broadcast being a broadcast.
//
// If a viewer's token allowed publishing, an audience member could appear in
// someone else's live by patching the app. The rule has to be in the token the
// SFU checks, not in the screen the client draws.
func TestViewerCannotPublish(t *testing.T) {
	pool := liveDB(t)
	ctx := context.Background()

	host, viewer := mkUser(t, pool), mkUser(t, pool)
	chat := mkChat(t, pool, host, viewer)
	svc := newSvc(pool, fakeAudience{
		inChat:  map[uuid.UUID]bool{host: true, viewer: true},
		members: []uuid.UUID{host, viewer},
	}, &fakeAnnouncer{})

	hostGrant, err := svc.Start(ctx, StartInput{ChatID: &chat, Title: "Test"}, host)
	if err != nil {
		t.Fatalf("Start: %v", err)
	}
	if !hostGrant.Host {
		t.Fatal("the host's own grant does not say host")
	}
	assertPublish(t, hostGrant.Token, true, "host")

	viewerGrant, err := svc.Join(ctx, hostGrant.Live.ID, viewer)
	if err != nil {
		t.Fatalf("Join: %v", err)
	}
	if viewerGrant.Host {
		t.Fatal("a viewer's grant says host")
	}
	assertPublish(t, viewerGrant.Token, false, "viewer")

	// Same room, or they are not at the same broadcast.
	if viewerGrant.Room != hostGrant.Room {
		t.Fatalf("viewer room %q != host room %q", viewerGrant.Room, hostGrant.Room)
	}
}

// TestOutsiderCannotWatch: the audience is a permission, not a link.
func TestOutsiderCannotWatch(t *testing.T) {
	pool := liveDB(t)
	ctx := context.Background()

	host, outsider := mkUser(t, pool), mkUser(t, pool)
	chat := mkChat(t, pool, host)
	svc := newSvc(pool, fakeAudience{
		inChat:  map[uuid.UUID]bool{host: true},
		members: []uuid.UUID{host},
	}, &fakeAnnouncer{})

	grant, err := svc.Start(ctx, StartInput{ChatID: &chat}, host)
	if err != nil {
		t.Fatalf("Start: %v", err)
	}
	if _, err := svc.Join(ctx, grant.Live.ID, outsider); !errors.Is(err, ErrNotAllowed) {
		t.Fatalf("Join(outsider) = %v, want ErrNotAllowed", err)
	}
}

// TestCannotBroadcastWhereYouMayNotPost: starting a live is the same
// permission as posting. A channel that will not take your words will not take
// your face either.
func TestCannotBroadcastWhereYouMayNotPost(t *testing.T) {
	pool := liveDB(t)
	ctx := context.Background()

	stranger := mkUser(t, pool)
	channelID := uuid.New()
	svc := newSvc(pool, fakeAudience{broadcasters: map[uuid.UUID]bool{}}, &fakeAnnouncer{})

	if _, err := svc.Start(ctx, StartInput{ChannelID: &channelID}, stranger); !errors.Is(err, ErrNotAllowed) {
		t.Fatalf("Start = %v, want ErrNotAllowed", err)
	}
}

// TestOneBroadcastPerPlace: two people pressing "go live" in the same group at
// the same moment must not produce two broadcasts. The audience can only be in
// one of them, and would split without knowing it.
func TestOneBroadcastPerPlace(t *testing.T) {
	pool := liveDB(t)
	ctx := context.Background()

	alice, bob := mkUser(t, pool), mkUser(t, pool)
	chat := mkChat(t, pool, alice, bob)
	svc := newSvc(pool, fakeAudience{
		inChat:  map[uuid.UUID]bool{alice: true, bob: true},
		members: []uuid.UUID{alice, bob},
	}, &fakeAnnouncer{})

	if _, err := svc.Start(ctx, StartInput{ChatID: &chat}, alice); err != nil {
		t.Fatalf("first Start: %v", err)
	}
	if _, err := svc.Start(ctx, StartInput{ChatID: &chat}, bob); !errors.Is(err, ErrAlreadyLive) {
		t.Fatalf("second Start = %v, want ErrAlreadyLive", err)
	}
}

// TestViewerCountIsReal covers the number the old UI made up.
//
// `liveViewers` was a field the client wrote on its own optimistic post and
// the server never saw. This one is counted from rows.
func TestViewerCountIsReal(t *testing.T) {
	pool := liveDB(t)
	ctx := context.Background()

	host, a, b := mkUser(t, pool), mkUser(t, pool), mkUser(t, pool)
	chat := mkChat(t, pool, host, a, b)
	ann := &fakeAnnouncer{}
	svc := newSvc(pool, fakeAudience{
		inChat:  map[uuid.UUID]bool{host: true, a: true, b: true},
		members: []uuid.UUID{host, a, b},
	}, ann)

	grant, err := svc.Start(ctx, StartInput{ChatID: &chat}, host)
	if err != nil {
		t.Fatalf("Start: %v", err)
	}
	live := grant.Live.ID

	// The host is not an audience member. "1 watching" on an empty broadcast
	// is the number they are looking at hardest.
	if grant.Live.Viewers != 0 {
		t.Fatalf("a broadcast with nobody in it reports %d viewers", grant.Live.Viewers)
	}

	g1, _ := svc.Join(ctx, live, a)
	if g1.Live.Viewers != 1 {
		t.Fatalf("after one viewer: %d", g1.Live.Viewers)
	}
	g2, _ := svc.Join(ctx, live, b)
	if g2.Live.Viewers != 2 {
		t.Fatalf("after two viewers: %d", g2.Live.Viewers)
	}

	// Rejoining is the same person. A dropped connection must not inflate it.
	g1again, _ := svc.Join(ctx, live, a)
	if g1again.Live.Viewers != 2 {
		t.Fatalf("a rejoin counted twice: %d", g1again.Live.Viewers)
	}

	if err := svc.Leave(ctx, live, a); err != nil {
		t.Fatalf("Leave: %v", err)
	}
	if ann.lastViewers != 1 {
		t.Fatalf("after one left, announced %d", ann.lastViewers)
	}

	// The peak survives the broadcast; the live count does not.
	if err := svc.End(ctx, live, host); err != nil {
		t.Fatalf("End: %v", err)
	}
	after, err := NewRepo(pool).Get(ctx, live)
	if err != nil {
		t.Fatalf("Get: %v", err)
	}
	if after.Viewers != 0 {
		t.Fatalf("an ended broadcast still has %d viewers watching", after.Viewers)
	}
	if after.PeakViewers != 2 {
		t.Fatalf("peak = %d, want 2", after.PeakViewers)
	}
	if after.Running() {
		t.Fatal("an ended broadcast still reads as running")
	}
}

// TestOnlyTheHostEnds: a viewer must not be able to end someone's broadcast.
func TestOnlyTheHostEnds(t *testing.T) {
	pool := liveDB(t)
	ctx := context.Background()

	host, viewer := mkUser(t, pool), mkUser(t, pool)
	chat := mkChat(t, pool, host, viewer)
	svc := newSvc(pool, fakeAudience{
		inChat:  map[uuid.UUID]bool{host: true, viewer: true},
		members: []uuid.UUID{host, viewer},
	}, &fakeAnnouncer{})

	grant, _ := svc.Start(ctx, StartInput{ChatID: &chat}, host)
	if err := svc.End(ctx, grant.Live.ID, viewer); !errors.Is(err, ErrNotAllowed) {
		t.Fatalf("End(viewer) = %v, want ErrNotAllowed", err)
	}
	if l, _ := NewRepo(pool).Get(ctx, grant.Live.ID); !l.Running() {
		t.Fatal("a viewer ended the host's broadcast")
	}
}

// TestJoiningAnEndedBroadcastFails: the row survives so the log can show it,
// but there is nothing to join.
func TestJoiningAnEndedBroadcastFails(t *testing.T) {
	pool := liveDB(t)
	ctx := context.Background()

	host, viewer := mkUser(t, pool), mkUser(t, pool)
	chat := mkChat(t, pool, host, viewer)
	svc := newSvc(pool, fakeAudience{
		inChat:  map[uuid.UUID]bool{host: true, viewer: true},
		members: []uuid.UUID{host, viewer},
	}, &fakeAnnouncer{})

	grant, _ := svc.Start(ctx, StartInput{ChatID: &chat}, host)
	if err := svc.End(ctx, grant.Live.ID, host); err != nil {
		t.Fatalf("End: %v", err)
	}
	if _, err := svc.Join(ctx, grant.Live.ID, viewer); !errors.Is(err, ErrNoLive) {
		t.Fatalf("Join(ended) = %v, want ErrNoLive", err)
	}

	// And ending frees the place for the next one.
	if _, err := svc.Start(ctx, StartInput{ChatID: &chat}, host); err != nil {
		t.Fatalf("Start after End: %v", err)
	}
}

// TestHostRejoiningStaysTheHost: they crash, they come back. Returning to your
// own broadcast unable to speak is worse than not returning at all.
func TestHostRejoiningStaysTheHost(t *testing.T) {
	pool := liveDB(t)
	ctx := context.Background()

	host := mkUser(t, pool)
	chat := mkChat(t, pool, host)
	svc := newSvc(pool, fakeAudience{
		inChat: map[uuid.UUID]bool{host: true}, members: []uuid.UUID{host},
	}, &fakeAnnouncer{})

	grant, _ := svc.Start(ctx, StartInput{ChatID: &chat}, host)
	back, err := svc.Join(ctx, grant.Live.ID, host)
	if err != nil {
		t.Fatalf("host Join: %v", err)
	}
	if !back.Host {
		t.Fatal("the host came back as a viewer of their own broadcast")
	}
	assertPublish(t, back.Token, true, "returning host")

	// And they are still not counted as their own audience.
	if back.Live.Viewers != 0 {
		t.Fatalf("the host counts as %d viewers of themselves", back.Live.Viewers)
	}
}

// TestRunningForListsOnlyWhatYouMayWatch.
func TestRunningForListsOnlyWhatYouMayWatch(t *testing.T) {
	pool := liveDB(t)
	ctx := context.Background()
	repo := NewRepo(pool)

	host, member, outsider := mkUser(t, pool), mkUser(t, pool), mkUser(t, pool)
	chat := mkChat(t, pool, host, member)
	if _, err := repo.Start(ctx, StartInput{ChatID: &chat}, host); err != nil {
		t.Fatalf("Start: %v", err)
	}

	mine, err := repo.RunningFor(ctx, member)
	if err != nil {
		t.Fatalf("RunningFor: %v", err)
	}
	if len(mine) != 1 {
		t.Fatalf("a member sees %d broadcasts, want 1", len(mine))
	}

	theirs, err := repo.RunningFor(ctx, outsider)
	if err != nil {
		t.Fatalf("RunningFor: %v", err)
	}
	for _, l := range theirs {
		if l.ChatID != nil && *l.ChatID == chat {
			t.Fatal("an outsider sees a group's broadcast")
		}
	}
}

// TestSweepClosesAbandonedBroadcasts: the host's phone dies and reports
// nothing. Without this the broadcast stays live and offers an empty room —
// exactly the fault calls had.
func TestSweepClosesAbandonedBroadcasts(t *testing.T) {
	pool := liveDB(t)
	ctx := context.Background()
	repo := NewRepo(pool)

	host, viewer := mkUser(t, pool), mkUser(t, pool)
	chat := mkChat(t, pool, host, viewer)
	live, err := repo.Start(ctx, StartInput{ChatID: &chat}, host)
	if err != nil {
		t.Fatalf("Start: %v", err)
	}
	if _, err := repo.Watch(ctx, live.ID, viewer); err != nil {
		t.Fatalf("Watch: %v", err)
	}

	if _, err := pool.Exec(ctx,
		`UPDATE lives SET started_at = NOW() - INTERVAL '8 hours' WHERE id = $1`, live.ID); err != nil {
		t.Fatalf("age the broadcast: %v", err)
	}

	n, err := repo.SweepStale(ctx, 6*time.Hour)
	if err != nil {
		t.Fatalf("SweepStale: %v", err)
	}
	if n == 0 {
		t.Fatal("the sweep closed nothing")
	}

	after, _ := repo.Get(ctx, live.ID)
	if after.Running() {
		t.Fatal("an abandoned broadcast is still live")
	}
	if after.Viewers != 0 {
		t.Fatalf("a swept broadcast still has %d people watching", after.Viewers)
	}
}

// TestDisabledWithoutConfig: no SFU means no broadcast. Handing out a token
// anyway looks like a working feature until the moment it cannot connect.
func TestDisabledWithoutConfig(t *testing.T) {
	pool := liveDB(t)
	ctx := context.Background()

	host := mkUser(t, pool)
	chat := mkChat(t, pool, host)
	svc := NewService(
		livekit.NewSigner(livekit.Config{}),
		NewRepo(pool),
		fakeAudience{inChat: map[uuid.UUID]bool{host: true}},
		fakeUsers{}, &fakeAnnouncer{},
	)
	if _, err := svc.Start(ctx, StartInput{ChatID: &chat}, host); !errors.Is(err, ErrDisabled) {
		t.Fatalf("Start = %v, want ErrDisabled", err)
	}

	// Partial configuration is disabled too: a URL with no signing key produces
	// tokens the SFU rejects.
	partial := NewService(
		livekit.NewSigner(livekit.Config{URL: "wss://live.example"}),
		NewRepo(pool),
		fakeAudience{inChat: map[uuid.UUID]bool{host: true}},
		fakeUsers{}, &fakeAnnouncer{},
	)
	if _, err := partial.Start(ctx, StartInput{ChatID: &chat}, host); !errors.Is(err, ErrDisabled) {
		t.Fatalf("Start(partial) = %v, want ErrDisabled", err)
	}
}
