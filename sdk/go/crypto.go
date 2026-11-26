package zwosocial

import (
	"context"
	"crypto/rand"
	"crypto/sha512"
	"encoding/base64"
	"encoding/binary"
	"encoding/json"
	"errors"
	"fmt"
	"strconv"
	"strings"
	"sync"
	"time"

	"golang.org/x/crypto/curve25519"
	"golang.org/x/crypto/nacl/secretbox"
)

// ZwoSocial's end-to-end encryption, as a bot speaks it: a byte-for-byte
// port of the app's protocol (mobile/data/crypto) and of the TypeScript SDK.
// X25519 keys, an X3DH-lite handshake, one root per conversation with a
// secretbox key per message counter, and group sender keys sealed to each
// member over the pairwise session.

const (
	envelopePrefix      = "soc1."
	groupEnvelopePrefix = "soc1g."
	otkTarget           = 40
	usedOTKRetain       = 60
	pastRootRetain      = 6
)

// ErrDecrypt is returned when an envelope cannot be opened.
var ErrDecrypt = errors.New("cannot decrypt")

var b64 = base64.RawURLEncoding

func toB64(b []byte) string { return b64.EncodeToString(b) }

func fromB64(s string) ([]byte, error) {
	return b64.DecodeString(strings.TrimRight(s, "="))
}

func mustB64(s string) []byte {
	b, _ := fromB64(s)
	return b
}

func hkdfLike(ikm []byte, info string) []byte {
	h := sha512.Sum512(append(append([]byte{}, ikm...), info...))
	return h[:32]
}

func messageKey(root []byte, n int) *[32]byte {
	var k [32]byte
	copy(k[:], hkdfLike(root, "msg-"+strconv.Itoa(n)))
	return &k
}

func nonceFromCounter(n int) *[24]byte {
	var nonce [24]byte
	binary.BigEndian.PutUint32(nonce[0:4], uint32(n))
	binary.BigEndian.PutUint32(nonce[4:8], 0x534f4349) // SOCI
	return &nonce
}

func dh(secret, public []byte) []byte {
	out, err := curve25519.X25519(secret, public)
	if err != nil {
		// A low-order point: refuse to derive from it.
		return make([]byte, 32)
	}
	return out
}

type keyPair struct{ Public, Secret []byte }

func newKeyPair() keyPair {
	secret := make([]byte, 32)
	if _, err := rand.Read(secret); err != nil {
		panic(err)
	}
	public, _ := curve25519.X25519(secret, curve25519.Basepoint)
	return keyPair{Public: public, Secret: secret}
}

func publicOf(secret []byte) []byte {
	p, _ := curve25519.X25519(secret, curve25519.Basepoint)
	return p
}

func signSPK(identitySecret, spkPublic []byte) string {
	h := sha512.Sum512(identitySecret)
	var key [32]byte
	copy(key[:], h[:32])
	m := sha512.Sum512(spkPublic)
	var nonce [24]byte
	copy(nonce[:], m[:24])
	boxed := secretbox.Seal(nil, spkPublic, &nonce, &key)
	return toB64(boxed[:min(64, len(boxed))]) // as JS slice(0, 64)
}

func freshOTKBase() int {
	var b [4]byte
	_, _ = rand.Read(b[:])
	v := uint32(b[0])<<23 | uint32(b[1])<<15 | uint32(b[2])<<7 | uint32(b[3])
	return int(v%0x7fff0000) + 1
}

// DeviceKeys is the bot's identity, signed pre-key and one-time keys.
type DeviceKeys struct {
	IdentityPublic        string            `json:"identityPublic"`
	IdentitySecret        string            `json:"identitySecret"`
	SignedPreKeyID        int               `json:"signedPreKeyId"`
	SignedPreKeyPublic    string            `json:"signedPreKeyPublic"`
	SignedPreKeySecret    string            `json:"signedPreKeySecret"`
	SignedPreKeySignature string            `json:"signedPreKeySignature"`
	OneTimeSecrets        map[string]string `json:"oneTimeSecrets"`
	UsedOTKSecrets        map[string]string `json:"usedOtkSecrets"`
	NextOTKID             int               `json:"nextOtkId"`
}

// UploadKeysRequest is the bundle the server stores.
type UploadKeysRequest struct {
	IdentityKey  string `json:"identity_key"`
	SignedPreKey struct {
		KeyID     int    `json:"key_id"`
		PublicKey string `json:"public_key"`
		Signature string `json:"signature"`
	} `json:"signed_pre_key"`
	OneTimePreKeys []OneTimeKey `json:"one_time_pre_keys"`
}

