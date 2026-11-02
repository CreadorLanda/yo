package auth

import (
	"context"
	"crypto/hmac"
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/redis/go-redis/v9"

	"github.com/CreadorLanda/zwosocial/server/internal/config"
	"github.com/CreadorLanda/zwosocial/server/internal/platform/tokens"
)

// Sentinel errors translated to HTTP status by the controller.
var (
	ErrInvalidCode                     = errors.New("invalid_code")
	ErrCodeExpired                     = errors.New("code_expired")
	ErrRateLimited                     = errors.New("rate_limited")
	ErrInvalidRefresh                  = errors.New("invalid_refresh")
	ErrNotImplemented                  = errors.New("not_implemented")
	ErrReauthentication                = errors.New("reauthentication_required")
	ErrInvalidCredential               = errors.New("invalid_credential")
	ErrVerificationDeliveryUnavailable = errors.New("verification_delivery_unavailable")
)

const (
	otpTTL               = 5 * time.Minute
	maxOTPVerifyAttempts = 5
)

const consumeOTPScript = `
local stored = redis.call("GET", KEYS[1])
if not stored then return 0 end
if stored ~= ARGV[1] then return -1 end
redis.call("DEL", KEYS[1])
return 1
`

const consumeReauthScript = `
local stored = redis.call("GET", KEYS[1])
if not stored then return 0 end
if stored == ARGV[1] then
  redis.call("DEL", KEYS[1], KEYS[2])
  return 1
end
local attempts = redis.call("INCR", KEYS[2])
redis.call("EXPIRE", KEYS[2], ARGV[2])
if attempts >= tonumber(ARGV[3]) then
  redis.call("DEL", KEYS[1], KEYS[2])
  return -2
end
return -1
`

const issueReauthScript = `
redis.call("SET", KEYS[1], ARGV[1], "EX", ARGV[2])
redis.call("DEL", KEYS[2])
return 1
`

// Service holds the business logic for auth. Controllers stay thin.
type Service struct {
	repo          *Repository
	rdb           *redis.Client
	cfg           config.JWTConfig
	emailSender   EmailSender
	phoneSender   PhoneSender
	notifier      CredentialNotifier
	allowDevCodes bool
}

func NewService(repo *Repository, rdb *redis.Client, cfg config.JWTConfig) *Service {
	return &Service{repo: repo, rdb: rdb, cfg: cfg}
}

func (s *Service) WithEmailSender(sender EmailSender) *Service {
	s.emailSender = sender
	return s
}

func (s *Service) WithPhoneSender(sender PhoneSender) *Service {
	s.phoneSender = sender
	return s
}

func (s *Service) WithCredentialNotifier(notifier CredentialNotifier) *Service {
	s.notifier = notifier
	return s
}

func (s *Service) WithDevVerificationCodes(allow bool) *Service {
	s.allowDevCodes = allow
	return s
}

// Start issues a 6-digit OTP for the phone, stores only its HMAC digest in
// Redis with a 5 minute TTL, and hands delivery to the configured sender.
// Production responses contain metadata only; dev may return the code.
func (s *Service) Start(ctx context.Context, phone string) (code string, err error) {
	// per-phone rate limit
	rlKey := "rl:auth:start:" + sha256Hex(phone)
	if err := s.takeBucket(ctx, rlKey, 5, time.Minute); err != nil {
		return "", err
	}
	code = randomDigits(6)
	// Never keep the OTP itself in Redis. A read-only Redis compromise must
	// not immediately become an account takeover.
	if err := s.rdb.Set(ctx, otpKey(phone), otpDigest(phone, code, s.cfg.OTPPepper), otpTTL).Err(); err != nil {
		return "", fmt.Errorf("store otp: %w", err)
	}
	_ = s.rdb.Del(ctx, otpVerifyAttemptsKey(phone)).Err()
	if err := s.deliverPhoneCode(ctx, phone, code); err != nil {
		return "", err
	}
	return code, nil
}

