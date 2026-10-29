package lives

import (
	"context"
	"errors"
	"testing"

	"github.com/google/uuid"
)

type fakeRoom struct {
	publish map[uuid.UUID]bool
	removed []uuid.UUID
}

func (f *fakeRoom) SetPublish(_ context.Context, _, identity string, publish bool) error {
	if f.publish == nil {
		f.publish = map[uuid.UUID]bool{}
	}
	f.publish[uuid.MustParse(identity)] = publish
	return nil
}

func (f *fakeRoom) Remove(_ context.Context, _, identity string) error {
	f.removed = append(f.removed, uuid.MustParse(identity))
	return nil
}

// TestJointLiveBothHost is the feature: a live started in a direct chat has
// two hosts. The other person is invited like a call, and saying no now does
// not lock them out; they can walk in later with full rights.
func TestJointLiveBothHost(t *testing.T) {
	pool := liveDB(t)
	ctx := context.Background()

	a, b := mkUser(t, pool), mkUser(t, pool)
	chat := mkDirectChat(t, pool, a, b)
	ann := &fakeAnnouncer{}
	svc := newSvc(pool, fakeAudience{
		inChat: map[uuid.UUID]bool{a: true, b: true},
		peer:   &b,
	}, ann)

	g, err := svc.Start(ctx, StartInput{ChatID: &chat}, a)
	if err != nil {
		t.Fatalf("Start: %v", err)
	}
	if !g.Live.Joint {
		t.Fatal("a live in a direct chat is not marked joint")
	}
	if len(ann.events["live.cohost_invite"]) != 1 || ann.events["live.cohost_invite"][0][0] != b {
		t.Fatalf("the other person was not invited: %v", ann.events["live.cohost_invite"])
	}

	if err := svc.Respond(ctx, g.Live.ID, b, false); err != nil {
		t.Fatalf("decline: %v", err)
	}
	later, err := svc.Join(ctx, g.Live.ID, b)
	if err != nil {
		t.Fatalf("joining after declining: %v", err)
	}
	if !later.Host || later.Role != "cohost" || !later.Moderator {
		t.Fatalf("co-host joined as %+v", later)
	}
	assertPublish(t, later.Token, true, "co-host")

	if err := svc.End(ctx, g.Live.ID, b); err != nil {
		t.Fatalf("a co-host could not end the joint live: %v", err)
	}
}

// TestSelectedAudience: only the people picked get in, and an invitation is
// how anyone else does.
func TestSelectedAudience(t *testing.T) {
	pool := liveDB(t)
	ctx := context.Background()

	host, picked, other := mkUser(t, pool), mkUser(t, pool), mkUser(t, pool)
	svc := newSvc(pool, fakeAudience{}, &fakeAnnouncer{})

	g, err := svc.Start(ctx, StartInput{Audience: AudienceSelected, Viewers: []uuid.UUID{picked}}, host)
	if err != nil {
		t.Fatalf("Start from Stories: %v", err)
	}
	if g.Live.ChatID != nil || g.Live.ChannelID != nil {
		t.Fatal("a live from Stories got a home")
	}
	if _, err := svc.Join(ctx, g.Live.ID, picked); err != nil {
		t.Fatalf("picked viewer refused: %v", err)
	}
	if _, err := svc.Join(ctx, g.Live.ID, other); !errors.Is(err, ErrNotAllowed) {
		t.Fatalf("someone not picked got in: %v", err)
	}
	if err := svc.Invite(ctx, g.Live.ID, host, []uuid.UUID{other}); err != nil {
		t.Fatalf("Invite: %v", err)
	}
	if _, err := svc.Join(ctx, g.Live.ID, other); err != nil {
		t.Fatalf("invited viewer refused: %v", err)
	}
}

// TestContactsAudience: a contact of the host may watch, a stranger may not.
func TestContactsAudience(t *testing.T) {
	pool := liveDB(t)
	ctx := context.Background()

	host, friend, stranger := mkUser(t, pool), mkUser(t, pool), mkUser(t, pool)
	svc := newSvc(pool, fakeAudience{
		contacts: map[uuid.UUID][]uuid.UUID{host: {friend}},
	}, &fakeAnnouncer{})

	g, err := svc.Start(ctx, StartInput{}, host)
	if err != nil {
		t.Fatalf("Start: %v", err)
	}
	if g.Live.Audience != AudienceContacts {
		t.Fatalf("a live from Stories defaulted to %q", g.Live.Audience)
	}
	if _, err := svc.Join(ctx, g.Live.ID, friend); err != nil {
		t.Fatalf("contact refused: %v", err)
	}
	if _, err := svc.Join(ctx, g.Live.ID, stranger); !errors.Is(err, ErrNotAllowed) {
		t.Fatalf("stranger got in: %v", err)
	}
}

