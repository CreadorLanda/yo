package stories

import (
	"context"
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
)

// Blind channel: private replies to a story that never name either party.
//
// The identities exist in the database — delivery and moderation both need
// them — and are never put in a response. That is the whole guarantee, so it
// is enforced here rather than left to each caller: nothing in this file
// returns a user id, a username or an avatar.

var (
	ErrThreadNotFound = errors.New("thread_not_found")
	ErrEmptyBody      = errors.New("empty_body")
	ErrRateLimited    = errors.New("rate_limited")
	ErrOwnStory       = errors.New("cannot_write_to_own_story")
)

const (
	// A sender may write this many messages to one story within the window.
	// An anonymous inbox is a known harassment vector; the cap is the cheapest
	// part of not building one.
	anonMaxPerWindow = 5
	anonWindow       = time.Hour
	anonMaxBodyLen   = 1000
)

// AnonThread is one conversation as either side sees it. Deliberately has no
// field that could identify the other party.
type AnonThread struct {
	ID            uuid.UUID `json:"id"`
	StoryID       uuid.UUID `json:"story_id"`
	LastMessageAt time.Time `json:"last_message_at"`
	CreatedAt     time.Time `json:"created_at"`
	// Whether each side has chosen to be known. Both true means the thread
	// can graduate to a normal chat.
	AuthorRevealed bool `json:"author_revealed"`
	SenderRevealed bool `json:"sender_revealed"`
	// Which side the caller is on. Says nothing about the other party — it
	// is a fact about the reader, not a disclosure about anyone else.
	Role string `json:"role"`
	// First line, so threads can be told apart without a name.
	Preview string `json:"preview,omitempty"`
	Unread  int    `json:"unread,omitempty"`

	// Which story this is about. Safe for both sides: the author is looking
	// at their own, and the sender already saw it. The story's *author* is
	// still never included — an anonymous story stays anonymous.
	StoryKind    string `json:"story_kind,omitempty"`
	StoryCaption string `json:"story_caption,omitempty"`
	StoryMedia   string `json:"story_media_url,omitempty"`
	// True once the story is past its expiry: the thread outlives what it
	// was about, and a caption with no way to open it should say so.
	StoryExpired bool `json:"story_expired"`
}

// Roles a caller can hold in a blind thread.
const (
	AnonRoleAuthor = "author"
	AnonRoleSender = "sender"
)

// AnonMessage carries only which side wrote it.
type AnonMessage struct {
	ID         int64     `json:"id"`
	FromAuthor bool      `json:"from_author"`
	Body       string    `json:"body"`
	CreatedAt  time.Time `json:"created_at"`
}

// ── repository ──────────────────────────────────────────────────────────────

// upsertThread finds or opens the one thread this sender has on this story.
// Returns the thread id and whether the author has blocked them.
func (r *Repository) upsertThread(ctx context.Context, storyID, authorID, senderID uuid.UUID) (uuid.UUID, bool, error) {
	var id uuid.UUID
	var blocked bool
	err := r.db.QueryRow(ctx, `
		INSERT INTO story_anon_threads (story_id, author_id, sender_id)
		VALUES ($1, $2, $3)
		ON CONFLICT (story_id, sender_id) DO UPDATE
		   SET last_message_at = NOW()
		RETURNING id, blocked
	`, storyID, authorID, senderID).Scan(&id, &blocked)
	return id, blocked, err
}

// countRecent is the rate limit input: how many messages this sender has put
// into this story's channel inside the window.
func (r *Repository) countRecent(ctx context.Context, storyID, senderID uuid.UUID, since time.Time) (int, error) {
	var n int
	err := r.db.QueryRow(ctx, `
		SELECT count(*)
		FROM story_anon_messages m
		JOIN story_anon_threads t ON t.id = m.thread_id
		WHERE t.story_id = $1 AND t.sender_id = $2
		  AND m.from_author = FALSE AND m.created_at > $3
	`, storyID, senderID, since).Scan(&n)
	return n, err
}

func (r *Repository) insertAnonMessage(ctx context.Context, threadID uuid.UUID, fromAuthor bool, body string) (AnonMessage, error) {
	var m AnonMessage
	err := r.db.QueryRow(ctx, `
		INSERT INTO story_anon_messages (thread_id, from_author, body)
		VALUES ($1, $2, $3)
		RETURNING id, from_author, body, created_at
	`, threadID, fromAuthor, body).Scan(&m.ID, &m.FromAuthor, &m.Body, &m.CreatedAt)
	if err != nil {
		return AnonMessage{}, err
	}
	_, err = r.db.Exec(ctx,
		`UPDATE story_anon_threads SET last_message_at = NOW() WHERE id = $1`, threadID)
	return m, err
}

