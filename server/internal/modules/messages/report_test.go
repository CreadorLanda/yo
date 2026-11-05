package messages

import (
	"context"
	"errors"
	"slices"
	"strings"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/CreadorLanda/zwosocial/server/internal/modules/blocks"
	"github.com/CreadorLanda/zwosocial/server/internal/modules/users"
)

type pushRecorder struct{ to []uuid.UUID }

func (p *pushRecorder) NotifyUser(_ context.Context, id uuid.UUID, _, _, _ string, _ map[string]string) error {
	p.to = append(p.to, id)
	return nil
}

// activeDirectChat makes two people with an accepted one-to-one chat, so a
// failure to send can only be down to the report, not to the friend request.
func activeDirectChat(t *testing.T, pool *pgxpool.Pool, svc *Service) (alice, bob, chat uuid.UUID) {
	t.Helper()
	ctx := context.Background()
	alice = createTestUser(t, pool, "rep_a_"+uuid.NewString()[:8])
	bob = createTestUser(t, pool, "rep_b_"+uuid.NewString()[:8])
	c, err := svc.CreateDirectChat(ctx, alice, bob)
	if err != nil {
		t.Fatalf("CreateDirectChat: %v", err)
	}
	if _, err := svc.AcceptChat(ctx, c.ID, bob); err != nil {
		t.Fatalf("AcceptChat: %v", err)
	}
	return alice, bob, c.ID
}

func send(t *testing.T, svc *Service, chat, from uuid.UUID, text string) Message {
	t.Helper()
	m, err := svc.SendMessage(context.Background(), chat, from, SendMessageRequest{Content: testDirectEnvelope(text)})
	if err != nil {
		t.Fatalf("SendMessage(%q): %v", text, err)
	}
	return m
}

func wantNoContact(t *testing.T, err error) NoContactError {
	t.Helper()
	var nc NoContactError
	if !errors.As(err, &nc) {
		t.Fatalf("got %v, want no_contact_period", err)
	}
	return nc
}

// TestReportKeepsTwoPeopleApartBothWays is the point of the feature: after a
// report neither person can write to the other, not only the one reported.
func TestReportKeepsTwoPeopleApartBothWays(t *testing.T) {
	pool := testDB(t)
	ctx := context.Background()
	svc := newTestService(pool)
	alice, bob, chat := activeDirectChat(t, pool, svc)
	send(t, svc, chat, alice, "before")

	res, err := svc.ReportChat(ctx, chat, alice, ReportInput{Reason: "abuse"})
	if err != nil {
		t.Fatalf("ReportChat: %v", err)
	}
	if res.NoContactUntil == nil {
		t.Fatal("a one-to-one report started no no-contact period")
	}
	if d := time.Until(*res.NoContactUntil); d < 23*time.Hour || d > 25*time.Hour {
		t.Fatalf("period ends in %v, want about 24h", d)
	}

	_, err = svc.SendMessage(ctx, chat, bob, SendMessageRequest{Content: testDirectEnvelope("reported speaking")})
	wantNoContact(t, err)
	_, err = svc.SendMessage(ctx, chat, alice, SendMessageRequest{Content: testDirectEnvelope("reporter speaking")})
	nc := wantNoContact(t, err)
	if !nc.Until.Equal(*res.NoContactUntil) {
		t.Fatalf("error deadline %v != report deadline %v", nc.Until, res.NoContactUntil)
	}

	for _, who := range []uuid.UUID{alice, bob} {
		until, err := svc.NoContact(ctx, chat, who)
		if err != nil || until == nil {
			t.Fatalf("NoContact(%s) = %v, %v; want a deadline", who, until, err)
		}
	}
}

