package bots

import (
	"bytes"
	"context"
	"crypto/hmac"
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"net"
	"net/http"
	"net/netip"
	"net/url"
	"strconv"
	"strings"
	"sync"
	"syscall"
	"time"

	"github.com/google/uuid"
	"github.com/rs/zerolog/log"
)

// Webhook deliveries (#323): every event a bot's webhook wants is POSTed to
// its URL, signed, retried with backoff and dead-lettered after maxAttempts.
//
// Signature, so a receiver can check the body came from us and is fresh:
//
//	X-ZwoSocial-Timestamp: <unix seconds>
//	X-ZwoSocial-Signature: sha256=<hex HMAC-SHA256(secret, timestamp + "." + body)>
//
// A receiver rejects a timestamp more than SignatureWindow away from its
// clock; that is the replay protection. VerifySignature does both checks.

const (
	HeaderSignature = "X-ZwoSocial-Signature"
	HeaderTimestamp = "X-ZwoSocial-Timestamp"
	HeaderEvent     = "X-ZwoSocial-Event"
	HeaderDelivery  = "X-ZwoSocial-Delivery"

	// SignatureWindow is how old (or how far ahead) a signed timestamp may be.
	SignatureWindow = 5 * time.Minute

	maxAttempts     = 6
	deliveryTimeout = 10 * time.Second
	maxWebhookURL   = 2048
)

// retryDelays is the wait after each failed attempt; the last failure is final.
var retryDelays = []time.Duration{10 * time.Second, 30 * time.Second, 2 * time.Minute, 10 * time.Minute, time.Hour}

var (
	ErrInvalidWebhookURL = errors.New("invalid_webhook_url")
	ErrSignatureMismatch = errors.New("signature_mismatch")
	ErrSignatureStale    = errors.New("signature_stale")
)

// Sign is the value of X-ZwoSocial-Signature for a body sent at `ts`.
func Sign(secret string, ts int64, body []byte) string {
	mac := hmac.New(sha256.New, []byte(secret))
	mac.Write([]byte(strconv.FormatInt(ts, 10)))
	mac.Write([]byte("."))
	mac.Write(body)
	return "sha256=" + hex.EncodeToString(mac.Sum(nil))
}

// VerifySignature is what a bot does with a delivery: the timestamp must be
// within SignatureWindow of `now` and the signature must match.
func VerifySignature(secret, tsHeader string, body []byte, sigHeader string, now time.Time) error {
	ts, err := strconv.ParseInt(tsHeader, 10, 64)
	if err != nil {
		return ErrSignatureMismatch
	}
	if d := now.Sub(time.Unix(ts, 0)); d > SignatureWindow || d < -SignatureWindow {
		return ErrSignatureStale
	}
	if !hmac.Equal([]byte(Sign(secret, ts, body)), []byte(sigHeader)) {
		return ErrSignatureMismatch
	}
	return nil
}

func newWebhookSecret() (string, error) {
	b := make([]byte, 32)
	if _, err := rand.Read(b); err != nil {
		return "", err
	}
	return "whsec_" + base64.RawURLEncoding.EncodeToString(b), nil
}

// validateWebhookURL accepts https URLs to a public host. `allowPrivate`
// (dev only) also accepts http and local addresses, so a bot on the
// developer's machine can be reached.
func validateWebhookURL(raw string, allowPrivate bool) (string, error) {
	raw = strings.TrimSpace(raw)
	if raw == "" || len(raw) > maxWebhookURL {
		return "", ErrInvalidWebhookURL
	}
	u, err := url.Parse(raw)
	if err != nil || u.Host == "" || u.User != nil || u.Fragment != "" {
		return "", ErrInvalidWebhookURL
	}
	switch u.Scheme {
	case "https":
	case "http":
		if !allowPrivate {
			return "", ErrInvalidWebhookURL
		}
	default:
		return "", ErrInvalidWebhookURL
	}
	host := u.Hostname()
	if !allowPrivate {
		if strings.EqualFold(host, "localhost") || strings.HasSuffix(strings.ToLower(host), ".localhost") {
			return "", ErrInvalidWebhookURL
		}
		if addr, err := netip.ParseAddr(host); err == nil && !publicAddr(addr) {
			return "", ErrInvalidWebhookURL
		}
	}
	return u.String(), nil
}

