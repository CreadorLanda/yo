package lives

import (
	"context"
	"errors"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
)

// Member is someone's part in a live beyond watching it.
type Member struct {
	UserID       uuid.UUID `json:"user_id"`
	Name         string    `json:"name"`
	Cohost       bool      `json:"cohost"`
	CohostAnswer *string   `json:"cohost_answer,omitempty"`
	Moderator    bool      `json:"moderator"`
	Allowed      bool      `json:"-"`
	// Stage is invited, requested or on; empty when not speaking.
	Stage *string `json:"stage,omitempty"`
}

// Stage states.
const (
	StageInvited   = "invited"
	StageRequested = "requested"
	StageOn        = "on"
)

// Comment is one line in a live's chat.
type Comment struct {
	ID        int64     `json:"id"`
	LiveID    uuid.UUID `json:"live_id"`
	UserID    uuid.UUID `json:"user_id"`
	Name      string    `json:"name"`
	Body      string    `json:"body"`
	CreatedAt time.Time `json:"created_at"`
}

// Viewer is someone in the audience, as a moderator sees them.
type Viewer struct {
	UserID    uuid.UUID `json:"user_id"`
	Name      string    `json:"name"`
	Moderator bool      `json:"moderator"`
	Stage     *string   `json:"stage,omitempty"`
}

// Banned is someone who may not come back.
type Banned struct {
	UserID uuid.UUID `json:"user_id"`
	Name   string    `json:"name"`
}

// Stats are the numbers a host looks at, during and after.
type Stats struct {
	Viewers        int   `json:"viewers"`
	PeakViewers    int   `json:"peak_viewers"`
	UniqueViewers  int   `json:"unique_viewers"`
	Hearts         int64 `json:"hearts"`
	Comments       int   `json:"comments"`
	DurationSecond int64 `json:"duration_seconds"`
}

const memberColumns = `
	m.user_id, COALESCE(u.display_name, ''), m.cohost, m.cohost_answer,
	m.moderator, m.allowed, m.stage
`

func scanMember(row pgx.Row) (Member, error) {
	var m Member
	err := row.Scan(&m.UserID, &m.Name, &m.Cohost, &m.CohostAnswer, &m.Moderator, &m.Allowed, &m.Stage)
	return m, err
}

// Member returns someone's row, and false when they have none.
func (r *Repo) Member(ctx context.Context, liveID, userID uuid.UUID) (Member, bool, error) {
	m, err := scanMember(r.db.QueryRow(ctx, `
		SELECT `+memberColumns+`
		FROM live_members m LEFT JOIN users u ON u.id = m.user_id
		WHERE m.live_id = $1 AND m.user_id = $2
	`, liveID, userID))
	if errors.Is(err, pgx.ErrNoRows) {
		return Member{UserID: userID}, false, nil
	}
	return m, err == nil, err
}

