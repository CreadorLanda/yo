package messages

import (
	"context"
	"errors"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
)

// NoContactPeriod is how long two people are kept apart after one reports the
// other. Long enough to end an exchange, short enough that a malicious report
// is a nuisance and not a sentence.
const NoContactPeriod = 24 * time.Hour

const (
	maxEvidenceItems = 20
	maxEvidenceBody  = 2000
	maxReportNote    = 500
)

var (
	// ErrConsentRequired means message copies were sent without the reporter
	// agreeing to it. Decrypted content leaves the phone only on a yes.
	ErrConsentRequired = errors.New("evidence_consent_required")
)

// NoContactError is returned when two people are in a no-contact period. It
// carries the deadline so the client can say when it ends.
type NoContactError struct{ Until time.Time }

func (e NoContactError) Error() string { return "no_contact_period" }

// reportReasons are the reasons a report can give. Anything else is refused
// rather than stored, so the moderation queue stays sortable.
var reportReasons = map[string]bool{
	"spam": true, "abuse": true, "scam": true, "impersonation": true, "other": true,
}

// EvidenceInput is one message copy the reporter chose to send.
type EvidenceInput struct {
	MessageID int64  `json:"message_id"`
	Body      string `json:"body"`
}

// ReportInput is everything a report carries.
type ReportInput struct {
	Reason   string          `json:"reason"`
	Note     string          `json:"note"`
	Block    bool            `json:"block"`
	Consent  bool            `json:"consent"`
	Evidence []EvidenceInput `json:"evidence"`
}

// ReportResult is what the reporter is told afterwards.
type ReportResult struct {
	// NoContactUntil is set for a one-to-one report: the end of the period.
	NoContactUntil *time.Time `json:"no_contact_until,omitempty"`
	Blocked        bool       `json:"blocked"`
	EvidenceCount  int        `json:"evidence_count"`
}

type evidenceRow struct {
	messageID int64
	senderID  *uuid.UUID
	body      string
	sentAt    time.Time
}

// pairKey orders two ids the way contact_cooldowns stores them.
func pairKey(a, b uuid.UUID) (low, high uuid.UUID) {
	if strings.Compare(a.String(), b.String()) < 0 {
		return a, b
	}
	return b, a
}

// FileReport stores the report, its evidence and the cooldown in one
// transaction, so a report cannot exist without the period that goes with it.
//
// Filing again replaces the caller's earlier report on this chat. A repeat
// report never extends a period that is still running: otherwise one person
// could tap the button every day and keep the other locked out for good.
func (r *Repository) FileReport(ctx context.Context, chatID, reporter uuid.UUID, reported *uuid.UUID,
	in ReportInput, evidence []evidenceRow) (until *time.Time, err error) {

	tx, err := r.db.Begin(ctx)
	if err != nil {
		return nil, err
	}
	defer tx.Rollback(ctx) //nolint:errcheck

	var consentAt *time.Time
	if len(evidence) > 0 {
		now := time.Now().UTC()
		consentAt = &now
	}
	var reportID int64
	if err := tx.QueryRow(ctx, `
		INSERT INTO chat_reports (chat_id, reporter_id, reason, note, reported_id, evidence_consent_at)
		VALUES ($1, $2, $3, NULLIF($4, ''), $5, $6)
		ON CONFLICT (chat_id, reporter_id) DO UPDATE
		   SET reason = EXCLUDED.reason,
		       note = EXCLUDED.note,
		       reported_id = EXCLUDED.reported_id,
		       evidence_consent_at = EXCLUDED.evidence_consent_at,
		       status = 'open',
		       created_at = NOW()
		RETURNING id
	`, chatID, reporter, in.Reason, in.Note, reported, consentAt).Scan(&reportID); err != nil {
		return nil, err
	}

	// The copies of a replaced report are replaced with it.
	if _, err := tx.Exec(ctx, `DELETE FROM chat_report_evidence WHERE report_id = $1`, reportID); err != nil {
		return nil, err
	}
	for _, e := range evidence {
		if _, err := tx.Exec(ctx, `
			INSERT INTO chat_report_evidence (report_id, message_id, sender_id, body, sent_at)
			VALUES ($1, $2, $3, $4, $5)
		`, reportID, e.messageID, e.senderID, e.body, e.sentAt); err != nil {
			return nil, err
		}
	}

	if reported != nil {
		low, high := pairKey(reporter, *reported)
		var u time.Time
		if err := tx.QueryRow(ctx, `
			INSERT INTO contact_cooldowns (user_low, user_high, until, report_id)
			VALUES ($1, $2, NOW() + $3::interval, $4)
			ON CONFLICT (user_low, user_high) DO UPDATE
			   SET until = CASE WHEN contact_cooldowns.until > NOW()
			                    THEN contact_cooldowns.until
			                    ELSE EXCLUDED.until END,
			       report_id = CASE WHEN contact_cooldowns.until > NOW()
			                        THEN contact_cooldowns.report_id
			                        ELSE EXCLUDED.report_id END
			RETURNING until
		`, low, high, NoContactPeriod.String(), reportID).Scan(&u); err != nil {
			return nil, err
		}
		until = &u
	}
	if err := tx.Commit(ctx); err != nil {
		return nil, err
	}
	return until, nil
}