func TestPlaceAudienceNeedsAPlace(t *testing.T) {
	pool := liveDB(t)
	host := mkUser(t, pool)
	svc := newSvc(pool, fakeAudience{}, &fakeAnnouncer{})
	if _, err := svc.Start(context.Background(), StartInput{Audience: AudiencePlace}, host); !errors.Is(err, ErrInvalid) {
		t.Fatalf("place audience without a place: %v", err)
	}
}

// TestBanKeepsThemOut: a ban removes them from the room now and refuses them
// on the way back in. Hosts cannot be banned, and a moderator cannot ban
// another moderator; only a host can.
func TestBanKeepsThemOut(t *testing.T) {
	pool := liveDB(t)
	ctx := context.Background()

	host, mod, mod2, viewer := mkUser(t, pool), mkUser(t, pool), mkUser(t, pool), mkUser(t, pool)
	room := &fakeRoom{}
	svc := newSvc(pool, fakeAudience{}, &fakeAnnouncer{}).WithRoom(room)

	g, err := svc.Start(ctx, StartInput{Audience: AudiencePublic}, host)
	if err != nil {
		t.Fatalf("Start: %v", err)
	}
	id := g.Live.ID
	for _, u := range []uuid.UUID{mod, mod2, viewer} {
		if _, err := svc.Join(ctx, id, u); err != nil {
			t.Fatalf("Join: %v", err)
		}
	}
	for _, m := range []uuid.UUID{mod, mod2} {
		if err := svc.SetModerator(ctx, id, host, m, true); err != nil {
			t.Fatalf("SetModerator: %v", err)
		}
	}
	if err := svc.SetModerator(ctx, id, mod, viewer, true); !errors.Is(err, ErrForbidden) {
		t.Fatalf("a moderator appointed a moderator: %v", err)
	}

	if err := svc.Ban(ctx, id, mod, host); !errors.Is(err, ErrForbidden) {
		t.Fatalf("the host was banned: %v", err)
	}
	if err := svc.Ban(ctx, id, mod, mod2); !errors.Is(err, ErrForbidden) {
		t.Fatalf("a moderator banned a moderator: %v", err)
	}
	if err := svc.Ban(ctx, id, viewer, mod); !errors.Is(err, ErrForbidden) {
		t.Fatalf("a viewer banned someone: %v", err)
	}

	if err := svc.Ban(ctx, id, mod, viewer); err != nil {
		t.Fatalf("Ban: %v", err)
	}
	if len(room.removed) != 1 || room.removed[0] != viewer {
		t.Fatalf("the SFU was not told to remove them: %v", room.removed)
	}
	if _, err := svc.Join(ctx, id, viewer); !errors.Is(err, ErrBanned) {
		t.Fatalf("banned viewer rejoined: %v", err)
	}
	if _, err := svc.Comment(ctx, id, viewer, "hi"); !errors.Is(err, ErrBanned) {
		t.Fatalf("banned viewer commented: %v", err)
	}

	if err := svc.Unban(ctx, id, mod, viewer); err != nil {
		t.Fatalf("Unban: %v", err)
	}
	if _, err := svc.Join(ctx, id, viewer); err != nil {
		t.Fatalf("unbanned viewer refused: %v", err)
	}
}

