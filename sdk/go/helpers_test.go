package zwosocial

import (
	"crypto/hmac"
	"crypto/sha256"
	"encoding/hex"
)

func hmacHex(secret, msg string) string {
	m := hmac.New(sha256.New, []byte(secret))
	m.Write([]byte(msg))
	return hex.EncodeToString(m.Sum(nil))
}
