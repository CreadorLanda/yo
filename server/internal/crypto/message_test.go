package crypto_test

import (
	"encoding/hex"
	"strings"
	"testing"

	"github.com/CreadorLanda/yo/server/internal/crypto"
)

// 64 hex chars = 32 bytes = AES-256 key.
var testKey, _ = hex.DecodeString("a7228607d5120b804e13d6d76b9162d89b6bf407a11cc6389c5a31bd320ca5a6")

func TestRoundTrip(t *testing.T) {
	plaintext := "Hello, this is a secret message!"
	enc, err := crypto.Encrypt(plaintext, testKey)
	if err != nil {
		t.Fatalf("encrypt: %v", err)
	}
	if enc == "" {
		t.Fatal("encrypt returned empty string")
	}
	if enc == plaintext {
		t.Fatal("encrypt returned plaintext (no encryption)")
	}
	dec, err := crypto.Decrypt(enc, testKey)
	if err != nil {
		t.Fatalf("decrypt: %v", err)
	}
	if dec != plaintext {
		t.Fatalf("round trip mismatch: got %q, want %q", dec, plaintext)
	}
}

func TestTamperedCiphertext(t *testing.T) {
	enc, err := crypto.Encrypt("secret", testKey)
	if err != nil {
		t.Fatalf("encrypt: %v", err)
	}
	if len(enc) < 4 {
		t.Fatal("ciphertext too short to test tamper")
	}
	replacement := byte('0')
	if enc[2] == replacement {
		replacement = '1'
	}
	corrupt := enc[:2] + string(replacement) + enc[3:]
	_, err = crypto.Decrypt(corrupt, testKey)
	if err == nil {
		t.Fatal("expected error for tampered ciphertext, got nil")
	}
}

func TestWrongKey(t *testing.T) {
	key2, _ := hex.DecodeString("a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0c1d2e3f4a5b6c7d8e9f0")
	enc, _ := crypto.Encrypt("secret", testKey)
	_, err := crypto.Decrypt(enc, key2)
	if err == nil {
		t.Fatal("expected error for wrong key, got nil")
	}
}

func TestEmptyInput(t *testing.T) {
	_, err := crypto.Encrypt("", testKey)
	if err == nil {
		t.Fatal("expected error for empty input, got nil")
	}
}

func TestEmptyKey(t *testing.T) {
	_, err := crypto.Encrypt("hello", nil)
	if err == nil || !strings.Contains(err.Error(), "empty") {
		t.Fatalf("expected empty key error, got %v", err)
	}
}

func TestShortKey(t *testing.T) {
	_, err := crypto.Encrypt("hello", []byte("short"))
	if err == nil || !strings.Contains(err.Error(), "32 bytes") {
		t.Fatalf("expected 32-byte key error, got %v", err)
	}
}