// TestUnblockingDoesNotLiftTheNoContactPeriod: the acceptance criterion that
// makes this different from a block.
func TestUnblockingDoesNotLiftTheNoContactPeriod(t *testing.T) {
	pool := testDB(t)
	ctx := context.Background()
	svc := newTestService(pool)
	bl := blocks.NewRepo(pool)
	alice, bob, chat := activeDirectChat(t, pool, svc)

	res, err := svc.ReportChat(ctx, chat, alice, ReportInput{Reason: "spam", Block: true})
	if err != nil || !res.Blocked {
		t.Fatalf("ReportChat with block = %+v, %v", res, err)
	}
	if err := bl.Unblock(ctx, alice, bob); err != nil {
		t.Fatalf("Unblock: %v", err)
	}
	if yes, _ := bl.EitherWay(ctx, alice, bob); yes {
		t.Fatal("the block is still there after unblocking")
	}
	_, err = svc.SendMessage(ctx, chat, bob, SendMessageRequest{Content: testDirectEnvelope("after unblock")})
	wantNoContact(t, err)
	_, err = svc.SendMessage(ctx, chat, alice, SendMessageRequest{Content: testDirectEnvelope("after unblock")})
	wantNoContact(t, err)
}

// TestNoContactAlsoStopsANewChat: starting a fresh conversation is contact too.
func TestNoContactAlsoStopsANewChat(t *testing.T) {
	pool := testDB(t)
	ctx := context.Background()
	svc := newTestService(pool)
	a := createTestUser(t, pool, "rep_new_a_"+uuid.NewString()[:8])
	b := createTestUser(t, pool, "rep_new_b_"+uuid.NewString()[:8])
	low, high := pairKey(a, b)
	if _, err := pool.Exec(ctx,
		`INSERT INTO contact_cooldowns (user_low, user_high, until) VALUES ($1, $2, NOW() + INTERVAL '1 hour')`,
		low, high); err != nil {
		t.Fatalf("seed cooldown: %v", err)
	}
	_, err := svc.CreateDirectChat(ctx, a, b)
	wantNoContact(t, err)
	_, err = svc.CreateDirectChat(ctx, b, a)
	wantNoContact(t, err)
}

// TestRepeatReportDoesNotExtendThePeriod: one person tapping the button every
// day must not be able to keep the other locked out for good.
func TestRepeatReportDoesNotExtendThePeriod(t *testing.T) {
	pool := testDB(t)
	ctx := context.Background()
	svc := newTestService(pool)
	alice, bob, chat := activeDirectChat(t, pool, svc)

	first, err := svc.ReportChat(ctx, chat, alice, ReportInput{Reason: "abuse"})
	if err != nil {
		t.Fatalf("first report: %v", err)
	}
	// Part of the way through the period, report again, from both sides.
	low, high := pairKey(alice, bob)
	if _, err := pool.Exec(ctx,
		`UPDATE contact_cooldowns SET until = NOW() + INTERVAL '3 hours' WHERE user_low = $1 AND user_high = $2`,
		low, high); err != nil {
		t.Fatalf("shorten: %v", err)
	}
	again, err := svc.ReportChat(ctx, chat, alice, ReportInput{Reason: "spam"})
	if err != nil {
		t.Fatalf("second report: %v", err)
	}
	if d := time.Until(*again.NoContactUntil); d > 4*time.Hour {
		t.Fatalf("a repeat report extended the period to %v from now (first %v)", d, first.NoContactUntil)
	}
	other, err := svc.ReportChat(ctx, chat, bob, ReportInput{Reason: "abuse"})
	if err != nil {
		t.Fatalf("report from the other side: %v", err)
	}
	if d := time.Until(*other.NoContactUntil); d > 4*time.Hour {
		t.Fatalf("a counter-report extended the period to %v from now", d)
	}

	var n int
	if err := pool.QueryRow(ctx, `SELECT count(*) FROM chat_reports WHERE chat_id = $1`, chat).Scan(&n); err != nil {
		t.Fatal(err)
	}
	if n != 2 {
		t.Fatalf("%d report rows, want one per reporter (2)", n)
	}
}

