package bots

import (
	"context"
	"sync"
	"testing"
	"time"

	"github.com/google/uuid"
)

type hubRecorder struct {
	mu    sync.Mutex
	types []string
}

func (h *hubRecorder) PublishJSON(_ []uuid.UUID, typ, _ string, _ any) {
	h.mu.Lock()
	h.types = append(h.types, typ)
	h.mu.Unlock()
}

type emitted struct {
	bot uuid.UUID
	typ string
}

type fakeTarget struct {
	bots  []chatBot
	delay time.Duration

	mu   sync.Mutex
	got  []emitted
	done chan struct{}
}

func (f *fakeTarget) chatBots(context.Context, uuid.UUID) ([]chatBot, error) { return f.bots, nil }

func (f *fakeTarget) Emit(_ context.Context, botID uuid.UUID, typ string, _ *uuid.UUID, _ any) {
	time.Sleep(f.delay)
	f.mu.Lock()
	f.got = append(f.got, emitted{botID, typ})
	f.mu.Unlock()
	if f.done != nil {
		f.done <- struct{}{}
	}
}

func TestTeeRoutesByScopeAndRecipient(t *testing.T) {
	full, privacy, members, gone := uuid.New(), uuid.New(), uuid.New(), uuid.New()
	target := &fakeTarget{
		bots: []chatBot{
			{BotID: full, Scopes: []Scope{ScopeReadAll, ScopeSend}},
			{BotID: privacy, Scopes: DefaultScopes}, // read.commands, send, members
			{BotID: members, Scopes: []Scope{ScopeMembers}},
			{BotID: gone, Scopes: []Scope{ScopeReadAll}}, // no longer a recipient
		},
		done: make(chan struct{}, 10),
	}
	hub := &hubRecorder{}
	tee := newTee(hub, target)
	chat := uuid.New().String()
	recipients := []uuid.UUID{uuid.New(), full, privacy, members}

	tee.PublishJSON(recipients, "message.new", chat, map[string]string{"content": "soc1g.x.y"})
	<-target.done
	tee.PublishJSON(recipients, "group.members.changed", chat, nil)
	<-target.done
	<-target.done
	tee.PublishJSON(recipients, "typing", chat, nil) // never forwarded
	time.Sleep(50 * time.Millisecond)

	target.mu.Lock()
	defer target.mu.Unlock()
	want := map[emitted]bool{
		{full, EventMessageCreated}:    true,
		{privacy, EventMembersChanged}: true,
		{members, EventMembersChanged}: true,
	}
	if len(target.got) != len(want) {
		t.Fatalf("emitted %v", target.got)
	}
	for _, e := range target.got {
		if !want[e] {
			t.Fatalf("unexpected %v", e)
		}
	}
	if len(hub.types) != 3 {
		t.Fatalf("the hub must still get everything: %v", hub.types)
	}
}

// A slow event store must never hold up the realtime hub.
func TestTeeDoesNotBlockTheHub(t *testing.T) {
	bot := uuid.New()
	target := &fakeTarget{bots: []chatBot{{BotID: bot, Scopes: []Scope{ScopeReadAll}}}, delay: time.Second}
	tee := newTee(&hubRecorder{}, target)
	chat := uuid.New().String()
	start := time.Now()
	for i := 0; i < 1000; i++ {
		tee.PublishJSON([]uuid.UUID{bot}, "message.new", chat, nil)
	}
	if d := time.Since(start); d > 200*time.Millisecond {
		t.Fatalf("1000 publishes took %s with a slow bot store", d)
	}
}