type OneTimeKey struct {
	KeyID     int    `json:"key_id"`
	PublicKey string `json:"public_key"`
}

// PreKeyBundle is someone's published keys.
type PreKeyBundle struct {
	IdentityKey  string `json:"identity_key"`
	SignedPreKey struct {
		KeyID     int    `json:"key_id"`
		PublicKey string `json:"public_key"`
	} `json:"signed_pre_key"`
	OneTimePreKey *OneTimeKey `json:"one_time_pre_key"`
}

// SenderKeyEntry is a group sender key sealed for this bot.
type SenderKeyEntry struct {
	UserID     string `json:"user_id"`
	Epoch      int    `json:"epoch"`
	Ciphertext string `json:"ciphertext"`
}

// SealedKey is one copy of the bot's own sender key, for one member.
type SealedKey struct {
	UserID     string `json:"user_id"`
	Ciphertext string `json:"ciphertext"`
}

// KeyServer is what the crypto needs from the server.
type KeyServer interface {
	UploadKeys(ctx context.Context, body UploadKeysRequest) (int, error)
	Bundle(ctx context.Context, username string) (PreKeyBundle, error)
	FetchSenderKeys(ctx context.Context, chatID string) (int, []SenderKeyEntry, error)
	PublishSenderKeys(ctx context.Context, chatID string, epoch int, entries []SealedKey) error
}

type session struct {
	PeerUserID         string     `json:"peerUserId"`
	PeerIdentityPublic string     `json:"peerIdentityPublic"`
	RootKey            string     `json:"rootKey"`
	SendN              int        `json:"sendN"`
	RecvN              int        `json:"recvN"`
	EstablishedAt      string     `json:"establishedAt"`
	Handshake          *handshake `json:"handshake,omitempty"`
	PastRoots          []string   `json:"pastRoots,omitempty"`
}

type handshake struct {
	EK    string `json:"ek"`
	OTKID *int   `json:"otkId,omitempty"`
	SPKID *int   `json:"spkId,omitempty"`
}

type header struct {
	V     int    `json:"v"`
	IK    string `json:"ik"`
	EK    string `json:"ek,omitempty"`
	OTKID *int   `json:"otk_id,omitempty"`
	SPKID *int   `json:"spk_id,omitempty"`
	N     int    `json:"n"`
}

type groupHeader struct {
	V int    `json:"v"`
	S string `json:"s"`
	E int    `json:"e"`
	N int    `json:"n"`
}

type groupKey struct {
	ChatID string `json:"chatId"`
	Epoch  int    `json:"epoch"`
	Key    string `json:"key"`
	SendN  int    `json:"sendN"`
}

// E2EE holds one bot's keys and sessions.
type E2EE struct {
	store  Store
	selfID string
	server KeyServer
	mu     sync.Mutex
}

func NewE2EE(store Store, selfID string, server KeyServer) *E2EE {
	return &E2EE{store: store, selfID: selfID, server: server}
}

func (e *E2EE) keys() (*DeviceKeys, error) {
	var k DeviceKeys
	ok, err := e.store.Get("keys", &k)
	if err != nil {
		return nil, err
	}
	if ok {
		if k.UsedOTKSecrets == nil {
			k.UsedOTKSecrets = map[string]string{}
		}
		return &k, nil
	}
	id, spk := newKeyPair(), newKeyPair()
	k = DeviceKeys{
		IdentityPublic:        toB64(id.Public),
		IdentitySecret:        toB64(id.Secret),
		SignedPreKeyID:        1,
		SignedPreKeyPublic:    toB64(spk.Public),
		SignedPreKeySecret:    toB64(spk.Secret),
		SignedPreKeySignature: signSPK(id.Secret, spk.Public),
		OneTimeSecrets:        map[string]string{},
		UsedOTKSecrets:        map[string]string{},
		NextOTKID:             freshOTKBase(),
	}
	for i := 0; i < otkTarget; i++ {
		k.OneTimeSecrets[strconv.Itoa(k.NextOTKID)] = toB64(newKeyPair().Secret)
		k.NextOTKID++
	}
	return &k, e.store.Set("keys", k)
}