// publicAddr is false for loopback, private, link-local, CGNAT and other
// addresses a webhook must never reach — the SSRF guard. It is checked again
// at dial time, after DNS, so a name that resolves inward is refused too.
func publicAddr(a netip.Addr) bool {
	a = a.Unmap()
	if a.IsLoopback() || a.IsPrivate() || a.IsLinkLocalUnicast() || a.IsLinkLocalMulticast() ||
		a.IsMulticast() || a.IsUnspecified() || a.IsInterfaceLocalMulticast() {
		return false
	}
	for _, p := range blockedPrefixes {
		if p.Contains(a) {
			return false
		}
	}
	return true
}

var blockedPrefixes = []netip.Prefix{
	netip.MustParsePrefix("100.64.0.0/10"), // CGNAT
	netip.MustParsePrefix("192.0.0.0/24"),
	netip.MustParsePrefix("198.18.0.0/15"),
	netip.MustParsePrefix("240.0.0.0/4"),
	netip.MustParsePrefix("64:ff9b::/96"),
}

// webhookClient refuses redirects and, unless allowPrivate, any connection
// to a non-public address.
func webhookClient(allowPrivate bool) *http.Client {
	dialer := &net.Dialer{Timeout: 5 * time.Second}
	if !allowPrivate {
		dialer.Control = func(_, address string, _ syscall.RawConn) error {
			host, _, err := net.SplitHostPort(address)
			if err != nil {
				return err
			}
			addr, err := netip.ParseAddr(host)
			if err != nil || !publicAddr(addr) {
				return fmt.Errorf("webhook to non-public address %s refused", host)
			}
			return nil
		}
	}
	return &http.Client{
		Timeout: deliveryTimeout,
		Transport: &http.Transport{
			DialContext:         dialer.DialContext,
			TLSHandshakeTimeout: 5 * time.Second,
			MaxIdleConnsPerHost: 8,
			IdleConnTimeout:     90 * time.Second,
		},
		CheckRedirect: func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse },
	}
}

// ── Delivery queue ──────────────────────────────────────────────────────────

// pendingDelivery is a claimed delivery with what it takes to send it.
type pendingDelivery struct {
	ID       int64
	BotID    uuid.UUID
	URL      string
	Secret   string
	Attempts int // including the one about to be made
	Event    Event
}

// Delivery is one row of the owner's delivery log.
type Delivery struct {
	ID          int64      `json:"id"`
	EventID     int64      `json:"event_id"`
	EventType   string     `json:"event_type"`
	Status      string     `json:"status"`
	Attempts    int        `json:"attempts"`
	LastStatus  *int       `json:"last_status,omitempty"`
	LastError   string     `json:"last_error,omitempty"`
	CreatedAt   time.Time  `json:"created_at"`
	DeliveredAt *time.Time `json:"delivered_at,omitempty"`
}

type deliveryStore interface {
	ClaimDeliveries(ctx context.Context, limit int, lease time.Duration) ([]pendingDelivery, error)
	MarkDelivered(ctx context.Context, id int64, status int) error
	MarkFailed(ctx context.Context, id int64, status *int, msg string, retryAt *time.Time) error
}

// ClaimDeliveries takes due deliveries for this worker. The lease pushes
// next_attempt_at forward, so a worker that dies mid-send leaves them to be
// retried, and two workers never send the same one at once.
func (r *Repository) ClaimDeliveries(ctx context.Context, limit int, lease time.Duration) ([]pendingDelivery, error) {
	rows, err := r.db.Query(ctx, `
		UPDATE bot_deliveries d
		SET attempts = d.attempts + 1, next_attempt_at = NOW() + $2::interval
		FROM bot_events e, bots b
		WHERE d.id IN (
			SELECT id FROM bot_deliveries
			WHERE status = 'pending' AND next_attempt_at <= NOW()
			ORDER BY next_attempt_at
			LIMIT $1
			FOR UPDATE SKIP LOCKED
		)
		AND e.id = d.event_id AND b.user_id = d.bot_id
		RETURNING d.id, d.bot_id, COALESCE(b.webhook_url, ''), COALESCE(b.webhook_secret, ''),
		          d.attempts, e.id, e.type, e.chat_id, e.payload, e.created_at
	`, limit, lease.String())
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []pendingDelivery{}
	for rows.Next() {
		var p pendingDelivery
		var data []byte
		if err := rows.Scan(&p.ID, &p.BotID, &p.URL, &p.Secret, &p.Attempts,
			&p.Event.ID, &p.Event.Type, &p.Event.ChatID, &data, &p.Event.CreatedAt); err != nil {
			return nil, err
		}
		p.Event.Data = data
		out = append(out, p)
	}
	return out, rows.Err()
}