// TestStage: a raised hand goes straight on when a moderator calls it; anyone
// else is invited and accepts. The right to publish follows in the SFU and in
// the next token.
func TestStage(t *testing.T) {
	pool := liveDB(t)
	ctx := context.Background()

	host, asker, invitee := mkUser(t, pool), mkUser(t, pool), mkUser(t, pool)
	room := &fakeRoom{}
	ann := &fakeAnnouncer{}
	svc := newSvc(pool, fakeAudience{}, ann).WithRoom(room)

	g, err := svc.Start(ctx, StartInput{Audience: AudiencePublic}, host)
	if err != nil {
		t.Fatalf("Start: %v", err)
	}
	id := g.Live.ID
	for _, u := range []uuid.UUID{asker, invitee} {
		if _, err := svc.Join(ctx, id, u); err != nil {
			t.Fatalf("Join: %v", err)
		}
	}

	if err := svc.RequestStage(ctx, id, asker); err != nil {
		t.Fatalf("RequestStage: %v", err)
	}
	if err := svc.InviteToStage(ctx, id, host, asker); err != nil {
		t.Fatalf("accepting a request: %v", err)
	}
	if !room.publish[asker] {
		t.Fatal("the SFU was not told the guest may publish")
	}
	rejoin, err := svc.Join(ctx, id, asker)
	if err != nil {
		t.Fatalf("guest rejoin: %v", err)
	}
	assertPublish(t, rejoin.Token, true, "guest")
	if rejoin.Role != "guest" || rejoin.Host {
		t.Fatalf("guest joined as %+v", rejoin)
	}

	if err := svc.InviteToStage(ctx, id, host, invitee); err != nil {
		t.Fatalf("InviteToStage: %v", err)
	}
	if room.publish[invitee] {
		t.Fatal("an invitation published before it was accepted")
	}
	if len(ann.events["live.stage_invite"]) != 1 {
		t.Fatal("the invitee was not told")
	}
	if err := svc.Respond(ctx, id, invitee, true); err != nil {
		t.Fatalf("Respond: %v", err)
	}
	if !room.publish[invitee] {
		t.Fatal("accepting did not grant publishing")
	}

	if err := svc.RemoveFromStage(ctx, id, host, asker); err != nil {
		t.Fatalf("RemoveFromStage: %v", err)
	}
	if room.publish[asker] {
		t.Fatal("removal did not revoke publishing")
	}
	if err := svc.InviteToStage(ctx, id, asker, invitee); !errors.Is(err, ErrForbidden) {
		t.Fatalf("a viewer called someone on stage: %v", err)
	}
}

// TestComments: they reach the room, can be switched off for viewers but not
// moderators, and only the author or a moderator can take one down.
func TestComments(t *testing.T) {
	pool := liveDB(t)
	ctx := context.Background()

	host, viewer, other := mkUser(t, pool), mkUser(t, pool), mkUser(t, pool)
	ann := &fakeAnnouncer{}
	svc := newSvc(pool, fakeAudience{}, ann)

	g, err := svc.Start(ctx, StartInput{Audience: AudiencePublic}, host)
	if err != nil {
		t.Fatalf("Start: %v", err)
	}
	id := g.Live.ID
	for _, u := range []uuid.UUID{viewer, other} {
		if _, err := svc.Join(ctx, id, u); err != nil {
			t.Fatalf("Join: %v", err)
		}
	}

	c, err := svc.Comment(ctx, id, viewer, "  hello  ")
	if err != nil {
		t.Fatalf("Comment: %v", err)
	}
	if c.Body != "hello" || c.Name == "" {
		t.Fatalf("comment stored as %+v", c)
	}
	if got := ann.events["live.comment"]; len(got) != 1 || len(got[0]) != 3 {
		t.Fatalf("comment went to %v, want the two viewers and the host", got)
	}
	if _, err := svc.Comment(ctx, id, viewer, ""); !errors.Is(err, ErrInvalid) {
		t.Fatalf("empty comment: %v", err)
	}

	if err := svc.DeleteComment(ctx, id, other, c.ID); !errors.Is(err, ErrForbidden) {
		t.Fatalf("someone else deleted a comment: %v", err)
	}
	if err := svc.DeleteComment(ctx, id, host, c.ID); err != nil {
		t.Fatalf("host delete: %v", err)
	}
	list, err := svc.Comments(ctx, id, viewer)
	if err != nil || len(list) != 0 {
		t.Fatalf("deleted comment still listed: %v %v", list, err)
	}

	if err := svc.SetComments(ctx, id, viewer, false); !errors.Is(err, ErrForbidden) {
		t.Fatalf("a viewer turned comments off: %v", err)
	}
	if err := svc.SetComments(ctx, id, host, false); err != nil {
		t.Fatalf("SetComments: %v", err)
	}
	if _, err := svc.Comment(ctx, id, viewer, "still here?"); !errors.Is(err, ErrCommentsOff) {
		t.Fatalf("viewer commented with comments off: %v", err)
	}
	if _, err := svc.Comment(ctx, id, host, "back soon"); err != nil {
		t.Fatalf("host could not comment with comments off: %v", err)
	}
}