func uploadBody(k *DeviceKeys, otks map[string]string) UploadKeysRequest {
	var b UploadKeysRequest
	b.IdentityKey = k.IdentityPublic
	b.SignedPreKey.KeyID = k.SignedPreKeyID
	b.SignedPreKey.PublicKey = k.SignedPreKeyPublic
	b.SignedPreKey.Signature = k.SignedPreKeySignature
	b.OneTimePreKeys = []OneTimeKey{}
	for id, secret := range otks {
		n, _ := strconv.Atoi(id)
		b.OneTimePreKeys = append(b.OneTimePreKeys, OneTimeKey{KeyID: n, PublicKey: toB64(publicOf(mustB64(secret)))})
	}
	return b
}

// PublishKeys uploads the bundle and tops up one-time keys when low.
func (e *E2EE) PublishKeys(ctx context.Context) error {
	e.mu.Lock()
	defer e.mu.Unlock()
	k, err := e.keys()
	if err != nil {
		return err
	}
	remaining, err := e.server.UploadKeys(ctx, uploadBody(k, k.OneTimeSecrets))
	if err != nil {
		return err
	}
	if remaining >= 10 {
		return nil
	}
	fresh := map[string]string{}
	for i := 0; i < otkTarget; i++ {
		id := strconv.Itoa(k.NextOTKID)
		k.NextOTKID++
		k.OneTimeSecrets[id] = toB64(newKeyPair().Secret)
		fresh[id] = k.OneTimeSecrets[id]
	}
	if err := e.store.Set("keys", k); err != nil {
		return err
	}
	_, err = e.server.UploadKeys(ctx, uploadBody(k, fresh))
	return err
}

func (e *E2EE) takeOTK(id int) ([]byte, error) {
	k, err := e.keys()
	if err != nil {
		return nil, err
	}
	key := strconv.Itoa(id)
	if live, ok := k.OneTimeSecrets[key]; ok {
		delete(k.OneTimeSecrets, key)
		k.UsedOTKSecrets[key] = live
		for len(k.UsedOTKSecrets) > usedOTKRetain {
			for old := range k.UsedOTKSecrets {
				delete(k.UsedOTKSecrets, old)
				break
			}
		}
		return mustB64(live), e.store.Set("keys", k)
	}
	if spent, ok := k.UsedOTKSecrets[key]; ok {
		return mustB64(spent), nil
	}
	return nil, nil
}

func (e *E2EE) loadSession(peer string) (*session, error) {
	var s session
	ok, err := e.store.Get("session:"+peer, &s)
	if err != nil || !ok {
		return nil, err
	}
	return &s, nil
}

func (e *E2EE) saveSession(s *session) error { return e.store.Set("session:"+s.PeerUserID, s) }

func (e *E2EE) initiate(ctx context.Context, peer, username string) (*session, error) {
	k, err := e.keys()
	if err != nil {
		return nil, err
	}
	b, err := e.server.Bundle(ctx, username)
	if err != nil {
		return nil, err
	}
	bobIK, bobSPK := mustB64(b.IdentityKey), mustB64(b.SignedPreKey.PublicKey)
	ek := newKeyPair()
	ik := mustB64(k.IdentitySecret)
	cat := append(append(dh(ik, bobSPK), dh(ek.Secret, bobIK)...), dh(ek.Secret, bobSPK)...)
	var otkID *int
	if b.OneTimePreKey != nil {
		cat = append(cat, dh(ek.Secret, mustB64(b.OneTimePreKey.PublicKey))...)
		id := b.OneTimePreKey.KeyID
		otkID = &id
	}
	spkID := b.SignedPreKey.KeyID
	s := &session{
		PeerUserID:         peer,
		PeerIdentityPublic: b.IdentityKey,
		RootKey:            toB64(hkdfLike(cat, "Socialize-X3DH-v1")),
		EstablishedAt:      time.Now().UTC().Format(time.RFC3339),
		Handshake:          &handshake{EK: toB64(ek.Public), OTKID: otkID, SPKID: &spkID},
	}
	return s, e.saveSession(s)
}

func (e *E2EE) responderRoot(h header) ([]byte, error) {
	if h.EK == "" || h.IK == "" {
		return nil, nil
	}
	k, err := e.keys()
	if err != nil {
		return nil, err
	}
	if h.IK == k.IdentityPublic {
		return nil, nil
	}
	spk, ik := mustB64(k.SignedPreKeySecret), mustB64(k.IdentitySecret)
	aliceIK, aliceEK := mustB64(h.IK), mustB64(h.EK)
	cat := append(append(dh(spk, aliceIK), dh(ik, aliceEK)...), dh(spk, aliceEK)...)
	if h.OTKID != nil {
		otk, err := e.takeOTK(*h.OTKID)
		if err != nil || otk == nil {
			return nil, err
		}
		cat = append(cat, dh(otk, aliceEK)...)
	}
	return hkdfLike(cat, "Socialize-X3DH-v1"), nil
}