// threadParties returns who the two sides are. Used for authorisation only —
// callers must not put these in a response.
func (r *Repository) threadParties(ctx context.Context, threadID uuid.UUID) (author, sender uuid.UUID, blocked bool, err error) {
	err = r.db.QueryRow(ctx, `
		SELECT author_id, sender_id, blocked FROM story_anon_threads WHERE id = $1
	`, threadID).Scan(&author, &sender, &blocked)
	return
}

// threadsFor lists every blind thread the user is part of, on either side.
//
// A blocked thread disappears from the author's list but stays in the
// sender's: removing it there would tell them they were blocked, which is
// the one thing the block is designed not to say.
func (r *Repository) threadsFor(ctx context.Context, userID uuid.UUID) ([]AnonThread, error) {
	rows, err := r.db.Query(ctx, `
		SELECT t.id, t.story_id, t.created_at, t.last_message_at,
		       t.author_revealed, t.sender_revealed,
		       CASE WHEN t.author_id = $1 THEN 'author' ELSE 'sender' END,
		       COALESCE(last.body, ''),
		       (SELECT count(*) FROM story_anon_messages m
		         WHERE m.thread_id = t.id
		           AND m.from_author = (t.author_id <> $1)),
		       -- Story context. Deliberately no author column here: the
		       -- whole point is that the story's author stays unnamed.
		       COALESCE(s.kind, ''), COALESCE(s.caption, ''),
		       COALESCE(s.media_url, ''),
		       COALESCE(s.expires_at <= NOW(), TRUE)
		FROM story_anon_threads t
		LEFT JOIN stories s ON s.id = t.story_id
		LEFT JOIN LATERAL (
		    SELECT body FROM story_anon_messages m
		    WHERE m.thread_id = t.id ORDER BY m.id DESC LIMIT 1
		) last ON TRUE
		WHERE (t.author_id = $1 AND t.blocked = FALSE)
		   OR t.sender_id = $1
		ORDER BY t.last_message_at DESC
	`, userID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	out := []AnonThread{}
	for rows.Next() {
		var t AnonThread
		if err := rows.Scan(&t.ID, &t.StoryID, &t.CreatedAt, &t.LastMessageAt,
			&t.AuthorRevealed, &t.SenderRevealed, &t.Role, &t.Preview, &t.Unread,
			&t.StoryKind, &t.StoryCaption, &t.StoryMedia, &t.StoryExpired); err != nil {
			return nil, err
		}
		out = append(out, t)
	}
	return out, rows.Err()
}

func (r *Repository) anonMessages(ctx context.Context, threadID uuid.UUID) ([]AnonMessage, error) {
	rows, err := r.db.Query(ctx, `
		SELECT id, from_author, body, created_at
		FROM story_anon_messages WHERE thread_id = $1 ORDER BY id ASC
	`, threadID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	out := []AnonMessage{}
	for rows.Next() {
		var m AnonMessage
		if err := rows.Scan(&m.ID, &m.FromAuthor, &m.Body, &m.CreatedAt); err != nil {
			return nil, err
		}
		out = append(out, m)
	}
	return out, rows.Err()
}

func (r *Repository) blockThread(ctx context.Context, threadID, authorID uuid.UUID) error {
	tag, err := r.db.Exec(ctx,
		`UPDATE story_anon_threads SET blocked = TRUE WHERE id = $1 AND author_id = $2`,
		threadID, authorID)
	if err != nil {
		return err
	}
	if tag.RowsAffected() == 0 {
		return pgx.ErrNoRows
	}
	return nil
}

func (r *Repository) revealSide(ctx context.Context, threadID, userID uuid.UUID) error {
	// Whichever side the caller is, set only their own flag.
	tag, err := r.db.Exec(ctx, `
		UPDATE story_anon_threads
		   SET author_revealed = CASE WHEN author_id = $2 THEN TRUE ELSE author_revealed END,
		       sender_revealed = CASE WHEN sender_id = $2 THEN TRUE ELSE sender_revealed END
		 WHERE id = $1 AND (author_id = $2 OR sender_id = $2)
	`, threadID, userID)
	if err != nil {
		return err
	}
	if tag.RowsAffected() == 0 {
		return pgx.ErrNoRows
	}
	return nil
}

// ── service ─────────────────────────────────────────────────────────────────

// WriteAnon delivers a private message to a story's author without naming
// the sender.
//
// A blocked sender gets the same success they would otherwise: telling them
// they were blocked hands back the feedback that makes evading it a game.
func (s *Service) WriteAnon(ctx context.Context, storyID, senderID uuid.UUID, body string) error {
	x, err := s.repo.Get(ctx, storyID, senderID)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return ErrNotFound
		}
		return err
	}
	if x.AuthorID == senderID {
		return ErrOwnStory
	}

	body = strings.TrimSpace(body)
	if body == "" {
		return ErrEmptyBody
	}
	if len(body) > anonMaxBodyLen {
		body = body[:anonMaxBodyLen]
	}

	n, err := s.repo.countRecent(ctx, storyID, senderID, time.Now().Add(-anonWindow))
	if err != nil {
		return fmt.Errorf("count recent: %w", err)
	}
	if n >= anonMaxPerWindow {
		return ErrRateLimited
	}

	threadID, blocked, err := s.repo.upsertThread(ctx, storyID, x.AuthorID, senderID)
	if err != nil {
		return fmt.Errorf("open thread: %w", err)
	}
	if blocked {
		return nil
	}
	_, err = s.repo.insertAnonMessage(ctx, threadID, false, body)
	return err
}