// TestNoContactEnds: once the deadline passes, writing works again and a new
// report starts a new period.
func TestNoContactEnds(t *testing.T) {
	pool := testDB(t)
	ctx := context.Background()
	svc := newTestService(pool)
	alice, bob, chat := activeDirectChat(t, pool, svc)

	if _, err := svc.ReportChat(ctx, chat, alice, ReportInput{Reason: "abuse"}); err != nil {
		t.Fatalf("ReportChat: %v", err)
	}
	low, high := pairKey(alice, bob)
	if _, err := pool.Exec(ctx,
		`UPDATE contact_cooldowns SET until = NOW() - INTERVAL '1 second' WHERE user_low = $1 AND user_high = $2`,
		low, high); err != nil {
		t.Fatalf("expire: %v", err)
	}
	send(t, svc, chat, bob, "after the period")
	if until, err := svc.NoContact(ctx, chat, bob); err != nil || until != nil {
		t.Fatalf("NoContact after expiry = %v, %v; want none", until, err)
	}
	res, err := svc.ReportChat(ctx, chat, alice, ReportInput{Reason: "abuse"})
	if err != nil || res.NoContactUntil == nil || time.Until(*res.NoContactUntil) < 23*time.Hour {
		t.Fatalf("a report after expiry did not start a new period: %+v, %v", res, err)
	}
}

// TestEvidenceNeedsConsentAndBelongsToTheChat covers what may leave the phone.
func TestEvidenceNeedsConsentAndBelongsToTheChat(t *testing.T) {
	pool := testDB(t)
	ctx := context.Background()
	svc := newTestService(pool)
	alice, bob, chat := activeDirectChat(t, pool, svc)
	mine := send(t, svc, chat, alice, "mine")
	theirs := send(t, svc, chat, bob, "theirs")

	ev := []EvidenceInput{{MessageID: mine.ID, Body: "mine"}, {MessageID: theirs.ID, Body: "theirs"}}

	if _, err := svc.ReportChat(ctx, chat, alice, ReportInput{Reason: "abuse", Evidence: ev}); !errors.Is(err, ErrConsentRequired) {
		t.Fatalf("evidence without consent: %v, want evidence_consent_required", err)
	}
	var n int
	_ = pool.QueryRow(ctx, `SELECT count(*) FROM chat_reports WHERE chat_id = $1`, chat).Scan(&n)
	if n != 0 {
		t.Fatalf("a refused report was stored (%d rows)", n)
	}

	// Another chat's message id, a duplicate, an empty copy, an oversize copy.
	otherA, otherB, otherChat := activeDirectChat(t, pool, svc)
	foreign := send(t, svc, otherChat, otherA, "elsewhere")
	_ = otherB
	bad := map[string][]EvidenceInput{
		"foreign message": {{MessageID: foreign.ID, Body: "x"}},
		"duplicate":       {{MessageID: mine.ID, Body: "a"}, {MessageID: mine.ID, Body: "b"}},
		"empty":           {{MessageID: mine.ID, Body: "   "}},
		"oversize":        {{MessageID: mine.ID, Body: strings.Repeat("x", 2001)}},
		"zero id":         {{MessageID: 0, Body: "x"}},
	}
	for name, e := range bad {
		if _, err := svc.ReportChat(ctx, chat, alice, ReportInput{Reason: "abuse", Consent: true, Evidence: e}); !errors.Is(err, ErrInvalidReport) {
			t.Fatalf("%s: %v, want invalid_report", name, err)
		}
	}

	res, err := svc.ReportChat(ctx, chat, alice, ReportInput{Reason: "abuse", Consent: true, Evidence: ev})
	if err != nil || res.EvidenceCount != 2 {
		t.Fatalf("ReportChat with consent = %+v, %v", res, err)
	}
	rows, err := pool.Query(ctx, `
		SELECT e.message_id, e.sender_id, e.body FROM chat_report_evidence e
		JOIN chat_reports r ON r.id = e.report_id WHERE r.chat_id = $1`, chat)
	if err != nil {
		t.Fatal(err)
	}
	defer rows.Close()
	senders := map[int64]uuid.UUID{}
	for rows.Next() {
		var id int64
		var sender uuid.UUID
		var body string
		if err := rows.Scan(&id, &sender, &body); err != nil {
			t.Fatal(err)
		}
		senders[id] = sender
	}
	if senders[mine.ID] != alice || senders[theirs.ID] != bob {
		t.Fatalf("senders = %v; they must come from the messages table", senders)
	}
}

