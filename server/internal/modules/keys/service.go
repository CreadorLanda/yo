package keys

import (
	"context"
	"encoding/base64"
	"errors"
	"fmt"

	"github.com/google/uuid"

	"github.com/CreadorLanda/zwosocial/server/internal/modules/users"
)

// Sentinel errors. The controller maps these to HTTP statuses.
var (
	ErrNoBundle       = errors.New("bundle_unavailable")
	ErrInvalidPayload = errors.New("invalid_payload")
	ErrUserNotFound   = errors.New("user_not_found")
)

type Service struct {
	repo  *Repository
	users *users.Repository
}

func NewService(repo *Repository, usersRepo *users.Repository) *Service {
	return &Service{repo: repo, users: usersRepo}
}

// Upload writes the device's published key material. Identity & signed
// pre-key are upserted; OTKs are appended (UNIQUE de-dupes on key_id).
func (s *Service) Upload(ctx context.Context, userID, deviceID uuid.UUID, in UploadRequest) (UploadResponse, error) {
	identity, err := decode(in.IdentityKey)
	if err != nil {
		return UploadResponse{}, ErrInvalidPayload
	}
	if err := s.repo.UpsertIdentity(ctx, userID, deviceID, identity); err != nil {
		return UploadResponse{}, fmt.Errorf("upsert identity: %w", err)
	}

	spkPub, err := decode(in.SignedPreKey.PublicKey)
	if err != nil {
		return UploadResponse{}, ErrInvalidPayload
	}
	spkSig, err := decode(in.SignedPreKey.Signature)
	if err != nil {
		return UploadResponse{}, ErrInvalidPayload
	}
	if err := s.repo.UpsertSignedPreKey(ctx, userID, deviceID,
		in.SignedPreKey.KeyID, spkPub, spkSig); err != nil {
		return UploadResponse{}, fmt.Errorf("upsert signed pre-key: %w", err)
	}

	rows := make([]OneTimePreKeyRow, 0, len(in.OneTimeKeys))
	for _, k := range in.OneTimeKeys {
		b, err := decode(k.PublicKey)
		if err != nil {
			return UploadResponse{}, ErrInvalidPayload
		}
		rows = append(rows, OneTimePreKeyRow{KeyID: k.KeyID, PublicKey: b})
	}
	n, err := s.repo.InsertOneTimeKeys(ctx, userID, deviceID, rows)
	if err != nil {
		return UploadResponse{}, fmt.Errorf("insert one-time keys: %w", err)
	}
	return UploadResponse{OneTimeRemaining: n}, nil
}

// BundleByUsername resolves a public handle to a user, then returns their
// most-recent-device bundle. ErrNoBundle is returned both when the user
// is unknown to keep enumeration costless for unknown handles.
func (s *Service) BundleByUsername(ctx context.Context, username string) (*Bundle, error) {
	u, err := s.users.ByUsername(ctx, username)
	if err != nil {
		if users.IsNoRows(err) {
			return nil, ErrUserNotFound
		}
		return nil, err
	}
	return s.bundleFor(ctx, u.ID)
}

func (s *Service) bundleFor(ctx context.Context, userID uuid.UUID) (*Bundle, error) {
	row, err := s.repo.FetchBundle(ctx, userID)
	if err != nil {
		if IsNoRows(err) {
			return nil, ErrNoBundle
		}
		return nil, fmt.Errorf("fetch bundle: %w", err)
	}
	b := &Bundle{
		UserID:      row.UserID.String(),
		DeviceID:    row.DeviceID.String(),
		IdentityKey: encode(row.Identity),
		SignedPreKey: SignedPreKey{
			KeyID:     row.SignedKeyID,
			PublicKey: encode(row.SignedPub),
			Signature: encode(row.SignedSig),
		},
	}
	if row.HasOTK {
		b.OneTimePreKey = &OneTimePreKey{
			KeyID:     row.OTKID,
			PublicKey: encode(row.OTKPub),
		}
	}
	return b, nil
}

func (s *Service) Count(ctx context.Context, userID, deviceID uuid.UUID) (CountResponse, error) {
	n, err := s.repo.CountOneTime(ctx, userID, deviceID)
	if err != nil {
		return CountResponse{}, err
	}
	return CountResponse{OneTimeRemaining: n}, nil
}

func decode(s string) ([]byte, error) {
	if b, err := base64.RawURLEncoding.DecodeString(s); err == nil {
		return b, nil
	}
	// Accept padded standard base64 too — clients vary.
	return base64.StdEncoding.DecodeString(s)
}

func encode(b []byte) string { return base64.RawURLEncoding.EncodeToString(b) }

// IdentityResponse is the cheap half of a bundle: who the peer currently is,
// with no key consumed.
type IdentityResponse struct {
	UserID      string `json:"user_id"`
	DeviceID    string `json:"device_id"`
	IdentityKey string `json:"identity_key"`
}

// IdentityByUsername answers "what identity does this peer publish now?".
//
// A session is bound to the identity it was established against. When a peer
// reinstalls or signs in fresh, that identity changes and every message
// encrypted under the old session becomes undecryptable for them — with no
// signal on the sending side that anything is wrong. This is what lets the
// sender notice.
func (s *Service) IdentityByUsername(ctx context.Context, username string) (*IdentityResponse, error) {
	u, err := s.users.ByUsername(ctx, username)
	if err != nil {
		if users.IsNoRows(err) {
			return nil, ErrUserNotFound
		}
		return nil, err
	}
	deviceID, identity, err := s.repo.FetchIdentity(ctx, u.ID)
	if err != nil {
		if IsNoRows(err) {
			return nil, ErrNoBundle
		}
		return nil, fmt.Errorf("fetch identity: %w", err)
	}
	return &IdentityResponse{
		UserID:      u.ID.String(),
		DeviceID:    deviceID.String(),
		IdentityKey: encode(identity),
	}, nil
}