// AnonInbox lists every blind thread the caller is part of, on either side.
//
// Both directions in one list: someone who wrote to an anonymous story has
// nowhere else to read the reply, and a channel you can only send into is
// not a channel.
func (s *Service) AnonInbox(ctx context.Context, userID uuid.UUID) ([]AnonThread, error) {
	return s.repo.threadsFor(ctx, userID)
}

// AnonMessages returns a thread's messages to either participant.
func (s *Service) AnonMessages(ctx context.Context, threadID, userID uuid.UUID) ([]AnonMessage, error) {
	author, sender, _, err := s.repo.threadParties(ctx, threadID)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, ErrThreadNotFound
		}
		return nil, err
	}
	if userID != author && userID != sender {
		// Not "forbidden": a stranger should not learn the thread exists.
		return nil, ErrThreadNotFound
	}
	return s.repo.anonMessages(ctx, threadID)
}

// ReplyAnon posts into an existing thread from either side.
func (s *Service) ReplyAnon(ctx context.Context, threadID, userID uuid.UUID, body string) (AnonMessage, error) {
	author, sender, blocked, err := s.repo.threadParties(ctx, threadID)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return AnonMessage{}, ErrThreadNotFound
		}
		return AnonMessage{}, err
	}
	if userID != author && userID != sender {
		return AnonMessage{}, ErrThreadNotFound
	}

	body = strings.TrimSpace(body)
	if body == "" {
		return AnonMessage{}, ErrEmptyBody
	}
	if len(body) > anonMaxBodyLen {
		body = body[:anonMaxBodyLen]
	}

	fromAuthor := userID == author
	if blocked && !fromAuthor {
		// Same silent drop as WriteAnon, and it must return a plausible
		// message or the client would show a failure the sender can read as
		// a signal.
		return AnonMessage{FromAuthor: false, Body: body, CreatedAt: time.Now().UTC()}, nil
	}
	return s.repo.insertAnonMessage(ctx, threadID, fromAuthor, body)
}

// BlockAnon stops a sender reaching the author again. Author only.
func (s *Service) BlockAnon(ctx context.Context, threadID, authorID uuid.UUID) error {
	err := s.repo.blockThread(ctx, threadID, authorID)
	if errors.Is(err, pgx.ErrNoRows) {
		return ErrThreadNotFound
	}
	return err
}

// RevealAnon marks the caller willing to be known.
//
// When both sides have agreed the thread graduates: a direct chat is opened
// between them — the existing one if they already had it — and the blind
// thread is destroyed, messages included.
//
// The messages are not carried across. They were written under anonymity,
// and moving them into a named conversation would retroactively attribute
// every one of them to a person who did not write them under their name.
// Agreeing to be known going forward is not agreeing to be identified
// backwards.
//
// Returns the chat id once that happens, and uuid.Nil while it has not.
func (s *Service) RevealAnon(ctx context.Context, threadID, userID uuid.UUID) (uuid.UUID, error) {
	if err := s.repo.revealSide(ctx, threadID, userID); err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return uuid.Nil, ErrThreadNotFound
		}
		return uuid.Nil, err
	}

	author, sender, bothRevealed, err := s.repo.threadReveal(ctx, threadID)
	if err != nil {
		return uuid.Nil, err
	}
	if !bothRevealed || s.chats == nil {
		return uuid.Nil, nil
	}

	chatID, err := s.chats.OpenDirectChat(ctx, author, sender)
	if err != nil {
		// Leave the thread alone: losing the conversation because the chat
		// could not be opened would strand both people with nothing.
		return uuid.Nil, err
	}
	if err := s.repo.deleteThread(ctx, threadID); err != nil {
		return chatID, err
	}
	return chatID, nil
}

// threadReveal reports the two parties and whether both have agreed.
func (r *Repository) threadReveal(ctx context.Context, threadID uuid.UUID) (author, sender uuid.UUID, both bool, err error) {
	err = r.db.QueryRow(ctx, `
		SELECT author_id, sender_id, (author_revealed AND sender_revealed)
		FROM story_anon_threads WHERE id = $1
	`, threadID).Scan(&author, &sender, &both)
	return
}

// deleteThread removes the thread and, by cascade, every message in it.
func (r *Repository) deleteThread(ctx context.Context, threadID uuid.UUID) error {
	_, err := r.db.Exec(ctx, `DELETE FROM story_anon_threads WHERE id = $1`, threadID)
	return err
}