// TestFilingAgainReplacesEvidence: the second report is the one on record.
func TestFilingAgainReplacesEvidence(t *testing.T) {
	pool := testDB(t)
	ctx := context.Background()
	svc := newTestService(pool)
	alice, _, chat := activeDirectChat(t, pool, svc)
	m1 := send(t, svc, chat, alice, "one")
	m2 := send(t, svc, chat, alice, "two")

	if _, err := svc.ReportChat(ctx, chat, alice, ReportInput{Reason: "abuse", Consent: true,
		Evidence: []EvidenceInput{{MessageID: m1.ID, Body: "one"}}}); err != nil {
		t.Fatal(err)
	}
	if _, err := svc.ReportChat(ctx, chat, alice, ReportInput{Reason: "abuse", Consent: true,
		Evidence: []EvidenceInput{{MessageID: m2.ID, Body: "two"}}}); err != nil {
		t.Fatal(err)
	}
	var n int
	var id int64
	if err := pool.QueryRow(ctx, `
		SELECT count(*), COALESCE(min(e.message_id), 0) FROM chat_report_evidence e
		JOIN chat_reports r ON r.id = e.report_id WHERE r.chat_id = $1`, chat).Scan(&n, &id); err != nil {
		t.Fatal(err)
	}
	if n != 1 || id != m2.ID {
		t.Fatalf("evidence = %d rows (message %d), want only the second report's", n, id)
	}
}

func TestReportInputIsValidated(t *testing.T) {
	pool := testDB(t)
	ctx := context.Background()
	svc := newTestService(pool)
	alice, _, chat := activeDirectChat(t, pool, svc)
	for name, in := range map[string]ReportInput{
		"no reason":      {},
		"unknown reason": {Reason: "because"},
		"long note":      {Reason: "abuse", Note: strings.Repeat("n", 501)},
	} {
		if _, err := svc.ReportChat(ctx, chat, alice, in); !errors.Is(err, ErrInvalidReport) {
			t.Fatalf("%s: %v, want invalid_report", name, err)
		}
	}
	outsider := createTestUser(t, pool, "rep_out_"+uuid.NewString()[:8])
	if _, err := svc.ReportChat(ctx, chat, outsider, ReportInput{Reason: "abuse"}); !errors.Is(err, ErrNotParticipant) {
		t.Fatalf("outsider report: %v, want not_participant", err)
	}
}

// TestGroupReportStartsNoCooldown: a group is not two people to keep apart.
func TestGroupReportStartsNoCooldown(t *testing.T) {
	pool := testDB(t)
	ctx := context.Background()
	svc := newTestService(pool)
	a := createTestUser(t, pool, "rep_g_a_"+uuid.NewString()[:8])
	b := createTestUser(t, pool, "rep_g_b_"+uuid.NewString()[:8])
	var chat uuid.UUID
	if err := pool.QueryRow(ctx,
		`INSERT INTO chats (type, created_by, status) VALUES ('group', $1, 'active') RETURNING id`, a).Scan(&chat); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { pool.Exec(context.Background(), `DELETE FROM chats WHERE id = $1`, chat) })
	for _, u := range []uuid.UUID{a, b} {
		if _, err := pool.Exec(ctx, `INSERT INTO chat_participants (chat_id, user_id) VALUES ($1, $2)`, chat, u); err != nil {
			t.Fatal(err)
		}
	}
	res, err := svc.ReportChat(ctx, chat, a, ReportInput{Reason: "abuse", Block: true})
	if err != nil {
		t.Fatalf("group report: %v", err)
	}
	if res.NoContactUntil != nil || res.Blocked {
		t.Fatalf("a group report started a cooldown or a block: %+v", res)
	}
	var n int
	_ = pool.QueryRow(ctx, `SELECT count(*) FROM contact_cooldowns WHERE user_low IN ($1, $2) OR user_high IN ($1, $2)`, a, b).Scan(&n)
	if n != 0 {
		t.Fatalf("%d cooldown rows for a group report", n)
	}
	if until, err := svc.NoContact(ctx, chat, a); err != nil || until != nil {
		t.Fatalf("NoContact(group) = %v, %v; want none", until, err)
	}
}

