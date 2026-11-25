package bots

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"net/http/httptest"
	"net/netip"
	"strconv"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"github.com/google/uuid"
)

func TestSignAndVerify(t *testing.T) {
	body := []byte(`{"id":1,"type":"ping"}`)
	now := time.Unix(1_800_000_000, 0)
	ts := now.Unix()
	sig := Sign("whsec_x", ts, body)
	tsStr := strconv.FormatInt(ts, 10)

	if err := VerifySignature("whsec_x", tsStr, body, sig, now); err != nil {
		t.Fatalf("valid delivery rejected: %v", err)
	}
	if err := VerifySignature("whsec_x", tsStr, []byte(`{"id":2}`), sig, now); !errors.Is(err, ErrSignatureMismatch) {
		t.Fatalf("tampered body: got %v", err)
	}
	if err := VerifySignature("other", tsStr, body, sig, now); !errors.Is(err, ErrSignatureMismatch) {
		t.Fatalf("wrong secret: got %v", err)
	}
	// Replay protection: the same signed request, too late or too early.
	if err := VerifySignature("whsec_x", tsStr, body, sig, now.Add(SignatureWindow+time.Second)); !errors.Is(err, ErrSignatureStale) {
		t.Fatalf("replayed after the window: got %v", err)
	}
	if err := VerifySignature("whsec_x", tsStr, body, sig, now.Add(-SignatureWindow-time.Second)); !errors.Is(err, ErrSignatureStale) {
		t.Fatalf("timestamp from the future: got %v", err)
	}
	// The timestamp is inside the MAC: moving it into the window breaks it.
	fresh := strconv.FormatInt(now.Add(10*time.Minute).Unix(), 10)
	if err := VerifySignature("whsec_x", fresh, body, sig, now.Add(10*time.Minute)); !errors.Is(err, ErrSignatureMismatch) {
		t.Fatalf("re-stamped replay: got %v", err)
	}
	if err := VerifySignature("whsec_x", "nope", body, sig, now); !errors.Is(err, ErrSignatureMismatch) {
		t.Fatalf("bad timestamp: got %v", err)
	}
}

func TestValidateWebhookURL(t *testing.T) {
	ok := []string{"https://bot.example.com/hook", "https://93.184.216.34/x"}
	for _, u := range ok {
		if _, err := validateWebhookURL(u, false); err != nil {
			t.Errorf("%s refused: %v", u, err)
		}
	}
	bad := []string{
		"http://bot.example.com/hook", // plain http
		"https://localhost/hook",
		"https://api.localhost/hook",
		"https://127.0.0.1/hook",
		"https://10.0.0.5/hook",
		"https://192.168.1.10/hook",
		"https://169.254.169.254/latest/meta-data", // cloud metadata
		"https://100.64.0.1/hook",                  // CGNAT
		"https://[::1]/hook",
		"https://user:pass@bot.example.com/hook",
		"ftp://bot.example.com/hook",
		"not a url",
		"",
	}
	for _, u := range bad {
		if _, err := validateWebhookURL(u, false); !errors.Is(err, ErrInvalidWebhookURL) {
			t.Errorf("%q accepted", u)
		}
	}
	if _, err := validateWebhookURL("http://localhost:3000/hook", true); err != nil {
		t.Errorf("dev mode should reach a local bot: %v", err)
	}
}

func TestPublicAddr(t *testing.T) {
	for _, a := range []string{"8.8.8.8", "2606:4700::1111"} {
		if !publicAddr(netip.MustParseAddr(a)) {
			t.Errorf("%s should be public", a)
		}
	}
	for _, a := range []string{"127.0.0.1", "10.1.2.3", "172.16.0.1", "169.254.1.1", "::ffff:10.0.0.1", "fd00::1", "0.0.0.0"} {
		if publicAddr(netip.MustParseAddr(a)) {
			t.Errorf("%s should not be public", a)
		}
	}
}

func TestWebhookClientRefusesPrivateAddresses(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {}))
	defer srv.Close()
	// A name that resolves inward is caught at dial time, after DNS.
	_, err := webhookClient(false).Get(srv.URL)
	if err == nil {
		t.Fatal("request to a loopback server should be refused")
	}
}

// memStore is a deliveryStore in memory, for worker tests.
type memStore struct {
	mu        sync.Mutex
	pending   map[int64]*memDelivery
	delivered atomic.Int64
	dead      atomic.Int64
	failures  []time.Duration // retry delays scheduled, in order
	now       func() time.Time
}

type memDelivery struct {
	p      pendingDelivery
	dueAt  time.Time
	leased bool
}

func newMemStore(n int, url, secret string) *memStore {
	s := &memStore{pending: map[int64]*memDelivery{}, now: time.Now}
	bot := uuid.New()
	for i := 1; i <= n; i++ {
		s.pending[int64(i)] = &memDelivery{p: pendingDelivery{
			ID: int64(i), BotID: bot, URL: url, Secret: secret,
			Event: Event{ID: int64(i), Type: EventPing, Data: json.RawMessage(`{}`), CreatedAt: time.Now()},
		}}
	}
	return s
}