// Encrypt seals plaintext for one person. peerUsername is needed only for a
// first message, to fetch their bundle.
func (e *E2EE) Encrypt(ctx context.Context, peer, plaintext, peerUsername string) (string, error) {
	e.mu.Lock()
	defer e.mu.Unlock()
	s, err := e.loadSession(peer)
	if err != nil {
		return "", err
	}
	if s == nil {
		if peerUsername == "" {
			return "", fmt.Errorf("session_missing: a first message to %s needs their username", peer)
		}
		if s, err = e.initiate(ctx, peer, peerUsername); err != nil {
			return "", err
		}
	}
	k, err := e.keys()
	if err != nil {
		return "", err
	}
	n := s.SendN
	boxed := secretbox.Seal(nil, []byte(plaintext), nonceFromCounter(n), messageKey(mustB64(s.RootKey), n))
	h := header{V: 1, IK: k.IdentityPublic, N: n}
	if s.Handshake != nil {
		h.EK, h.OTKID, h.SPKID = s.Handshake.EK, s.Handshake.OTKID, s.Handshake.SPKID
	}
	s.SendN = n + 1
	if err := e.saveSession(s); err != nil {
		return "", err
	}
	hb, _ := json.Marshal(h)
	return envelopePrefix + toB64(hb) + "." + toB64(boxed), nil
}

func parseEnvelope(content, prefix string, h any) ([]byte, error) {
	if !strings.HasPrefix(content, prefix) {
		return nil, fmt.Errorf("%w: not an envelope", ErrDecrypt)
	}
	parts := strings.SplitN(strings.TrimPrefix(content, prefix), ".", 2)
	if len(parts) != 2 {
		return nil, fmt.Errorf("%w: malformed envelope", ErrDecrypt)
	}
	hb, err := fromB64(parts[0])
	if err != nil || json.Unmarshal(hb, h) != nil {
		return nil, fmt.Errorf("%w: malformed header", ErrDecrypt)
	}
	body, err := fromB64(parts[1])
	if err != nil {
		return nil, fmt.Errorf("%w: malformed body", ErrDecrypt)
	}
	return body, nil
}

// Decrypt opens a pairwise envelope from peer.
func (e *E2EE) Decrypt(peer, content string) (string, error) {
	e.mu.Lock()
	defer e.mu.Unlock()
	var h header
	body, err := parseEnvelope(content, envelopePrefix, &h)
	if err != nil {
		return "", err
	}
	s, err := e.loadSession(peer)
	if err != nil {
		return "", err
	}
	if s == nil && h.EK != "" {
		root, err := e.responderRoot(h)
		if err != nil {
			return "", err
		}
		if root != nil {
			s = &session{PeerUserID: peer, PeerIdentityPublic: h.IK, RootKey: toB64(root), EstablishedAt: time.Now().UTC().Format(time.RFC3339)}
			if err := e.saveSession(s); err != nil {
				return "", err
			}
		}
	}
	if s == nil {
		return "", fmt.Errorf("%w: no session with this sender", ErrDecrypt)
	}
	nonce := nonceFromCounter(h.N)
	opened, ok := secretbox.Open(nil, body, nonce, messageKey(mustB64(s.RootKey), h.N))
	for _, old := range s.PastRoots {
		if ok {
			break
		}
		opened, ok = secretbox.Open(nil, body, nonce, messageKey(mustB64(old), h.N))
	}
	if !ok && h.EK != "" && h.IK != "" {
		candidate, err := e.responderRoot(h)
		if err != nil {
			return "", err
		}
		if candidate != nil {
			if opened, ok = secretbox.Open(nil, body, nonce, messageKey(candidate, h.N)); ok {
				root := toB64(candidate)
				past := []string{}
				for _, r := range append([]string{s.RootKey}, s.PastRoots...) {
					if r != root && len(past) < pastRootRetain {
						past = append(past, r)
					}
				}
				s = &session{PeerUserID: peer, PeerIdentityPublic: h.IK, RootKey: root, SendN: s.SendN, RecvN: s.RecvN,
					EstablishedAt: time.Now().UTC().Format(time.RFC3339), PastRoots: past}
			}
		}
	}
	if !ok {
		return "", ErrDecrypt
	}
	s.Handshake = nil
	if h.N >= s.RecvN {
		s.RecvN = h.N + 1
	}
	return string(opened), e.saveSession(s)
}