// TestBothPeopleAreToldNeutrally: the same event reaches both, and carries no
// reporter, no reason, no note.
func TestBothPeopleAreToldNeutrally(t *testing.T) {
	pool := testDB(t)
	ctx := context.Background()
	hub := &recordingBroadcaster{}
	push := &pushRecorder{}
	svc := NewService(NewRepository(pool, ""), users.NewRepository(pool), hub, push).WithBlocks(blocks.NewRepo(pool))
	alice, bob, chat := activeDirectChat(t, pool, svc)
	hub.events = nil

	if _, err := svc.ReportChat(ctx, chat, alice, ReportInput{Reason: "abuse", Note: "secret detail"}); err != nil {
		t.Fatal(err)
	}
	var got *recordedEvent
	for i := range hub.events {
		if hub.events[i].typ == "chat.no_contact" {
			got = &hub.events[i]
		}
	}
	if got == nil || len(got.recipients) != 2 {
		t.Fatalf("no_contact event = %+v, want one event to both people", got)
	}
	if !slices.Contains(got.recipients, alice) || !slices.Contains(got.recipients, bob) {
		t.Fatalf("event recipients = %v, want both %s and %s", got.recipients, alice, bob)
	}
	if len(push.to) != 1 || push.to[0] != bob {
		t.Fatalf("push went to %v, want only the reported person %s", push.to, bob)
	}
}

// TestExpiredReportDataIsPurged: evidence has a retention, and old cooldown
// rows do not pile up.
func TestExpiredReportDataIsPurged(t *testing.T) {
	pool := testDB(t)
	ctx := context.Background()
	svc := newTestService(pool)
	alice, bob, chat := activeDirectChat(t, pool, svc)
	m := send(t, svc, chat, alice, "kept for a while")
	if _, err := svc.ReportChat(ctx, chat, alice, ReportInput{Reason: "abuse", Consent: true,
		Evidence: []EvidenceInput{{MessageID: m.ID, Body: "kept for a while"}}}); err != nil {
		t.Fatal(err)
	}

	count := func(q string, args ...any) int {
		var n int
		if err := pool.QueryRow(ctx, q, args...).Scan(&n); err != nil {
			t.Fatal(err)
		}
		return n
	}
	if _, err := svc.repo.PurgeExpiredReportData(ctx); err != nil {
		t.Fatal(err)
	}
	if count(`SELECT count(*) FROM chat_report_evidence e JOIN chat_reports r ON r.id = e.report_id WHERE r.chat_id = $1`, chat) != 1 {
		t.Fatal("fresh evidence was purged")
	}

	if _, err := pool.Exec(ctx, `UPDATE chat_report_evidence SET expires_at = NOW() - INTERVAL '1 day'
		WHERE report_id IN (SELECT id FROM chat_reports WHERE chat_id = $1)`, chat); err != nil {
		t.Fatal(err)
	}
	low, high := pairKey(alice, bob)
	if _, err := pool.Exec(ctx, `UPDATE contact_cooldowns SET until = NOW() - INTERVAL '8 days' WHERE user_low = $1 AND user_high = $2`, low, high); err != nil {
		t.Fatal(err)
	}
	n, err := svc.repo.PurgeExpiredReportData(ctx)
	if err != nil || n < 2 {
		t.Fatalf("purged %d rows, %v; want the evidence and the old cooldown", n, err)
	}
	if count(`SELECT count(*) FROM chat_report_evidence e JOIN chat_reports r ON r.id = e.report_id WHERE r.chat_id = $1`, chat) != 0 ||
		count(`SELECT count(*) FROM contact_cooldowns WHERE user_low = $1 AND user_high = $2`, low, high) != 0 {
		t.Fatal("expired report data is still there")
	}
}