func (s *memStore) ClaimDeliveries(_ context.Context, limit int, _ time.Duration) ([]pendingDelivery, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	out := []pendingDelivery{}
	for _, d := range s.pending {
		if len(out) == limit {
			break
		}
		if d.leased || d.dueAt.After(s.now()) {
			continue
		}
		d.leased = true
		d.p.Attempts++
		out = append(out, d.p)
	}
	return out, nil
}

func (s *memStore) MarkDelivered(_ context.Context, id int64, _ int) error {
	s.mu.Lock()
	delete(s.pending, id)
	s.mu.Unlock()
	s.delivered.Add(1)
	return nil
}

func (s *memStore) MarkFailed(_ context.Context, id int64, _ *int, _ string, retryAt *time.Time) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	d := s.pending[id]
	if retryAt == nil {
		delete(s.pending, id)
		s.dead.Add(1)
		return nil
	}
	s.failures = append(s.failures, retryAt.Sub(s.now()).Round(time.Second))
	d.leased = false
	d.dueAt = *retryAt
	return nil
}

func localClient() *http.Client { return webhookClient(true) }

// The acceptance bar is 1k deliveries a minute; this checks a thousand go
// out, every one correctly signed, well inside that.
func TestWorkerDeliversAThousandSigned(t *testing.T) {
	var got, badSig atomic.Int64
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		body, _ := io.ReadAll(r.Body)
		if VerifySignature("whsec_load", r.Header.Get(HeaderTimestamp), body, r.Header.Get(HeaderSignature), time.Now()) != nil ||
			r.Header.Get(HeaderEvent) != EventPing || r.Header.Get(HeaderDelivery) == "" {
			badSig.Add(1)
		}
		got.Add(1)
		w.WriteHeader(http.StatusNoContent)
	}))
	defer srv.Close()

	store := newMemStore(1000, srv.URL, "whsec_load")
	w := newWebhookWorker(store, localClient())
	start := time.Now()
	w.Start()
	defer w.Stop()
	w.Wake()
	deadline := time.Now().Add(60 * time.Second)
	for store.delivered.Load() < 1000 && time.Now().Before(deadline) {
		time.Sleep(20 * time.Millisecond)
	}
	elapsed := time.Since(start)
	if n := store.delivered.Load(); n != 1000 {
		t.Fatalf("delivered %d of 1000 in %s", n, elapsed)
	}
	if badSig.Load() != 0 {
		t.Fatalf("%d deliveries had a bad signature or headers", badSig.Load())
	}
	t.Logf("1000 webhook deliveries in %s", elapsed)
}

func TestWorkerRetriesThenDeadLetters(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusInternalServerError)
	}))
	defer srv.Close()

	clock := time.Now()
	store := newMemStore(1, srv.URL, "s")
	store.now = func() time.Time { return clock }
	w := newWebhookWorker(store, localClient())
	w.now = store.now
	for i := 0; i < maxAttempts; i++ {
		if n := w.pass(); n != 1 {
			t.Fatalf("attempt %d: claimed %d", i+1, n)
		}
		clock = clock.Add(2 * time.Hour) // past any backoff
	}
	if store.dead.Load() != 1 {
		t.Fatalf("not dead-lettered after %d attempts", maxAttempts)
	}
	want := []time.Duration{10 * time.Second, 30 * time.Second, 2 * time.Minute, 10 * time.Minute, time.Hour}
	if len(store.failures) != len(want) {
		t.Fatalf("retries scheduled: %v", store.failures)
	}
	for i := range want {
		if store.failures[i] != want[i] {
			t.Fatalf("retry %d after %s, want %s", i+1, store.failures[i], want[i])
		}
	}
}

func TestWorkerDropsDeliveryWhenWebhookRemoved(t *testing.T) {
	store := newMemStore(1, "", "")
	w := newWebhookWorker(store, localClient())
	w.pass()
	if store.dead.Load() != 1 {
		t.Fatal("a delivery with no webhook left should be dead, not retried")
	}
}

func TestWantsAndIntents(t *testing.T) {
	if !wants(nil, EventMessageCreated) || !wants([]string{EventCommandInvoked}, EventPing) {
		t.Fatal("no intents means all; ping always goes")
	}
	if wants([]string{EventCommandInvoked}, EventMessageCreated) {
		t.Fatal("an intent list filters")
	}
	if _, err := normalizeIntents([]string{"message.new"}); !errors.Is(err, ErrInvalidIntent) {
		t.Fatal("hub event names are not bot intents")
	}
	got, _ := normalizeIntents([]string{EventPing, EventPing, EventBotInstalled})
	if len(got) != 2 {
		t.Fatalf("duplicates not removed: %v", got)
	}
}
