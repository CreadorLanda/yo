// Package tokens centralises JWT signing/parsing so the auth module (which
// issues tokens) and the middleware (which verifies them) share the exact
// same wire format and rules.
//
// We use HS256 — symmetric signing with a single secret — so any process
// holding cfg.JWT.Secret can both sign and verify. If we ever need to
// distribute verification to untrusted environments, switch to RS256 here
// without touching the callers.
package tokens

import (
	"errors"
	"fmt"
	"time"

	"github.com/golang-jwt/jwt/v5"
	"github.com/google/uuid"
)

// Type discriminates access vs refresh tokens so we never accept a refresh
// token where an access token is required, and vice-versa.
type Type string

const (
	TypeAccess  Type = "access"
	TypeRefresh Type = "refresh"
)

var (
	ErrInvalid     = errors.New("invalid_token")
	ErrWrongType   = errors.New("wrong_token_type")
	ErrExpired     = errors.New("expired_token")
	ErrUnsupported = errors.New("unsupported_signing_method")
)

// Claims is the strongly-typed view of what we put inside a token.
type Claims struct {
	UserID   uuid.UUID
	DeviceID uuid.UUID
	Type     Type
	IssuedAt time.Time
	Expires  time.Time
}

// Sign produces a signed compact-JWS string for the given claims.
func Sign(secret []byte, c Claims) (string, error) {
	t := jwt.NewWithClaims(jwt.SigningMethodHS256, jwt.MapClaims{
		"sub": c.UserID.String(),
		"dev": c.DeviceID.String(),
		"typ": string(c.Type),
		"iat": c.IssuedAt.Unix(),
		"exp": c.Expires.Unix(),
	})
	return t.SignedString(secret)
}

// Parse verifies the signature + claims of a token and returns the decoded
// claims. Returns one of the sentinel errors above so callers can map to HTTP
// status codes deterministically.
func Parse(secret []byte, token string) (Claims, error) {
	parsed, err := jwt.Parse(token, func(tok *jwt.Token) (interface{}, error) {
		if _, ok := tok.Method.(*jwt.SigningMethodHMAC); !ok {
			return nil, fmt.Errorf("%w: %v", ErrUnsupported, tok.Method.Alg())
		}
		return secret, nil
	}, jwt.WithValidMethods([]string{jwt.SigningMethodHS256.Alg()}), jwt.WithExpirationRequired())
	if err != nil {
		if errors.Is(err, jwt.ErrTokenExpired) {
			return Claims{}, ErrExpired
		}
		return Claims{}, ErrInvalid
	}
	mc, ok := parsed.Claims.(jwt.MapClaims)
	if !ok || !parsed.Valid {
		return Claims{}, ErrInvalid
	}

	sub, _ := mc["sub"].(string)
	dev, _ := mc["dev"].(string)
	typ, _ := mc["typ"].(string)
	userID, err1 := uuid.Parse(sub)
	deviceID, err2 := uuid.Parse(dev)
	if err1 != nil || err2 != nil {
		return Claims{}, ErrInvalid
	}

	iat, ok := mc["iat"].(float64)
	if !ok || iat <= 0 {
		return Claims{}, ErrInvalid
	}
	exp, ok := mc["exp"].(float64)
	if !ok || exp <= iat {
		return Claims{}, ErrInvalid
	}
	if Type(typ) != TypeAccess && Type(typ) != TypeRefresh {
		return Claims{}, ErrWrongType
	}

	return Claims{
		UserID:   userID,
		DeviceID: deviceID,
		Type:     Type(typ),
		IssuedAt: time.Unix(int64(iat), 0),
		Expires:  time.Unix(int64(exp), 0),
	}, nil
}