// Verify exchanges (phone, code) for a fresh access + refresh token pair,
// creating the user lazily on first login.
//
// Skeleton: this is the canonical happy path; pre-key bundle upload and
// device-trust events land in backend/auth.
func (s *Service) Verify(ctx context.Context, in VerifyRequest) (*Tokens, *User, string, error) {
	email := normalizeEmail(in.Email)
	if email != "" {
		if !validEmail(email) {
			return nil, nil, "", ErrInvalidCredential
		}
		if s.emailSender == nil && !s.allowDevCodes {
			return nil, nil, "", ErrVerificationDeliveryUnavailable
		}
	}
	if err := s.takeBucket(ctx, otpVerifyAttemptsKey(in.Phone), maxOTPVerifyAttempts, time.Minute); err != nil {
		return nil, nil, "", err
	}
	result, err := s.rdb.Eval(ctx, consumeOTPScript, []string{otpKey(in.Phone)}, otpDigest(in.Phone, in.Code, s.cfg.OTPPepper)).Int()
	if err != nil {
		return nil, nil, "", fmt.Errorf("verify otp: %w", err)
	}
	switch result {
	case 0:
		return nil, nil, "", ErrCodeExpired
	case -1:
		return nil, nil, "", ErrInvalidCode
	}
	if result != 1 {
		return nil, nil, "", ErrInvalidCode
	}

	phoneHash := sha256Bytes(in.Phone)
	user, err := s.repo.UserByPhoneHash(ctx, phoneHash)
	if IsNoRows(err) {
		user, err = s.repo.CreateUser(ctx, phoneHash, suggestUsername(in.Phone), "", email)
	}
	if err != nil {
		if isUniqueViolation(err) {
			return nil, nil, "", ErrCredentialConflict
		}
		return nil, nil, "", fmt.Errorf("load/create user: %w", err)
	}
	emailCode := ""
	if email != "" {
		emailCode, err = s.startEmailVerification(ctx, user.ID, email)
		if err != nil {
			return nil, nil, "", err
		}
		user, err = s.repo.UserByID(ctx, user.ID)
		if err != nil {
			return nil, nil, "", err
		}
	}

	// Signal identity is supplied by the device on first registration; for now
	// the skeleton inserts an empty placeholder so the row exists.
	deviceID, err := s.repo.RegisterDevice(ctx, user.ID, in.Device, in.Platform, in.DeviceKey, []byte{})
	if err != nil {
		return nil, nil, "", fmt.Errorf("register device: %w", err)
	}

	tokens, err := s.issueTokens(user.ID, deviceID)
	if err != nil {
		return nil, nil, "", err
	}
	if _, _, err := s.repo.CreateSession(ctx, user.ID, deviceID,
		sha256Bytes(tokens.AccessToken), sha256Bytes(tokens.RefreshToken)); err != nil {
		return nil, nil, "", fmt.Errorf("persist session: %w", err)
	}
	return tokens, user, emailCode, nil
}

func (s *Service) StartReauth(ctx context.Context, userID uuid.UUID, phone string) (string, error) {
	phone = normalizePhone(phone)
	if err := s.takeBucket(ctx, "rl:auth:reauth:"+userID.String(), 5, time.Minute); err != nil {
		return "", err
	}
	hash, err := s.repo.PhoneHashByUser(ctx, userID)
	if err != nil || !hmac.Equal(hash, sha256Bytes(phone)) {
		return "", ErrReauthentication
	}
	code := randomDigits(6)
	if _, err := s.rdb.Eval(ctx, issueReauthScript,
		[]string{reauthKey(userID), reauthAttemptsKey(userID)},
		otpDigest(userID.String(), code, s.cfg.OTPPepper), int(otpTTL/time.Second)).Int(); err != nil {
		return "", fmt.Errorf("store reauth code: %w", err)
	}
	if err := s.deliverPhoneCode(ctx, phone, code); err != nil {
		return "", err
	}
	return code, nil
}

func (s *Service) StartEmailVerification(ctx context.Context, userID uuid.UUID, in EmailVerificationRequest) (string, error) {
	email := normalizeEmail(in.Email)
	if !validEmail(email) {
		return "", ErrInvalidCredential
	}
	if err := s.consumeReauth(ctx, userID, in.ReauthCode); err != nil {
		return "", err
	}
	return s.startEmailVerification(ctx, userID, email)
}

func (s *Service) startEmailVerification(ctx context.Context, userID uuid.UUID, email string) (string, error) {
	code := randomDigits(6)
	if err := s.repo.SetEmailChallenge(ctx, userID, email, []byte(otpDigest("email", code, s.cfg.OTPPepper)), time.Now().UTC().Add(10*time.Minute)); err != nil {
		if errors.Is(err, ErrCredentialConflict) {
			return "", ErrCredentialConflict
		}
		return "", err
	}
	if s.emailSender != nil {
		if err := s.emailSender.Send(ctx, email, code); err != nil {
			return "", fmt.Errorf("%w: send email verification: %v", ErrVerificationDeliveryUnavailable, err)
		}
	} else if !s.allowDevCodes {
		return "", ErrVerificationDeliveryUnavailable
	}
	return code, nil
}

func (s *Service) VerifyEmail(ctx context.Context, userID uuid.UUID, code string) (*User, error) {
	user, err := s.repo.VerifyEmail(ctx, userID, []byte(otpDigest("email", code, s.cfg.OTPPepper)), time.Now().UTC())
	if err == nil {
		s.notifyCredentialChange(ctx, userID, "email_verified")
	}
	return user, err
}

