package auth

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestHTTPPhoneSenderSendsAuthenticatedSMSPayload(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost || r.Header.Get("Content-Type") != "application/json" {
			t.Errorf("request = %s %s %q", r.Method, r.URL.Path, r.Header.Get("Content-Type"))
		}
		if r.Header.Get("Authorization") != "Bearer relay-secret" {
			t.Errorf("authorization = %q", r.Header.Get("Authorization"))
		}
		var payload struct {
			To      string `json:"to"`
			Code    string `json:"code"`
			Channel string `json:"channel"`
		}
		if err := json.NewDecoder(r.Body).Decode(&payload); err != nil {
			t.Errorf("decode payload: %v", err)
		}
		if payload.To != "+244900000000" || payload.Code != "123456" || payload.Channel != "sms" {
			t.Errorf("payload = %+v", payload)
		}
		w.WriteHeader(http.StatusAccepted)
	}))
	defer server.Close()

	sender := NewHTTPPhoneSender(server.URL, "relay-secret")
	if err := sender.Send(context.Background(), "+244900000000", "123456"); err != nil {
		t.Fatalf("Send: %v", err)
	}
}

func TestHTTPPhoneSenderRejectsProviderFailure(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusBadGateway)
	}))
	defer server.Close()

	if err := NewHTTPPhoneSender(server.URL, "").Send(context.Background(), "+244900000000", "123456"); err == nil {
		t.Fatal("Send returned nil for a failed SMS relay")
	}
}
