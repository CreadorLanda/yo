package auth

import (
	"crypto/sha256"
	"encoding/base64"
	"testing"
)

func TestOTPVerifierUsesPepper(t *testing.T) {
	phone, code := "+244900000000", "123456"
	pepper := "server-only-test-pepper"

	got := otpDigest(phone, code, pepper)
	plain := sha256.Sum256([]byte(phone + ":" + code))
	if got == base64.RawURLEncoding.EncodeToString(plain[:]) {
		t.Fatal("OTP verifier must not be a bare SHA-256 digest")
	}
	if got != otpDigest(phone, code, pepper) {
		t.Fatal("OTP verifier is not deterministic")
	}
	if got == otpDigest(phone, code, "another-pepper") {
		t.Fatal("OTP verifier ignores the server pepper")
	}
}
