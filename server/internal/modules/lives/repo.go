package lives

import (
	"context"
	"errors"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

// Live is one broadcast.
type Live struct {
	ID uuid.UUID `json:"id"`
	// At most one of these is set: where the broadcast lives. Neither means it
	// was started from Stories and its audience is whoever the host picked.
	ChannelID *uuid.UUID `json:"channel_id,omitempty"`
	ChatID    *uuid.UUID `json:"chat_id,omitempty"`
	HostID    uuid.UUID  `json:"host_id"`
	HostName  string     `json:"host_name"`
	Title     string     `json:"title"`
	StartedAt time.Time  `json:"started_at"`
	EndedAt   *time.Time `json:"ended_at,omitempty"`
	// Viewers is the audience right now, excluding the host. Once the
	// broadcast ends this is zero and PeakViewers is what is left.
	Viewers     int `json:"viewers"`
	PeakViewers int `json:"peak_viewers"`
	// Audience is who may watch: place, contacts, selected or public.
	Audience AudienceKind `json:"audience"`
	// Joint means started in a direct chat, so both people host it.
	Joint           bool  `json:"joint"`
	CommentsEnabled bool  `json:"comments_enabled"`
	Hearts          int64 `json:"hearts"`
}

// AudienceKind is who may watch a live.
type AudienceKind string

const (
	// AudiencePlace is the members of the chat, group or channel.
	AudiencePlace AudienceKind = "place"
	// AudienceContacts is everyone a host has a conversation with.
	AudienceContacts AudienceKind = "contacts"
	// AudienceSelected is the people the host picked, plus anyone invited.
	AudienceSelected AudienceKind = "selected"
	// AudiencePublic is anyone who has the link.
	AudiencePublic AudienceKind = "public"
)

func (a AudienceKind) valid() bool {
	switch a {
	case AudiencePlace, AudienceContacts, AudienceSelected, AudiencePublic:
		return true
	}
	return false
}

// Running reports whether it is still on.
func (l Live) Running() bool { return l.EndedAt == nil }

type StartInput struct {
	ChannelID *uuid.UUID
	ChatID    *uuid.UUID
	Title     string
	// Audience defaults to the place when there is one, and to contacts for a
	// live from Stories.
	Audience AudienceKind
	// Viewers is the guest list for a 'selected' audience.
	Viewers []uuid.UUID
	// Cohost is the other person in a direct chat. Set by the service, never
	// taken from the request.
	Cohost *uuid.UUID
}

type Repo struct{ db *pgxpool.Pool }

func NewRepo(db *pgxpool.Pool) *Repo { return &Repo{db: db} }

const liveColumns = `
	l.id, l.channel_id, l.chat_id, l.host_id, COALESCE(u.display_name, ''),
	l.title, l.started_at, l.ended_at, l.peak_viewers,
	(SELECT count(*) FROM live_viewers v WHERE v.live_id = l.id AND v.left_at IS NULL),
	l.audience, l.joint, l.comments_enabled, l.hearts
`

func scanLive(row pgx.Row) (Live, error) {
	var l Live
	err := row.Scan(&l.ID, &l.ChannelID, &l.ChatID, &l.HostID, &l.HostName,
		&l.Title, &l.StartedAt, &l.EndedAt, &l.PeakViewers, &l.Viewers,
		&l.Audience, &l.Joint, &l.CommentsEnabled, &l.Hearts)
	return l, err
}

// Start opens a broadcast.
//
// Refuses when one is already running in the same place. The unique partial
// indexes make that the database's answer rather than a check-then-insert,
// which two people pressing "go live" at the same moment would both pass.
func (r *Repo) Start(ctx context.Context, in StartInput, host uuid.UUID) (Live, error) {
	tx, err := r.db.Begin(ctx)
	if err != nil {
		return Live{}, err
	}
	defer tx.Rollback(ctx) //nolint:errcheck

	if in.Audience == "" {
		in.Audience = AudienceContacts
		if in.ChannelID != nil || in.ChatID != nil {
			in.Audience = AudiencePlace
		}
	}

	var id uuid.UUID
	err = tx.QueryRow(ctx, `
		INSERT INTO lives (channel_id, chat_id, host_id, title, audience, joint)
		VALUES ($1, $2, $3, $4, $5, $6) RETURNING id
	`, in.ChannelID, in.ChatID, host, in.Title, in.Audience, in.Cohost != nil).Scan(&id)
	if err != nil {
		if isUniqueViolation(err) {
			return Live{}, ErrAlreadyLive
		}
		return Live{}, err
	}

	// The other person in a joint live is a co-host and a moderator from the
	// start, waiting to answer like a ringing call.
	if in.Cohost != nil {
		if _, err := tx.Exec(ctx, `
			INSERT INTO live_members (live_id, user_id, cohost, cohost_answer, moderator, invited_by)
			VALUES ($1, $2, TRUE, 'pending', TRUE, $3)
		`, id, *in.Cohost, host); err != nil {
			return Live{}, err
		}
	}
	for _, v := range in.Viewers {
		if v == host {
			continue
		}
		if _, err := tx.Exec(ctx, `
			INSERT INTO live_members (live_id, user_id, allowed, invited_by)
			VALUES ($1, $2, TRUE, $3)
			ON CONFLICT (live_id, user_id) DO UPDATE SET allowed = TRUE
		`, id, v, host); err != nil {
			return Live{}, err
		}
	}
	if err := tx.Commit(ctx); err != nil {
		return Live{}, err
	}
	return r.Get(ctx, id)
}

func (r *Repo) Get(ctx context.Context, id uuid.UUID) (Live, error) {
	return scanLive(r.db.QueryRow(ctx, `
		SELECT `+liveColumns+`
		FROM lives l LEFT JOIN users u ON u.id = l.host_id
		WHERE l.id = $1
	`, id))
}

// RunningFor lists the broadcasts this user may watch right now.
//
// The same rules as Join, in one query: a place audience follows the chat or
// channel (a public channel admits anyone); contacts and public lives show to
// the hosts' contacts; a selected live shows to its guest list. Anyone with a
// part in a live sees it, and a ban hides it.
func (r *Repo) RunningFor(ctx context.Context, userID uuid.UUID) ([]Live, error) {
	rows, err := r.db.Query(ctx, `
		SELECT `+liveColumns+`
		FROM lives l
		LEFT JOIN users u ON u.id = l.host_id
		LEFT JOIN channels c ON c.id = l.channel_id
		WHERE l.ended_at IS NULL
		  AND NOT EXISTS (SELECT 1 FROM live_bans b WHERE b.live_id = l.id AND b.user_id = $1)
		  AND (
		    l.host_id = $1
		    OR EXISTS (SELECT 1 FROM live_members m
		               WHERE m.live_id = l.id AND m.user_id = $1
		                 AND (m.cohost OR m.moderator OR m.allowed OR m.stage IS NOT NULL))
		    OR (l.audience = 'place' AND (
		        (l.channel_id IS NOT NULL AND (
		            c.visibility = 'public'
		            OR EXISTS (SELECT 1 FROM channel_members m
		                       WHERE m.channel_id = l.channel_id AND m.user_id = $1)
		        ))
		        OR
		        (l.chat_id IS NOT NULL AND EXISTS (
		            SELECT 1 FROM chat_participants p
		            WHERE p.chat_id = l.chat_id AND p.user_id = $1))
		    ))
		    OR (l.audience IN ('contacts', 'public') AND EXISTS (
		        SELECT 1
		        FROM chat_participants me
		        JOIN chats dc ON dc.id = me.chat_id AND dc.type = 'direct' AND dc.status = 'active'
		        JOIN chat_participants them ON them.chat_id = dc.id AND them.user_id <> me.user_id
		        WHERE me.user_id = $1
		          AND (them.user_id = l.host_id OR them.user_id IN (
		              SELECT h.user_id FROM live_members h WHERE h.live_id = l.id AND h.cohost))
		    ))
		  )
		ORDER BY l.started_at DESC
		LIMIT 50
	`, userID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	out := []Live{}
	for rows.Next() {
		l, err := scanLive(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, l)
	}
	return out, rows.Err()
}

// Watch adds someone to the audience and returns the new count.
//
// Rejoining clears left_at rather than inserting again: someone whose
// connection dropped and came back is one viewer, not two, and a counter that
// only goes up is a counter nobody can trust.
func (r *Repo) Watch(ctx context.Context, liveID, userID uuid.UUID) (int, error) {
	if _, err := r.db.Exec(ctx, `
		INSERT INTO live_viewers (live_id, user_id) VALUES ($1, $2)
		ON CONFLICT (live_id, user_id)
		DO UPDATE SET left_at = NULL, joined_at = COALESCE(live_viewers.joined_at, NOW())
	`, liveID, userID); err != nil {
		return 0, err
	}
	n, err := r.ViewerCount(ctx, liveID)
	if err != nil {
		return 0, err
	}
	// The peak is the number worth keeping: the live count vanishes with the
	// broadcast, and "42 people watched" is what remains of it.
	_, _ = r.db.Exec(ctx,
		`UPDATE lives SET peak_viewers = $2 WHERE id = $1 AND peak_viewers < $2`, liveID, n)
	return n, nil
}

// Unwatch takes someone out and returns the new count.
func (r *Repo) Unwatch(ctx context.Context, liveID, userID uuid.UUID) (int, error) {
	if _, err := r.db.Exec(ctx, `
		UPDATE live_viewers SET left_at = NOW()
		WHERE live_id = $1 AND user_id = $2 AND left_at IS NULL
	`, liveID, userID); err != nil {
		return 0, err
	}
	return r.ViewerCount(ctx, liveID)
}

func (r *Repo) ViewerCount(ctx context.Context, liveID uuid.UUID) (int, error) {
	var n int
	err := r.db.QueryRow(ctx,
		`SELECT count(*) FROM live_viewers WHERE live_id = $1 AND left_at IS NULL`,
		liveID).Scan(&n)
	return n, err
}

// Watching is who has the broadcast open, for telling them the count changed.
func (r *Repo) Watching(ctx context.Context, liveID uuid.UUID) ([]uuid.UUID, error) {
	rows, err := r.db.Query(ctx,
		`SELECT user_id FROM live_viewers WHERE live_id = $1 AND left_at IS NULL`, liveID)
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

// End closes a broadcast and empties its audience.
//
// The viewers are marked as gone in the same statement, or a live that ended
// would keep reporting the people who were watching when it did.
func (r *Repo) End(ctx context.Context, liveID uuid.UUID) error {
	tx, err := r.db.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx) //nolint:errcheck

	if _, err := tx.Exec(ctx,
		`UPDATE lives SET ended_at = NOW() WHERE id = $1 AND ended_at IS NULL`, liveID); err != nil {
		return err
	}
	if _, err := tx.Exec(ctx,
		`UPDATE live_viewers SET left_at = NOW() WHERE live_id = $1 AND left_at IS NULL`,
		liveID); err != nil {
		return err
	}
	return tx.Commit(ctx)
}

// SweepStale closes broadcasts nobody can still be in.
//
// The host is not a reliable reporter of the end: their phone may die, lose
// signal, or be closed mid-sentence. Without this a dead broadcast stays live
// forever and the audience is offered a room with nothing in it — the same
// fault calls had, for the same reason.
func (r *Repo) SweepStale(ctx context.Context, olderThan time.Duration) (int64, error) {
	tag, err := r.db.Exec(ctx, `
		UPDATE lives SET ended_at = NOW()
		WHERE ended_at IS NULL AND started_at < NOW() - $1::interval
	`, olderThan.String())
	if err != nil {
		return 0, err
	}
	if tag.RowsAffected() > 0 {
		_, _ = r.db.Exec(ctx, `
			UPDATE live_viewers v SET left_at = NOW()
			FROM lives l
			WHERE v.live_id = l.id AND v.left_at IS NULL AND l.ended_at IS NOT NULL
		`)
	}
	return tag.RowsAffected(), nil
}

func isUniqueViolation(err error) bool {
	var pgErr interface{ SQLState() string }
	return errors.As(err, &pgErr) && pgErr.SQLState() == "23505"
}