// Members is everyone with a part to play: co-hosts, moderators, and anyone
// on, invited to, or asking for the stage. The plain guest list of a
// 'selected' live is left out; it can be long and nobody acts on it here.
func (r *Repo) Members(ctx context.Context, liveID uuid.UUID) ([]Member, error) {
	rows, err := r.db.Query(ctx, `
		SELECT `+memberColumns+`
		FROM live_members m LEFT JOIN users u ON u.id = m.user_id
		WHERE m.live_id = $1 AND (m.cohost OR m.moderator OR m.stage IS NOT NULL)
		ORDER BY m.cohost DESC, m.moderator DESC, u.display_name
	`, liveID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []Member{}
	for rows.Next() {
		m, err := scanMember(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, m)
	}
	return out, rows.Err()
}

func (r *Repo) ids(ctx context.Context, q string, args ...any) ([]uuid.UUID, error) {
	rows, err := r.db.Query(ctx, q, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []uuid.UUID{}
	for rows.Next() {
		var id uuid.UUID
		if err := rows.Scan(&id); err != nil {
			return nil, err
		}
		out = append(out, id)
	}
	return out, rows.Err()
}

// CohostIDs is the other hosts of a joint live.
func (r *Repo) CohostIDs(ctx context.Context, liveID uuid.UUID) ([]uuid.UUID, error) {
	return r.ids(ctx, `SELECT user_id FROM live_members WHERE live_id = $1 AND cohost`, liveID)
}

// AllowedIDs is the guest list of a 'selected' live, plus anyone invited.
func (r *Repo) AllowedIDs(ctx context.Context, liveID uuid.UUID) ([]uuid.UUID, error) {
	return r.ids(ctx, `SELECT user_id FROM live_members WHERE live_id = $1 AND allowed`, liveID)
}

// ModeratorIDs is the moderators the live itself appointed, co-hosts included.
func (r *Repo) ModeratorIDs(ctx context.Context, liveID uuid.UUID) ([]uuid.UUID, error) {
	return r.ids(ctx, `SELECT user_id FROM live_members WHERE live_id = $1 AND moderator`, liveID)
}

// upsert changes one column of someone's row, creating the row if needed.
func (r *Repo) upsert(ctx context.Context, liveID, userID, by uuid.UUID, set string, arg any) error {
	_, err := r.db.Exec(ctx, `
		INSERT INTO live_members (live_id, user_id, invited_by) VALUES ($1, $2, $3)
		ON CONFLICT (live_id, user_id) DO NOTHING
	`, liveID, userID, by)
	if err != nil {
		return err
	}
	_, err = r.db.Exec(ctx, `
		UPDATE live_members SET `+set+` = $3, updated_at = NOW()
		WHERE live_id = $1 AND user_id = $2
	`, liveID, userID, arg)
	return err
}

func (r *Repo) SetCohostAnswer(ctx context.Context, liveID, userID uuid.UUID, answer string) error {
	_, err := r.db.Exec(ctx, `
		UPDATE live_members SET cohost_answer = $3, updated_at = NOW()
		WHERE live_id = $1 AND user_id = $2 AND cohost
	`, liveID, userID, answer)
	return err
}

func (r *Repo) SetModerator(ctx context.Context, liveID, userID, by uuid.UUID, on bool) error {
	return r.upsert(ctx, liveID, userID, by, "moderator", on)
}

// SetStage puts someone on, off, or on the way to the stage. nil clears it.
func (r *Repo) SetStage(ctx context.Context, liveID, userID, by uuid.UUID, stage *string) error {
	return r.upsert(ctx, liveID, userID, by, "stage", stage)
}

func (r *Repo) Allow(ctx context.Context, liveID, userID, by uuid.UUID) error {
	return r.upsert(ctx, liveID, userID, by, "allowed", true)
}

// Ban records the ban, takes them off the stage and out of the audience in
// one go, so the count and the stage never show someone who is gone.
func (r *Repo) Ban(ctx context.Context, liveID, userID, by uuid.UUID) error {
	tx, err := r.db.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx) //nolint:errcheck
	if _, err := tx.Exec(ctx, `
		INSERT INTO live_bans (live_id, user_id, banned_by) VALUES ($1, $2, $3)
		ON CONFLICT DO NOTHING
	`, liveID, userID, by); err != nil {
		return err
	}
	if _, err := tx.Exec(ctx, `
		UPDATE live_members SET stage = NULL, moderator = FALSE, allowed = FALSE, updated_at = NOW()
		WHERE live_id = $1 AND user_id = $2
	`, liveID, userID); err != nil {
		return err
	}
	if _, err := tx.Exec(ctx, `
		UPDATE live_viewers SET left_at = NOW()
		WHERE live_id = $1 AND user_id = $2 AND left_at IS NULL
	`, liveID, userID); err != nil {
		return err
	}
	return tx.Commit(ctx)
}

func (r *Repo) Unban(ctx context.Context, liveID, userID uuid.UUID) error {
	_, err := r.db.Exec(ctx, `DELETE FROM live_bans WHERE live_id = $1 AND user_id = $2`, liveID, userID)
	return err
}

func (r *Repo) IsBanned(ctx context.Context, liveID, userID uuid.UUID) (bool, error) {
	var ok bool
	err := r.db.QueryRow(ctx,
		`SELECT EXISTS (SELECT 1 FROM live_bans WHERE live_id = $1 AND user_id = $2)`,
		liveID, userID).Scan(&ok)
	return ok, err
}

func (r *Repo) Bans(ctx context.Context, liveID uuid.UUID) ([]Banned, error) {
	rows, err := r.db.Query(ctx, `
		SELECT b.user_id, COALESCE(u.display_name, '')
		FROM live_bans b LEFT JOIN users u ON u.id = b.user_id
		WHERE b.live_id = $1 ORDER BY b.created_at DESC
	`, liveID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []Banned{}
	for rows.Next() {
		var b Banned
		if err := rows.Scan(&b.UserID, &b.Name); err != nil {
			return nil, err
		}
		out = append(out, b)
	}
	return out, rows.Err()
}

// Audience is who is watching right now, with what a moderator needs to act
// on them.
func (r *Repo) Audience(ctx context.Context, liveID uuid.UUID) ([]Viewer, error) {
	rows, err := r.db.Query(ctx, `
		SELECT v.user_id, COALESCE(u.display_name, ''),
		       COALESCE(m.moderator, FALSE), m.stage
		FROM live_viewers v
		LEFT JOIN users u ON u.id = v.user_id
		LEFT JOIN live_members m ON m.live_id = v.live_id AND m.user_id = v.user_id
		WHERE v.live_id = $1 AND v.left_at IS NULL
		ORDER BY v.joined_at
	`, liveID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []Viewer{}
	for rows.Next() {
		var v Viewer
		if err := rows.Scan(&v.UserID, &v.Name, &v.Moderator, &v.Stage); err != nil {
			return nil, err
		}
		out = append(out, v)
	}
	return out, rows.Err()
}

func (r *Repo) AddComment(ctx context.Context, liveID, userID uuid.UUID, body string) (Comment, error) {
	c := Comment{LiveID: liveID, UserID: userID, Body: body}
	err := r.db.QueryRow(ctx, `
		WITH ins AS (
			INSERT INTO live_comments (live_id, user_id, body) VALUES ($1, $2, $3)
			RETURNING id, created_at
		)
		SELECT ins.id, ins.created_at, COALESCE(u.display_name, '')
		FROM ins LEFT JOIN users u ON u.id = $2
	`, liveID, userID, body).Scan(&c.ID, &c.CreatedAt, &c.Name)
	return c, err
}

// Comments is the most recent ones still standing, oldest first.
func (r *Repo) Comments(ctx context.Context, liveID uuid.UUID, limit int) ([]Comment, error) {
	rows, err := r.db.Query(ctx, `
		SELECT * FROM (
			SELECT c.id, c.live_id, c.user_id, COALESCE(u.display_name, ''), c.body, c.created_at
			FROM live_comments c LEFT JOIN users u ON u.id = c.user_id
			WHERE c.live_id = $1 AND c.deleted_at IS NULL
			ORDER BY c.id DESC LIMIT $2
		) t ORDER BY id
	`, liveID, limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []Comment{}
	for rows.Next() {
		var c Comment
		if err := rows.Scan(&c.ID, &c.LiveID, &c.UserID, &c.Name, &c.Body, &c.CreatedAt); err != nil {
			return nil, err
		}
		out = append(out, c)
	}
	return out, rows.Err()
}

// CommentAuthor is who wrote a comment still standing in this live.
func (r *Repo) CommentAuthor(ctx context.Context, liveID uuid.UUID, id int64) (uuid.UUID, error) {
	var author uuid.UUID
	err := r.db.QueryRow(ctx, `
		SELECT user_id FROM live_comments WHERE live_id = $1 AND id = $2 AND deleted_at IS NULL
	`, liveID, id).Scan(&author)
	return author, err
}

func (r *Repo) DeleteComment(ctx context.Context, liveID uuid.UUID, id int64, by uuid.UUID) error {
	_, err := r.db.Exec(ctx, `
		UPDATE live_comments SET deleted_at = NOW(), deleted_by = $3
		WHERE live_id = $1 AND id = $2 AND deleted_at IS NULL
	`, liveID, id, by)
	return err
}

func (r *Repo) AddHearts(ctx context.Context, liveID uuid.UUID, n int) error {
	_, err := r.db.Exec(ctx,
		`UPDATE lives SET hearts = hearts + $2 WHERE id = $1 AND ended_at IS NULL`, liveID, n)
	return err
}

func (r *Repo) SetCommentsEnabled(ctx context.Context, liveID uuid.UUID, on bool) error {
	_, err := r.db.Exec(ctx, `UPDATE lives SET comments_enabled = $2 WHERE id = $1`, liveID, on)
	return err
}

func (r *Repo) Stats(ctx context.Context, liveID uuid.UUID) (Stats, error) {
	var s Stats
	err := r.db.QueryRow(ctx, `
		SELECT
			(SELECT count(*) FROM live_viewers v WHERE v.live_id = l.id AND v.left_at IS NULL),
			l.peak_viewers,
			(SELECT count(*) FROM live_viewers v WHERE v.live_id = l.id),
			l.hearts,
			(SELECT count(*) FROM live_comments c WHERE c.live_id = l.id),
			EXTRACT(EPOCH FROM (COALESCE(l.ended_at, NOW()) - l.started_at))::BIGINT
		FROM lives l WHERE l.id = $1
	`, liveID).Scan(&s.Viewers, &s.PeakViewers, &s.UniqueViewers, &s.Hearts, &s.Comments, &s.DurationSecond)
	return s, err
}
