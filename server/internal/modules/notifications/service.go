package notifications

import (
	"context"
	"encoding/json"
	"errors"
	"strings"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/redis/go-redis/v9"
	"github.com/rs/zerolog/log"
)

const pushQueueKey = "q:push.send"

var (
	ErrNotFound     = errors.New("device_not_found")
	ErrInvalidToken = errors.New("invalid_token")
	ErrInvalidPlat  = errors.New("invalid_platform")
)

type Service struct {
	repo *Repository
	rdb  *redis.Client
}

func NewService(repo *Repository, rdb *redis.Client) *Service {
	return &Service{repo: repo, rdb: rdb}
}

func (s *Service) RegisterDevice(ctx context.Context, userID, jwtDeviceID uuid.UUID, req RegisterDeviceRequest) (Device, error) {
	token := strings.TrimSpace(req.Token)
	if len(token) < 8 {
		return Device{}, ErrInvalidToken
	}
	plat := req.Platform
	if plat == "" {
		plat = PlatformUnknown
	}
	switch plat {
	case PlatformIOS, PlatformAndroid, PlatformWeb, PlatformUnknown:
	default:
		return Device{}, ErrInvalidPlat
	}
	deviceID := jwtDeviceID
	if req.DeviceID != "" {
		if parsed, err := uuid.Parse(req.DeviceID); err == nil {
			deviceID = parsed
		}
	}
	return s.repo.UpsertDevice(ctx, userID, deviceID, plat, token)
}

func (s *Service) UnregisterDevice(ctx context.Context, userID, deviceID uuid.UUID) error {
	err := s.repo.DeleteDevice(ctx, userID, deviceID)
	if errors.Is(err, pgx.ErrNoRows) {
		return ErrNotFound
	}
	return err
}

func (s *Service) GetPrefs(ctx context.Context, userID uuid.UUID) (Prefs, error) {
	return s.repo.EnsurePrefs(ctx, userID)
}

func (s *Service) PatchPrefs(ctx context.Context, userID uuid.UUID, req PatchPrefsRequest) (Prefs, error) {
	cur, err := s.repo.EnsurePrefs(ctx, userID)
	if err != nil {
		return Prefs{}, err
	}
	if req.Messages != nil {
		cur.Messages = *req.Messages
	}
	if req.Groups != nil {
		cur.Groups = *req.Groups
	}
	if req.Calls != nil {
		cur.Calls = *req.Calls
	}
	if req.Stories != nil {
		cur.Stories = *req.Stories
	}
	return s.repo.UpsertPrefs(ctx, cur)
}

// NotifyUser enqueues a push job if the user has the category enabled and
// at least one device token. Actual FCM/APNs delivery is a worker concern.
func (s *Service) NotifyUser(ctx context.Context, userID uuid.UUID, category, title, body string, data map[string]string) error {
	prefs, err := s.repo.EnsurePrefs(ctx, userID)
	if err != nil {
		return err
	}
	switch category {
	case "messages":
		if !prefs.Messages {
			return nil
		}
	case "groups":
		if !prefs.Groups {
			return nil
		}
	case "calls":
		if !prefs.Calls {
			return nil
		}
	case "stories":
		if !prefs.Stories {
			return nil
		}
	}
	tokens, err := s.repo.ListTokens(ctx, userID)
	if err != nil {
		return err
	}
	if len(tokens) == 0 {
		return nil
	}
	job := PushJob{
		UserID:   userID.String(),
		Title:    title,
		Body:     body,
		Data:     data,
		Category: category,
	}
	raw, err := json.Marshal(job)
	if err != nil {
		return err
	}
	if s.rdb != nil {
		if err := s.rdb.LPush(ctx, pushQueueKey, raw).Err(); err != nil {
			log.Warn().Err(err).Msg("push enqueue failed")
			return err
		}
	}
	log.Debug().
		Str("user", userID.String()).
		Str("category", category).
		Int("devices", len(tokens)).
		Msg("push job enqueued")
	return nil
}

// TestPush enqueues a dummy notification for the current user (dev/smoke).
func (s *Service) TestPush(ctx context.Context, userID uuid.UUID) error {
	return s.NotifyUser(ctx, userID, "messages", "ZwoSocial", "Test notification", map[string]string{
		"type": "test",
	})
}