func (r *Repository) MarkDelivered(ctx context.Context, id int64, status int) error {
	_, err := r.db.Exec(ctx, `
		UPDATE bot_deliveries SET status = 'delivered', last_status = $2, last_error = '', delivered_at = NOW()
		WHERE id = $1
	`, id, status)
	return err
}

// MarkFailed schedules a retry at retryAt, or dead-letters when it is nil.
func (r *Repository) MarkFailed(ctx context.Context, id int64, status *int, msg string, retryAt *time.Time) error {
	if len(msg) > 500 {
		msg = msg[:500]
	}
	_, err := r.db.Exec(ctx, `
		UPDATE bot_deliveries SET
			last_status = $2, last_error = $3,
			status = CASE WHEN $4::timestamptz IS NULL THEN 'dead' ELSE 'pending' END,
			next_attempt_at = COALESCE($4::timestamptz, next_attempt_at)
		WHERE id = $1
	`, id, status, msg, retryAt)
	return err
}

// Deliveries is the owner's log: the most recent first.
func (r *Repository) Deliveries(ctx context.Context, botID uuid.UUID, limit int) ([]Delivery, error) {
	rows, err := r.db.Query(ctx, `
		SELECT d.id, d.event_id, e.type, d.status, d.attempts, d.last_status, d.last_error,
		       d.created_at, d.delivered_at
		FROM bot_deliveries d JOIN bot_events e ON e.id = d.event_id
		WHERE d.bot_id = $1
		ORDER BY d.id DESC
		LIMIT $2
	`, botID, limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []Delivery{}
	for rows.Next() {
		var d Delivery
		if err := rows.Scan(&d.ID, &d.EventID, &d.EventType, &d.Status, &d.Attempts, &d.LastStatus,
			&d.LastError, &d.CreatedAt, &d.DeliveredAt); err != nil {
			return nil, err
		}
		out = append(out, d)
	}
	return out, rows.Err()
}

// ── Worker ──────────────────────────────────────────────────────────────────

// WebhookWorker sends due deliveries. It runs beside the realtime hub, never
// inside it: a slow webhook holds up only its own goroutine.
type WebhookWorker struct {
	store       deliveryStore
	client      *http.Client
	concurrency int
	batch       int
	idle        time.Duration
	now         func() time.Time

	wake chan struct{}
	stop chan struct{}
	once sync.Once
	wg   sync.WaitGroup
}

func NewWebhookWorker(repo *Repository, allowPrivate bool) *WebhookWorker {
	return newWebhookWorker(repo, webhookClient(allowPrivate))
}

func newWebhookWorker(store deliveryStore, client *http.Client) *WebhookWorker {
	return &WebhookWorker{
		store:       store,
		client:      client,
		concurrency: 16,
		batch:       64,
		idle:        2 * time.Second,
		now:         time.Now,
		wake:        make(chan struct{}, 1),
		stop:        make(chan struct{}),
	}
}

// Wake asks for a pass now rather than at the next tick.
func (w *WebhookWorker) Wake() {
	select {
	case w.wake <- struct{}{}:
	default:
	}
}

func (w *WebhookWorker) Start() {
	w.wg.Add(1)
	go func() {
		defer w.wg.Done()
		t := time.NewTicker(w.idle)
		defer t.Stop()
		for {
			// Drain while there is work; then wait for a wake-up or the tick.
			for w.pass() == w.batch {
				select {
				case <-w.stop:
					return
				default:
				}
			}
			select {
			case <-w.stop:
				return
			case <-w.wake:
			case <-t.C:
			}
		}
	}()
}

// Stop is safe to call more than once.
func (w *WebhookWorker) Stop() {
	w.once.Do(func() { close(w.stop) })
	w.wg.Wait()
}

// pass claims and sends one batch; it returns how many it claimed.
func (w *WebhookWorker) pass() int {
	ctx, cancel := context.WithTimeout(context.Background(), deliveryTimeout*3)
	defer cancel()
	list, err := w.store.ClaimDeliveries(ctx, w.batch, deliveryTimeout*3)
	if err != nil {
		log.Warn().Err(err).Msg("webhook claim failed")
		return 0
	}
	sem := make(chan struct{}, w.concurrency)
	var wg sync.WaitGroup
	for _, d := range list {
		wg.Add(1)
		sem <- struct{}{}
		go func(d pendingDelivery) {
			defer wg.Done()
			defer func() { <-sem }()
			w.deliver(ctx, d)
		}(d)
	}
	wg.Wait()
	return len(list)
}

func (w *WebhookWorker) deliver(ctx context.Context, d pendingDelivery) {
	if d.URL == "" || d.Secret == "" {
		// The webhook was removed after this was queued; nothing to retry.
		_ = w.store.MarkFailed(ctx, d.ID, nil, "webhook_removed", nil)
		return
	}
	body, err := json.Marshal(d.Event)
	if err != nil {
		_ = w.store.MarkFailed(ctx, d.ID, nil, "encode: "+err.Error(), nil)
		return
	}
	ts := w.now().Unix()
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, d.URL, bytes.NewReader(body))
	if err != nil {
		_ = w.store.MarkFailed(ctx, d.ID, nil, "request: "+err.Error(), nil)
		return
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("User-Agent", "ZwoSocial-Webhooks/1.0")
	req.Header.Set(HeaderEvent, d.Event.Type)
	req.Header.Set(HeaderDelivery, strconv.FormatInt(d.ID, 10))
	req.Header.Set(HeaderTimestamp, strconv.FormatInt(ts, 10))
	req.Header.Set(HeaderSignature, Sign(d.Secret, ts, body))

	resp, err := w.client.Do(req)
	if err == nil {
		_ = resp.Body.Close()
		if resp.StatusCode >= 200 && resp.StatusCode < 300 {
			_ = w.store.MarkDelivered(ctx, d.ID, resp.StatusCode)
			return
		}
	}
	var status *int
	msg := ""
	if err != nil {
		msg = err.Error()
	} else {
		s := resp.StatusCode
		status = &s
		msg = http.StatusText(s)
	}
	var retryAt *time.Time
	if d.Attempts < maxAttempts {
		t := w.now().Add(retryDelays[min(d.Attempts-1, len(retryDelays)-1)])
		retryAt = &t
	}
	_ = w.store.MarkFailed(ctx, d.ID, status, msg, retryAt)
}

// ── Owner: webhook settings ─────────────────────────────────────────────────

// WebhookConfig is a bot's webhook as its owner sees it. The secret is never
// read back; HasSecret says whether one is set.
type WebhookConfig struct {
	URL       string   `json:"url"`
	Intents   []string `json:"intents"`
	HasSecret bool     `json:"has_secret"`
	// Secret is set only in the response that made or rotated it.
	Secret string `json:"secret,omitempty"`
}

// WebhookRequest sets the URL and the event types it wants.
type WebhookRequest struct {
	URL     string   `json:"url" binding:"required"`
	Intents []string `json:"intents"`
}

func (r *Repository) Webhook(ctx context.Context, botID uuid.UUID) (WebhookConfig, error) {
	var c WebhookConfig
	err := r.db.QueryRow(ctx, `
		SELECT COALESCE(webhook_url, ''), intents, COALESCE(webhook_secret, '') <> ''
		FROM bots WHERE user_id = $1
	`, botID).Scan(&c.URL, &c.Intents, &c.HasSecret)
	return c, err
}

// SetWebhook stores the URL and intents; a secret is made only if none exists.
func (r *Repository) SetWebhook(ctx context.Context, botID uuid.UUID, rawURL string, intents []string, newSecret string) (bool, error) {
	var made bool
	err := r.db.QueryRow(ctx, `
		UPDATE bots SET
			webhook_url = $2,
			intents = $3,
			webhook_secret = COALESCE(NULLIF(webhook_secret, ''), $4),
			updated_at = NOW()
		WHERE user_id = $1
		RETURNING webhook_secret = $4
	`, botID, rawURL, intents, newSecret).Scan(&made)
	return made, err
}

func (r *Repository) RotateWebhookSecret(ctx context.Context, botID uuid.UUID, secret string) error {
	_, err := r.db.Exec(ctx, `UPDATE bots SET webhook_secret = $2, updated_at = NOW() WHERE user_id = $1`, botID, secret)
	return err
}

// ClearWebhook removes the URL and secret; queued deliveries die on their next try.
func (r *Repository) ClearWebhook(ctx context.Context, botID uuid.UUID) error {
	_, err := r.db.Exec(ctx, `
		UPDATE bots SET webhook_url = NULL, webhook_secret = NULL, intents = '{}', updated_at = NOW()
		WHERE user_id = $1
	`, botID)
	return err
}

func (s *Service) WithPrivateWebhooks(allow bool) *Service {
	s.allowPrivateWebhooks = allow
	return s
}

func (s *Service) Webhook(ctx context.Context, owner, botID uuid.UUID) (WebhookConfig, error) {
	if _, err := s.owned(ctx, owner, botID); err != nil {
		return WebhookConfig{}, err
	}
	return s.repo.Webhook(ctx, botID)
}

// SetWebhook validates and stores the webhook. The first time, the response
// carries the signing secret — the only time it is shown.
func (s *Service) SetWebhook(ctx context.Context, owner, botID uuid.UUID, req WebhookRequest) (WebhookConfig, error) {
	if _, err := s.owned(ctx, owner, botID); err != nil {
		return WebhookConfig{}, err
	}
	u, err := validateWebhookURL(req.URL, s.allowPrivateWebhooks)
	if err != nil {
		return WebhookConfig{}, err
	}
	intents, err := normalizeIntents(req.Intents)
	if err != nil {
		return WebhookConfig{}, err
	}
	secret, err := newWebhookSecret()
	if err != nil {
		return WebhookConfig{}, err
	}
	made, err := s.repo.SetWebhook(ctx, botID, u, intents, secret)
	if err != nil {
		return WebhookConfig{}, err
	}
	cfg := WebhookConfig{URL: u, Intents: intents, HasSecret: true}
	if made {
		cfg.Secret = secret
	}
	return cfg, nil
}

func (s *Service) RotateWebhookSecret(ctx context.Context, owner, botID uuid.UUID) (WebhookConfig, error) {
	cfg, err := s.Webhook(ctx, owner, botID)
	if err != nil {
		return WebhookConfig{}, err
	}
	if cfg.URL == "" {
		return WebhookConfig{}, ErrInvalidWebhookURL
	}
	secret, err := newWebhookSecret()
	if err != nil {
		return WebhookConfig{}, err
	}
	if err := s.repo.RotateWebhookSecret(ctx, botID, secret); err != nil {
		return WebhookConfig{}, err
	}
	cfg.Secret = secret
	cfg.HasSecret = true
	return cfg, nil
}

func (s *Service) ClearWebhook(ctx context.Context, owner, botID uuid.UUID) error {
	if _, err := s.owned(ctx, owner, botID); err != nil {
		return err
	}
	return s.repo.ClearWebhook(ctx, botID)
}

func (s *Service) Deliveries(ctx context.Context, owner, botID uuid.UUID) ([]Delivery, error) {
	if _, err := s.owned(ctx, owner, botID); err != nil {
		return nil, err
	}
	return s.repo.Deliveries(ctx, botID, 100)
}

// TestEvent sends the bot a ping over every channel it has.
func (s *Service) TestEvent(ctx context.Context, owner, botID uuid.UUID) error {
	if _, err := s.owned(ctx, owner, botID); err != nil {
		return err
	}
	s.Emit(ctx, botID, EventPing, nil, map[string]string{"message": "Test event from ZwoSocial"})
	return nil
}