// TestGroupModeratorsModerate: a group's admins look after a live in it
// without being appointed.
func TestGroupModeratorsModerate(t *testing.T) {
	pool := liveDB(t)
	ctx := context.Background()

	host, admin, member := mkUser(t, pool), mkUser(t, pool), mkUser(t, pool)
	chat := mkChat(t, pool, host, admin, member)
	svc := newSvc(pool, fakeAudience{
		inChat:   map[uuid.UUID]bool{host: true, admin: true, member: true},
		chatMods: map[uuid.UUID]bool{admin: true},
	}, &fakeAnnouncer{})

	g, err := svc.Start(ctx, StartInput{ChatID: &chat}, host)
	if err != nil {
		t.Fatalf("Start: %v", err)
	}
	if g.Live.Joint {
		t.Fatal("a group live was marked joint")
	}
	ag, err := svc.Join(ctx, g.Live.ID, admin)
	if err != nil {
		t.Fatalf("Join: %v", err)
	}
	if !ag.Moderator || ag.Role != "moderator" {
		t.Fatalf("group admin joined as %+v", ag)
	}
	if _, err := svc.Join(ctx, g.Live.ID, member); err != nil {
		t.Fatalf("Join: %v", err)
	}
	if err := svc.Ban(ctx, g.Live.ID, admin, member); err != nil {
		t.Fatalf("group admin could not ban: %v", err)
	}
}

func TestStatsCountAndAreForModerators(t *testing.T) {
	pool := liveDB(t)
	ctx := context.Background()

	host, viewer := mkUser(t, pool), mkUser(t, pool)
	svc := newSvc(pool, fakeAudience{}, &fakeAnnouncer{})

	g, err := svc.Start(ctx, StartInput{Audience: AudiencePublic}, host)
	if err != nil {
		t.Fatalf("Start: %v", err)
	}
	id := g.Live.ID
	if _, err := svc.Join(ctx, id, viewer); err != nil {
		t.Fatalf("Join: %v", err)
	}
	if err := svc.Hearts(ctx, id, viewer, 7); err != nil {
		t.Fatalf("Hearts: %v", err)
	}
	if err := svc.Hearts(ctx, id, viewer, 500); !errors.Is(err, ErrInvalid) {
		t.Fatalf("an oversized batch of hearts: %v", err)
	}
	if _, err := svc.Comment(ctx, id, viewer, "nice"); err != nil {
		t.Fatalf("Comment: %v", err)
	}
	if _, err := svc.Stats(ctx, id, viewer); !errors.Is(err, ErrForbidden) {
		t.Fatalf("a viewer read the stats: %v", err)
	}
	if err := svc.End(ctx, id, host); err != nil {
		t.Fatalf("End: %v", err)
	}
	st, err := svc.Stats(ctx, id, host)
	if err != nil {
		t.Fatalf("Stats after the end: %v", err)
	}
	if st.Hearts != 7 || st.Comments != 1 || st.UniqueViewers != 1 || st.PeakViewers != 1 || st.Viewers != 0 {
		t.Fatalf("stats = %+v", st)
	}
}

// TestRunningForStoryLives: a live from Stories shows up for the people it
// is for, and not for anyone else.
func TestRunningForStoryLives(t *testing.T) {
	pool := liveDB(t)
	ctx := context.Background()

	host, friend, picked, stranger := mkUser(t, pool), mkUser(t, pool), mkUser(t, pool), mkUser(t, pool)
	mkDirectChat(t, pool, host, friend)
	svc := newSvc(pool, fakeAudience{}, &fakeAnnouncer{})
	repo := NewRepo(pool)

	contacts, err := svc.Start(ctx, StartInput{Audience: AudienceContacts}, host)
	if err != nil {
		t.Fatalf("Start: %v", err)
	}
	has := func(u uuid.UUID, id uuid.UUID) bool {
		list, err := repo.RunningFor(ctx, u)
		if err != nil {
			t.Fatalf("RunningFor: %v", err)
		}
		for _, l := range list {
			if l.ID == id {
				return true
			}
		}
		return false
	}
	if !has(friend, contacts.Live.ID) {
		t.Fatal("a contact does not see the live")
	}
	if has(stranger, contacts.Live.ID) {
		t.Fatal("a stranger sees a contacts live")
	}
	if err := svc.End(ctx, contacts.Live.ID, host); err != nil {
		t.Fatalf("End: %v", err)
	}

	sel, err := svc.Start(ctx, StartInput{Audience: AudienceSelected, Viewers: []uuid.UUID{picked}}, host)
	if err != nil {
		t.Fatalf("Start selected: %v", err)
	}
	if !has(picked, sel.Live.ID) || has(friend, sel.Live.ID) {
		t.Fatal("a selected live is listed for the wrong people")
	}
}
