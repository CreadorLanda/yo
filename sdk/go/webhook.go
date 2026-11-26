package zwosocial

import (
	"crypto/hmac"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"io"
	"math"
	"net/http"
	"strconv"
	"time"
)

// SignatureWindow is how far a delivery's timestamp may be from this clock.
const SignatureWindow = 5 * time.Minute

// VerifySignature checks a webhook delivery: the HMAC over
// timestamp + "." + body, and a timestamp within SignatureWindow, so a
// captured request replayed later fails.
func VerifySignature(secret, timestamp string, body []byte, signature string, now time.Time) bool {
	ts, err := strconv.ParseInt(timestamp, 10, 64)
	if err != nil || math.Abs(now.Sub(time.Unix(ts, 0)).Seconds()) > SignatureWindow.Seconds() {
		return false
	}
	mac := hmac.New(sha256.New, []byte(secret))
	mac.Write([]byte(timestamp + "." + string(body)))
	expected := "sha256=" + hex.EncodeToString(mac.Sum(nil))
	return hmac.Equal([]byte(expected), []byte(signature))
}

// WebhookHandler verifies each delivery and hands the event on.
func WebhookHandler(secret string, onEvent func(Event) error) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost {
			http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
			return
		}
		body, err := io.ReadAll(io.LimitReader(r.Body, 1<<20))
		if err != nil || !VerifySignature(secret, r.Header.Get("X-ZwoSocial-Timestamp"), body, r.Header.Get("X-ZwoSocial-Signature"), time.Now()) {
			http.Error(w, "bad signature", http.StatusUnauthorized)
			return
		}
		var e Event
		if err := json.Unmarshal(body, &e); err != nil {
			http.Error(w, "bad body", http.StatusBadRequest)
			return
		}
		if err := onEvent(e); err != nil {
			http.Error(w, "handler failed", http.StatusInternalServerError)
			return
		}
		w.WriteHeader(http.StatusOK)
	})
}
