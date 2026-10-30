package messages

import (
	"encoding/base64"
	"encoding/json"
	"strings"

	"github.com/google/uuid"
)

const (
	directEnvelopePrefix = "soc1."
	groupEnvelopePrefix  = "soc1g."
	maxEnvelopeBytes     = 256 * 1024
)

type directEnvelopeHeader struct {
	Version  int    `json:"v"`
	Identity string `json:"ik"`
	Counter  int64  `json:"n"`
}

type groupEnvelopeHeader struct {
	Version int    `json:"v"`
	Sender  string `json:"s"`
	Epoch   int64  `json:"e"`
	Counter int64  `json:"n"`
}

// validateEnvelope checks only the public wire shape. It deliberately does
// not derive keys, open ciphertext, or verify a MAC.
func validateEnvelope(content string) bool {
	if content == "" || len(content) > maxEnvelopeBytes {
		return false
	}
	prefix := ""
	var header any
	switch {
	case strings.HasPrefix(content, directEnvelopePrefix):
		prefix = directEnvelopePrefix
		header = &directEnvelopeHeader{}
	case strings.HasPrefix(content, groupEnvelopePrefix):
		prefix = groupEnvelopePrefix
		header = &groupEnvelopeHeader{}
	default:
		return false
	}

	parts := strings.Split(strings.TrimPrefix(content, prefix), ".")
	if len(parts) != 2 || parts[0] == "" || parts[1] == "" {
		return false
	}
	headerBytes, err := base64.RawURLEncoding.DecodeString(parts[0])
	if err != nil || len(headerBytes) == 0 || len(headerBytes) > 4096 {
		return false
	}
	if err := json.Unmarshal(headerBytes, header); err != nil {
		return false
	}
	body, err := base64.RawURLEncoding.DecodeString(parts[1])
	if err != nil || len(body) == 0 {
		return false
	}

	switch h := header.(type) {
	case *directEnvelopeHeader:
		return h.Version == 1 && h.Identity != "" && h.Counter >= 0
	case *groupEnvelopeHeader:
		return h.Version == 1 && h.Sender != "" && h.Epoch >= 0 && h.Counter >= 0
	default:
		return false
	}
}

func validateEnvelopeForChat(content string, senderID uuid.UUID, chatType ChatType) bool {
	if chatType == ChatDirect && !strings.HasPrefix(content, directEnvelopePrefix) {
		return false
	}
	if chatType == ChatGroup && !strings.HasPrefix(content, groupEnvelopePrefix) {
		return false
	}
	if !validateEnvelope(content) {
		return false
	}
	if chatType != ChatGroup {
		return true
	}
	header, ok := groupEnvelopeHeaderOf(content)
	return ok && header.Sender == senderID.String()
}

func groupEnvelopeHeaderOf(content string) (groupEnvelopeHeader, bool) {
	var header groupEnvelopeHeader
	parts := strings.Split(strings.TrimPrefix(content, groupEnvelopePrefix), ".")
	if len(parts) != 2 {
		return header, false
	}
	b, err := base64.RawURLEncoding.DecodeString(parts[0])
	if err != nil || json.Unmarshal(b, &header) != nil {
		return header, false
	}
	return header, true
}

func envelopeError(content string) error {
	if strings.HasPrefix(content, directEnvelopePrefix) || strings.HasPrefix(content, groupEnvelopePrefix) {
		return ErrInvalidEnvelopeChat
	}
	return ErrUnencryptedMessage
}

func userSendableMessageType(t MessageType) bool {
	switch t {
	case MsgText, MsgImage, MsgVideo, MsgAudio, MsgDocument, MsgSticker,
		MsgLocation, MsgContact, MsgPoll, MsgEvent, MsgReply, MsgGame:
		return true
	default:
		return false
	}
}
