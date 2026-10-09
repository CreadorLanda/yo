// Package crypto provides message-level encryption for the ZwoSocial backend.
//
// Message content is encrypted with AES-256-GCM before it reaches the
// database (encryption at rest). The key comes from MESSAGE_KEY and is
// never logged or exposed.
//
// Design:
//   - AES-256-GCM (authenticated encryption) — provides both confidentiality
//     and integrity. Without the key, tampering with ciphertext is detected.
//   - Each encryption generates a fresh random 12-byte nonce (the standard
//     GCM nonce size). The nonce is prepended to the ciphertext.
//   - The stored format is: nonce (12) || ciphertext (variable) || auth tag (16)
//     encoded as hex for safe TEXT column storage.
//   - Decryption returns an error if the key is wrong, the ciphertext was
//     tampered with, or the nonce is invalid — forgeability is zero.
package crypto

import (
	"crypto/aes"
	"crypto/cipher"
	"crypto/rand"
	"encoding/hex"
	"errors"
	"fmt"
	"io"
)

var (
	ErrEmptyKey    = errors.New("encryption key is empty")
	ErrInvalidKey  = errors.New("encryption key must be exactly 32 bytes for AES-256")
	ErrDecryptFail = errors.New("decryption failed — key mismatch or tampered ciphertext")
	ErrEmptyInput  = errors.New("cannot encrypt empty input")
	ErrInvalidHex  = errors.New("invalid hex ciphertext")
	ErrTooShort    = errors.New("ciphertext too short (missing nonce)")
)

// Encrypt plaintext using AES-256-GCM. Returns hex( nonce || ciphertext || tag ).
// The key MUST be exactly 32 bytes.
func Encrypt(plaintext string, key []byte) (string, error) {
	if len(key) == 0 {
		return "", ErrEmptyKey
	}
	if len(key) != 32 {
		return "", ErrInvalidKey
	}
	if plaintext == "" {
		return "", ErrEmptyInput
	}

	block, err := aes.NewCipher(key)
	if err != nil {
		return "", fmt.Errorf("aes new cipher: %w", err)
	}

	gcm, err := cipher.NewGCM(block)
	if err != nil {
		return "", fmt.Errorf("aes gcm: %w", err)
	}

	nonce := make([]byte, gcm.NonceSize())
	if _, err := io.ReadFull(rand.Reader, nonce); err != nil {
		return "", fmt.Errorf("nonce: %w", err)
	}

	// Seal appends the encrypted data AND the auth tag to the nonce.
	ciphertext := gcm.Seal(nonce, nonce, []byte(plaintext), nil)
	return hex.EncodeToString(ciphertext), nil
}

// Decrypt reverses Encrypt. Returns the original plaintext.
func Decrypt(encoded string, key []byte) (string, error) {
	if len(key) == 0 {
		return "", ErrEmptyKey
	}
	if len(key) != 32 {
		return "", ErrInvalidKey
	}
	if encoded == "" {
		return "", nil
	}

	raw, err := hex.DecodeString(encoded)
	if err != nil {
		return "", ErrInvalidHex
	}

	block, err := aes.NewCipher(key)
	if err != nil {
		return "", fmt.Errorf("aes new cipher: %w", err)
	}

	gcm, err := cipher.NewGCM(block)
	if err != nil {
		return "", fmt.Errorf("aes gcm: %w", err)
	}

	nonceSize := gcm.NonceSize()
	if len(raw) < nonceSize {
		return "", ErrTooShort
	}

	nonce, ciphertext := raw[:nonceSize], raw[nonceSize:]
	plaintext, err := gcm.Open(nil, nonce, ciphertext, nil)
	if err != nil {
		return "", ErrDecryptFail
	}

	return string(plaintext), nil
}
