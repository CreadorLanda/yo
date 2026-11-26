package zwosocial

import (
	"context"
	"encoding/json"
	"errors"
	"os"
	"strings"
	"testing"
	"time"
)

// fakeServer is a key server in memory.
type fakeServer struct {
	bundles    map[string]UploadKeysRequest
	senderKeys []struct {
		SenderKeyEntry
		For string
	}
}

type partyServer struct {
	s        *fakeServer
	id, name string
}

func (p partyServer) UploadKeys(_ context.Context, b UploadKeysRequest) (int, error) {
	p.s.bundles[p.name] = b
	return len(b.OneTimePreKeys), nil
}

func (p partyServer) Bundle(_ context.Context, u string) (PreKeyBundle, error) {
	b, ok := p.s.bundles[u]
	if !ok {
		return PreKeyBundle{}, errors.New("404")
	}
	var out PreKeyBundle
	out.IdentityKey = b.IdentityKey
	out.SignedPreKey.KeyID = b.SignedPreKey.KeyID
	out.SignedPreKey.PublicKey = b.SignedPreKey.PublicKey
	if len(b.OneTimePreKeys) > 0 {
		otk := b.OneTimePreKeys[0]
		b.OneTimePreKeys = b.OneTimePreKeys[1:]
		p.s.bundles[u] = b
		out.OneTimePreKey = &otk
	}
	return out, nil
}

func (p partyServer) FetchSenderKeys(_ context.Context, chatID string) (int, []SenderKeyEntry, error) {
	var out []SenderKeyEntry
	for _, k := range p.s.senderKeys {
		if k.For == p.id {
			out = append(out, k.SenderKeyEntry)
		}
	}
	return 1, out, nil
}

func (p partyServer) PublishSenderKeys(_ context.Context, _ string, epoch int, entries []SealedKey) error {
	for _, e := range entries {
		p.s.senderKeys = append(p.s.senderKeys, struct {
			SenderKeyEntry
			For string
		}{SenderKeyEntry{UserID: p.id, Epoch: epoch, Ciphertext: e.Ciphertext}, e.UserID})
	}
	return nil
}

func party(t *testing.T, s *fakeServer, id, name string) *E2EE {
	t.Helper()
	e := NewE2EE(NewMemoryStore(), id, partyServer{s, id, name})
	if err := e.PublishKeys(context.Background()); err != nil {
		t.Fatal(err)
	}
	return e
}

func TestPairwiseRoundTrip(t *testing.T) {
	ctx := context.Background()
	s := &fakeServer{bundles: map[string]UploadKeysRequest{}}
	ana, bot := party(t, s, "ana-id", "ana"), party(t, s, "bot-id", "helper_bot")
	first, err := ana.Encrypt(ctx, "bot-id", "olá", "helper_bot")
	if err != nil {
		t.Fatal(err)
	}
	if got, err := bot.Decrypt("ana-id", first); err != nil || got != "olá" {
		t.Fatalf("bot opened %q, %v", got, err)
	}
	reply, err := bot.Encrypt(ctx, "ana-id", "oi Ana", "")
	if err != nil {
		t.Fatal(err)
	}
	if got, err := ana.Decrypt("bot-id", reply); err != nil || got != "oi Ana" {
		t.Fatalf("ana opened %q, %v", got, err)
	}
	if got, _ := bot.Decrypt("ana-id", first); got != "olá" {
		t.Fatal("re-reading history must still work")
	}
	if _, err := bot.Decrypt("ana-id", first[:len(first)-4]+"AAAA"); !errors.Is(err, ErrDecrypt) {
		t.Fatalf("tampering: %v", err)
	}
}

func TestGroupRoundTrip(t *testing.T) {
	ctx := context.Background()
	s := &fakeServer{bundles: map[string]UploadKeysRequest{}}
	ana, bot := party(t, s, "ana-id", "ana"), party(t, s, "bot-id", "helper_bot")
	members := []Member{{"ana-id", "ana"}, {"bot-id", "helper_bot"}}
	env, err := bot.EncryptForGroup(ctx, "g1", "bom dia", 1, members)
	if err != nil {
		t.Fatal(err)
	}
	if got, err := ana.DecryptGroup(ctx, "g1", env); err != nil || got != "bom dia" {
		t.Fatalf("ana opened %q, %v", got, err)
	}
}

// TestTypeScriptInterop opens what the TypeScript SDK sealed — the same
// protocol as the app — with the bot's keys.
func TestTypeScriptInterop(t *testing.T) {
	raw, err := os.ReadFile("testdata/interop.json")
	if err != nil {
		t.Fatal(err)
	}
	var fx struct {
		BotKeys    DeviceKeys       `json:"botKeys"`
		Direct     string           `json:"direct"`
		Group      string           `json:"group"`
		SenderKeys []SenderKeyEntry `json:"senderKeys"`
	}
	if err := json.Unmarshal(raw, &fx); err != nil {
		t.Fatal(err)
	}
	store := NewMemoryStore()
	_ = store.Set("keys", fx.BotKeys)
	s := &fakeServer{bundles: map[string]UploadKeysRequest{}}
	for _, k := range fx.SenderKeys {
		s.senderKeys = append(s.senderKeys, struct {
			SenderKeyEntry
			For string
		}{k, "bot-id"})
	}
	bot := NewE2EE(store, "bot-id", partyServer{s, "bot-id", "helper_bot"})
	got, err := bot.Decrypt("ana-id", fx.Direct)
	if err != nil || got != `olá bot — /remind what:"água"` {
		t.Fatalf("direct: %q %v", got, err)
	}
	inv := ParseInvocation(got[strings.Index(got, "/"):])
	if inv == nil || inv.Name != "remind" || inv.Options["what"] != "água" {
		t.Fatalf("invocation: %+v", inv)
	}
	if got, err := bot.DecryptGroup(context.Background(), "g1", fx.Group); err != nil || got != "mensagem para o grupo" {
		t.Fatalf("group: %q %v", got, err)
	}
}

func TestWebhookSignature(t *testing.T) {
	body := []byte(`{"id":1,"type":"ping"}`)
	now := time.Unix(1_800_000_000, 0)
	ts := "1800000000"
	sig := "sha256=" + hmacHex("whsec_x", ts+"."+string(body))
	if !VerifySignature("whsec_x", ts, body, sig, now) {
		t.Fatal("valid delivery refused")
	}
	if VerifySignature("whsec_x", ts, body, sig, now.Add(6*time.Minute)) {
		t.Fatal("replay accepted")
	}
	if VerifySignature("other", ts, body, sig, now) {
		t.Fatal("wrong secret accepted")
	}
}

func TestReplyEncoding(t *testing.T) {
	if Text("hi").encode() != "hi" {
		t.Fatal("plain text")
	}
	enc := Reply{Text: "Lunch?", Components: [][]Component{{Button("y", "Yes", "primary")}}}.encode()
	if !strings.HasPrefix(enc, `{"zi1"`) || TextOf(enc) != "Lunch?" {
		t.Fatalf("interactive: %s", enc)
	}
}