// CooldownUntil returns the end of the no-contact period between two people,
// or nil when there is none running.
func (r *Repository) CooldownUntil(ctx context.Context, a, b uuid.UUID) (*time.Time, error) {
	low, high := pairKey(a, b)
	var until time.Time
	err := r.db.QueryRow(ctx, `
		SELECT until FROM contact_cooldowns
		WHERE user_low = $1 AND user_high = $2 AND until > NOW()
	`, low, high).Scan(&until)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	return &until, nil
}

// evidenceMessages reads who sent which message and when, for the ids that
// belong to this chat. Anything missing from the result is not in the chat.
func (r *Repository) evidenceMessages(ctx context.Context, chatID uuid.UUID, ids []int64) (map[int64]evidenceRow, error) {
	rows, err := r.db.Query(ctx, `
		SELECT id, sender_id, created_at FROM messages
		WHERE chat_id = $1 AND id = ANY($2)
	`, chatID, ids)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := make(map[int64]evidenceRow, len(ids))
	for rows.Next() {
		var e evidenceRow
		if err := rows.Scan(&e.messageID, &e.senderID, &e.sentAt); err != nil {
			return nil, err
		}
		out[e.messageID] = e
	}
	return out, rows.Err()
}

// PurgeExpiredReportData drops evidence past its retention and cooldown rows
// that ended long ago.
func (r *Repository) PurgeExpiredReportData(ctx context.Context) (int64, error) {
	a, err := r.db.Exec(ctx, `DELETE FROM chat_report_evidence WHERE expires_at < NOW()`)
	if err != nil {
		return 0, err
	}
	b, err := r.db.Exec(ctx, `DELETE FROM contact_cooldowns WHERE until < NOW() - INTERVAL '7 days'`)
	if err != nil {
		return a.RowsAffected(), err
	}
	return a.RowsAffected() + b.RowsAffected(), nil
}

// validateReport checks the parts of a report that need no database.
func validateReport(in ReportInput) error {
	if !reportReasons[in.Reason] {
		return ErrInvalidReport
	}
	if utf8.RuneCountInString(in.Note) > maxReportNote {
		return ErrInvalidReport
	}
	if len(in.Evidence) > maxEvidenceItems {
		return ErrInvalidReport
	}
	if len(in.Evidence) > 0 && !in.Consent {
		return ErrConsentRequired
	}
	seen := make(map[int64]bool, len(in.Evidence))
	for _, e := range in.Evidence {
		body := strings.TrimSpace(e.Body)
		if e.MessageID <= 0 || seen[e.MessageID] ||
			body == "" || utf8.RuneCountInString(body) > maxEvidenceBody {
			return ErrInvalidReport
		}
		seen[e.MessageID] = true
	}
	return nil
}