func (s *Service) RemoveEmail(ctx context.Context, userID uuid.UUID, code string) error {
	if err := s.consumeReauth(ctx, userID, code); err != nil {
		return err
	}
	if err := s.repo.ClearEmail(ctx, userID); err != nil {
		return err
	}
	s.notifyCredentialChange(ctx, userID, "email_removed")
	return nil
}

func (s *Service) StartPhoneChange(ctx context.Context, userID uuid.UUID, in PhoneChangeStartRequest) (string, error) {
	phone := normalizePhone(in.Phone)
	if existing, err := s.repo.UserByPhoneHash(ctx, sha256Bytes(phone)); err == nil && existing != nil {
		return "", ErrCredentialConflict
	} else if err != nil && !IsNoRows(err) {
		return "", err
	}
	if err := s.consumeReauth(ctx, userID, in.ReauthCode); err != nil {
		return "", err
	}
	code := randomDigits(6)
	if err := s.repo.CreatePhoneChange(ctx, userID, sha256Bytes(phone), []byte(otpDigest("phone-change", code, s.cfg.OTPPepper)), time.Now().UTC().Add(10*time.Minute)); err != nil {
		return "", err
	}
	if err := s.deliverPhoneCode(ctx, phone, code); err != nil {
		return "", err
	}
	return code, nil
}

func normalizeEmail(email string) string { return strings.ToLower(strings.TrimSpace(email)) }
func normalizePhone(phone string) string { return strings.TrimSpace(phone) }
func validEmail(email string) bool {
	return strings.Contains(email, "@") && !strings.ContainsAny(email, " \t\r\n") && len(email) <= 254
}
func reauthKey(userID uuid.UUID) string         { return "reauth:" + userID.String() }
func reauthAttemptsKey(userID uuid.UUID) string { return "rl:auth:reauth:attempts:" + userID.String() }

func (s *Service) ConfirmPhoneChange(ctx context.Context, userID uuid.UUID, code string) error {
	if err := s.repo.CompletePhoneChange(ctx, userID, []byte(otpDigest("phone-change", code, s.cfg.OTPPepper)), time.Now().UTC()); err != nil {
		return err
	}
	s.notifyCredentialChange(ctx, userID, "phone_changed")
	return nil
}

func (s *Service) deliverPhoneCode(ctx context.Context, phone, code string) error {
	if s.phoneSender != nil {
		if err := s.phoneSender.Send(ctx, phone, code); err != nil {
			return fmt.Errorf("%w: send phone verification: %v", ErrVerificationDeliveryUnavailable, err)
		}
		return nil
	}
	if !s.allowDevCodes {
		return ErrVerificationDeliveryUnavailable
	}
	return nil
}

func (s *Service) notifyCredentialChange(ctx context.Context, userID uuid.UUID, change string) {
	if s.notifier == nil {
		return
	}
	_ = s.notifier.NotifyUser(ctx, userID, "security", "ZwoSocial", "Your account credentials changed", map[string]string{
		"type":   "credential_changed",
		"change": change,
	})
}

func (s *Service) consumeReauth(ctx context.Context, userID uuid.UUID, code string) error {
	if code == "" {
		return ErrReauthentication
	}
	result, err := s.rdb.Eval(
		ctx,
		consumeReauthScript,
		[]string{reauthKey(userID), reauthAttemptsKey(userID)},
		otpDigest(userID.String(), code, s.cfg.OTPPepper),
		int(otpTTL/time.Second),
		maxOTPVerifyAttempts,
	).Int()
	if err != nil {
		return err
	}
	if result == -2 {
		return ErrRateLimited
	}
	if result != 1 {
		return ErrReauthentication
	}
	return nil
}