// ── Groups ──

func groupStoreKey(chatID, sender string, epoch int) string {
	return fmt.Sprintf("group:%s:%s:%d", chatID, sender, epoch)
}

// Member is who a group sender key is sealed to.
type Member struct {
	UserID   string `json:"user_id"`
	Username string `json:"username"`
}

// EncryptForGroup seals plaintext with the bot's sender key for chatID,
// making and distributing the key the first time in each epoch.
func (e *E2EE) EncryptForGroup(ctx context.Context, chatID, plaintext string, epoch int, members []Member) (string, error) {
	key := groupStoreKey(chatID, e.selfID, epoch)
	var rec groupKey
	ok, err := e.store.Get(key, &rec)
	if err != nil {
		return "", err
	}
	if !ok {
		raw := make([]byte, 32)
		_, _ = rand.Read(raw)
		rec = groupKey{ChatID: chatID, Epoch: epoch, Key: toB64(raw)}
		var entries []SealedKey
		for _, m := range members {
			if m.UserID == e.selfID {
				continue
			}
			ct, err := e.Encrypt(ctx, m.UserID, rec.Key, m.Username)
			if err != nil {
				continue // a member without keys cannot read us yet
			}
			entries = append(entries, SealedKey{UserID: m.UserID, Ciphertext: ct})
		}
		if len(entries) == 0 {
			return "", errors.New("no group member could be reached")
		}
		if err := e.server.PublishSenderKeys(ctx, chatID, epoch, entries); err != nil {
			return "", err
		}
	}
	e.mu.Lock()
	defer e.mu.Unlock()
	n := rec.SendN
	boxed := secretbox.Seal(nil, []byte(plaintext), nonceFromCounter(n), messageKey(mustB64(rec.Key), n))
	rec.SendN = n + 1
	if err := e.store.Set(key, rec); err != nil {
		return "", err
	}
	hb, _ := json.Marshal(groupHeader{V: 1, S: e.selfID, E: epoch, N: n})
	return groupEnvelopePrefix + toB64(hb) + "." + toB64(boxed), nil
}

// SyncGroupKeys collects the sender keys addressed to the bot.
func (e *E2EE) SyncGroupKeys(ctx context.Context, chatID string) (int, error) {
	epoch, keys, err := e.server.FetchSenderKeys(ctx, chatID)
	if err != nil {
		return 0, err
	}
	for _, k := range keys {
		var existing groupKey
		key := groupStoreKey(chatID, k.UserID, k.Epoch)
		if ok, _ := e.store.Get(key, &existing); ok {
			continue
		}
		opened, err := e.Decrypt(k.UserID, k.Ciphertext)
		if err != nil {
			continue
		}
		_ = e.store.Set(key, groupKey{ChatID: chatID, Epoch: k.Epoch, Key: opened})
	}
	return epoch, nil
}

// DecryptGroup opens a group envelope, syncing keys once if one is missing.
func (e *E2EE) DecryptGroup(ctx context.Context, chatID, content string) (string, error) {
	var h groupHeader
	body, err := parseEnvelope(content, groupEnvelopePrefix, &h)
	if err != nil {
		return "", err
	}
	var rec groupKey
	key := groupStoreKey(chatID, h.S, h.E)
	ok, err := e.store.Get(key, &rec)
	if err != nil {
		return "", err
	}
	if !ok {
		if _, err := e.SyncGroupKeys(ctx, chatID); err != nil {
			return "", err
		}
		if ok, _ = e.store.Get(key, &rec); !ok {
			return "", fmt.Errorf("%w: no sender key — the bot may not have full read here", ErrDecrypt)
		}
	}
	opened, ok := secretbox.Open(nil, body, nonceFromCounter(h.N), messageKey(mustB64(rec.Key), h.N))
	if !ok {
		return "", ErrDecrypt
	}
	return string(opened), nil
}

// IsEnvelope / IsGroupEnvelope tell envelope kinds apart.
func IsEnvelope(s string) bool      { return strings.HasPrefix(s, envelopePrefix) }
func IsGroupEnvelope(s string) bool { return strings.HasPrefix(s, groupEnvelopePrefix) }
