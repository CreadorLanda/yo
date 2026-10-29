package auth

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/smtp"
	"strconv"
	"time"

	"github.com/google/uuid"
)

type EmailSender interface {
	Send(ctx context.Context, recipient, code string) error
}

// PhoneSender is the delivery boundary for SMS/voice OTP providers. The
// The server never returns a production code unless APP_ENV=dev; deployments
// wire the provider through the configured HTTPS relay.
type PhoneSender interface {
	Send(ctx context.Context, recipient, code string) error
}

type HTTPPhoneSender struct {
	url   string
	token string
	http  *http.Client
}

func NewHTTPPhoneSender(url, token string) *HTTPPhoneSender {
	return &HTTPPhoneSender{url: url, token: token, http: &http.Client{Timeout: 10 * time.Second}}
}

func (s *HTTPPhoneSender) Send(ctx context.Context, recipient, code string) error {
	body, err := json.Marshal(struct {
		To      string `json:"to"`
		Code    string `json:"code"`
		Channel string `json:"channel"`
	}{To: recipient, Code: code, Channel: "sms"})
	if err != nil {
		return err
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, s.url, bytes.NewReader(body))
	if err != nil {
		return err
	}
	req.Header.Set("Content-Type", "application/json")
	if s.token != "" {
		req.Header.Set("Authorization", "Bearer "+s.token)
	}
	res, err := s.http.Do(req)
	if err != nil {
		return err
	}
	defer res.Body.Close()
	if res.StatusCode < http.StatusOK || res.StatusCode >= http.StatusMultipleChoices {
		return fmt.Errorf("sms webhook returned status %d", res.StatusCode)
	}
	return nil
}

type CredentialNotifier interface {
	NotifyUser(ctx context.Context, userID uuid.UUID, category, title, body string, data map[string]string) error
}

type SMTPConfig struct {
	Host     string
	Port     int
	Username string
	Password string
	From     string
}

type SMTPSender struct {
	cfg SMTPConfig
}

func NewSMTPSender(cfg SMTPConfig) *SMTPSender {
	return &SMTPSender{cfg: cfg}
}

func (s *SMTPSender) Send(ctx context.Context, recipient, code string) error {
	if err := ctx.Err(); err != nil {
		return err
	}
	if s.cfg.Host == "" || s.cfg.Port == 0 || s.cfg.From == "" {
		return fmt.Errorf("email sender is not configured")
	}
	addr := s.cfg.Host + ":" + strconv.Itoa(s.cfg.Port)
	var auth smtp.Auth
	if s.cfg.Username != "" {
		auth = smtp.PlainAuth("", s.cfg.Username, s.cfg.Password, s.cfg.Host)
	}
	body := []byte("To: " + recipient + "\r\n" +
		"Subject: ZwoSocial verification code\r\n" +
		"Content-Type: text/plain; charset=UTF-8\r\n\r\n" +
		"Your ZwoSocial verification code is: " + code + "\r\n")
	return smtp.SendMail(addr, auth, s.cfg.From, []string{recipient}, body)
}