// Refresh rotates an existing refresh token into a new pair, advancing a
// session family by one. Replay detection is the centrepiece here:
//
//   - happy path: present a live refresh token. The old session row is
//     marked revoked and a new row joins the same family with fresh
//     hashes. The new tokens go back to the caller.
//   - reuse: present a *revoked* refresh token. The only legitimate
//     caller has the live token; the revoked one can only be in the
//     hands of a thief who captured it before rotation. We kill the
//     entire family — both the attacker and the legitimate device are
//     forced to re-auth, but the user finds out their account was
//     touched (their next refresh fails) and the thief can't pivot.
//   - unknown / expired / wrong-type: ErrInvalidRefresh.
func (s *Service) Refresh(ctx context.Context, refresh string) (*Tokens, error) {
	claims, err := tokens.Parse([]byte(s.cfg.Secret), refresh)
	if err != nil || claims.Type != tokens.TypeRefresh {
		return nil, ErrInvalidRefresh
	}

	session, err := s.repo.SessionByRefreshHash(ctx, sha256Bytes(refresh))
	if IsNoRows(err) {
		return nil, ErrInvalidRefresh
	}
	if err != nil {
		return nil, fmt.Errorf("lookup session: %w", err)
	}
	if session.Revoked {
		// Replay! Burn the whole family. The legitimate device will
		// notice next time it tries to refresh.
		_ = s.repo.RevokeFamily(ctx, session.FamilyID)
		return nil, ErrInvalidRefresh
	}
	if session.ExpiresAt.Before(time.Now()) {
		return nil, ErrInvalidRefresh
	}

	out, err := s.issueTokens(session.UserID, session.DeviceID)
	if err != nil {
		return nil, err
	}
	if _, err := s.repo.RotateSession(ctx, *session,
		sha256Bytes(out.AccessToken), sha256Bytes(out.RefreshToken)); err != nil {
		if errors.Is(err, ErrAlreadyRevoked) {
			// Lost the race against another rotation/replay — same
			// signal as a reuse. Kill the family and refuse.
			_ = s.repo.RevokeFamily(ctx, session.FamilyID)
			return nil, ErrInvalidRefresh
		}
		return nil, fmt.Errorf("rotate session: %w", err)
	}
	return out, nil
}

// Logout revokes the family the presented refresh token belongs to. It's
// idempotent and information-free — an unknown token returns success so
// a caller without state can always "log out" safely.
func (s *Service) Logout(ctx context.Context, refresh string) error {
	if refresh == "" {
		return nil
	}
	session, err := s.repo.SessionByRefreshHash(ctx, sha256Bytes(refresh))
	if IsNoRows(err) {
		return nil
	}
	if err != nil {
		return fmt.Errorf("lookup session: %w", err)
	}
	if err := s.repo.RevokeFamily(ctx, session.FamilyID); err != nil {
		return fmt.Errorf("revoke family: %w", err)
	}
	return nil
}

func (s *Service) issueTokens(userID, deviceID uuid.UUID) (*Tokens, error) {
	now := time.Now()
	access, err := tokens.Sign([]byte(s.cfg.Secret), tokens.Claims{
		UserID:   userID,
		DeviceID: deviceID,
		Type:     tokens.TypeAccess,
		IssuedAt: now,
		Expires:  now.Add(s.cfg.AccessTokenTTL),
	})
	if err != nil {
		return nil, err
	}
	refresh, err := tokens.Sign([]byte(s.cfg.Secret), tokens.Claims{
		UserID:   userID,
		DeviceID: deviceID,
		Type:     tokens.TypeRefresh,
		IssuedAt: now,
		Expires:  now.Add(s.cfg.RefreshTokenTTL),
	})
	if err != nil {
		return nil, err
	}
	return &Tokens{
		AccessToken:  access,
		RefreshToken: refresh,
		ExpiresAt:    now.Add(s.cfg.AccessTokenTTL),
	}, nil
}

// takeBucket implements a tiny fixed-window rate limit on Redis. Returns
// ErrRateLimited when the bucket is empty for the current window.
func (s *Service) takeBucket(ctx context.Context, key string, max int64, window time.Duration) error {
	pipe := s.rdb.TxPipeline()
	incr := pipe.Incr(ctx, key)
	pipe.Expire(ctx, key, window)
	if _, err := pipe.Exec(ctx); err != nil {
		return fmt.Errorf("rate-limit: %w", err)
	}
	if incr.Val() > max {
		return ErrRateLimited
	}
	return nil
}

func otpKey(phone string) string               { return "otp:" + sha256Hex(phone) }
func otpVerifyAttemptsKey(phone string) string { return "rl:auth:verify:" + sha256Hex(phone) }
func otpDigest(phone, code string, pepper string) string {
	mac := hmac.New(sha256.New, []byte(pepper))
	_, _ = mac.Write([]byte(phone + ":" + code))
	return base64.RawURLEncoding.EncodeToString(mac.Sum(nil))
}

// suggestUsername produces a deterministic placeholder until the client
// completes the profile-setup flow that already exists in the mobile app.
func suggestUsername(phone string) string { return "u" + sha256Hex(phone)[:10] }

func sha256Bytes(s string) []byte { h := sha256.Sum256([]byte(s)); return h[:] }
func sha256Hex(s string) string {
	b := sha256Bytes(s)
	return base64.RawURLEncoding.EncodeToString(b)
}

func randomDigits(n int) string {
	const digits = "0123456789"
	buf := make([]byte, n)
	_, _ = rand.Read(buf)
	for i, b := range buf {
		buf[i] = digits[int(b)%len(digits)]
	}
	return string(buf)
}
