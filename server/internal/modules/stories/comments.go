package stories

import (
	"context"
	"errors"
	"fmt"
	"strings"
	"time"

	platformreactions "github.com/CreadorLanda/zwosocial/server/internal/platform/reactions"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
)

// Public comments on a story, with one level of replies.
//
// A comment can be posted anonymously when the story allows it. The author id
// is stored either way — deleting your own and moderating both need it — and
// is blanked in the query rather than by each caller, so the rule cannot be
// forgotten at one call site.

var (
	ErrCommentNotFound  = errors.New("comment_not_found")
	ErrCommentsDisabled = errors.New("comments_disabled")
	ErrAnonNotAllowed   = errors.New("anonymous_not_allowed")
)

const commentMaxLen = 500

// StoryComment is one comment as any viewer sees it.
type StoryComment struct {
	ID       int64  `json:"id"`
	StoryID  string `json:"story_id"`
	ParentID *int64 `json:"parent_id,omitempty"`
	Body     string `json:"body"`
	// Empty on anonymous comments. Not omitted-when-empty on purpose: a
	// missing field and an anonymous author should look the same to a client
	// that forgot to check IsAnonymous.
	AuthorID     string     `json:"author_id"`
	AuthorName   string     `json:"author_name"`
	AuthorUser   string     `json:"author_username"`
	AuthorAvatar string     `json:"author_avatar"`
	IsAnonymous  bool       `json:"is_anonymous"`
	IsMine       bool       `json:"is_mine"`
	CreatedAt    time.Time  `json:"created_at"`
	Reactions    []Reaction `json:"reactions"`
	MyReactions  []string   `json:"my_reactions"`
}

// ── repository ──────────────────────────────────────────────────────────────

// listComments returns a story's comments oldest-first, with the identity of
// anonymous authors stripped in SQL.
//
// `is_mine` is computed against the caller and stays true even for their own
// anonymous comments — you always know what you wrote, and it is what lets
// the delete affordance appear without telling anyone else who wrote it.
func (r *Repository) listComments(ctx context.Context, storyID, viewer uuid.UUID) ([]StoryComment, error) {
	rows, err := r.db.Query(ctx, `
		SELECT c.id, c.story_id, c.parent_id, c.body, c.is_anonymous, c.created_at,
		       CASE WHEN c.is_anonymous THEN '' ELSE c.author_id::text END,
		       CASE WHEN c.is_anonymous THEN '' ELSE COALESCE(u.display_name, '') END,
		       CASE WHEN c.is_anonymous THEN '' ELSE COALESCE(u.username, '') END,
		       CASE WHEN c.is_anonymous THEN '' ELSE COALESCE(u.avatar_uri, '') END,
		       c.author_id = $2
		FROM story_comments c
		JOIN users u ON u.id = c.author_id
		WHERE c.story_id = $1
		ORDER BY COALESCE(c.parent_id, c.id), c.id
	`, storyID, viewer)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	out := []StoryComment{}
	for rows.Next() {
		var c StoryComment
		if err := rows.Scan(&c.ID, &c.StoryID, &c.ParentID, &c.Body, &c.IsAnonymous,
			&c.CreatedAt, &c.AuthorID, &c.AuthorName, &c.AuthorUser, &c.AuthorAvatar,
			&c.IsMine); err != nil {
			return nil, err
		}
		out = append(out, c)
		c.Reactions, _ = r.commentReactions(ctx, c.ID)
		c.MyReactions, _ = r.myCommentReactions(ctx, c.ID, viewer)
		out[len(out)-1] = c
	}
	return out, rows.Err()
}

func (r *Repository) commentContext(ctx context.Context, id int64) (uuid.UUID, error) {
	var storyID uuid.UUID
	err := r.db.QueryRow(ctx, `SELECT story_id FROM story_comments WHERE id = $1`, id).Scan(&storyID)
	return storyID, err
}

func (r *Repository) setCommentReactions(ctx context.Context, id int64, user uuid.UUID, emojis []string) error {
	tx, err := r.db.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)
	if _, err := tx.Exec(ctx, `SELECT pg_advisory_xact_lock(hashtextextended($1, 0))`, fmt.Sprintf("story-comment-reaction:%d:%s", id, user)); err != nil {
		return err
	}
	if _, err := tx.Exec(ctx, `DELETE FROM story_comment_reactions WHERE comment_id = $1 AND user_id = $2`, id, user); err != nil {
		return err
	}
	for _, emoji := range emojis {
		if _, err := tx.Exec(ctx, `INSERT INTO story_comment_reactions (comment_id, user_id, emoji) VALUES ($1,$2,$3)`, id, user, emoji); err != nil {
			return err
		}
	}
	return tx.Commit(ctx)
}

func (r *Repository) clearCommentReactions(ctx context.Context, id int64, user uuid.UUID) error {
	_, err := r.db.Exec(ctx, `DELETE FROM story_comment_reactions WHERE comment_id = $1 AND user_id = $2`, id, user)
	return err
}

func (r *Repository) commentReactions(ctx context.Context, id int64) ([]Reaction, error) {
	rows, err := r.db.Query(ctx, `SELECT emoji, COUNT(*) FROM story_comment_reactions WHERE comment_id = $1 GROUP BY emoji ORDER BY COUNT(*) DESC`, id)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []Reaction
	for rows.Next() {
		var x Reaction
		if err := rows.Scan(&x.Emoji, &x.Count); err != nil {
			return nil, err
		}
		out = append(out, x)
	}
	return out, rows.Err()
}

func (r *Repository) myCommentReactions(ctx context.Context, id int64, user uuid.UUID) ([]string, error) {
	rows, err := r.db.Query(ctx, `SELECT emoji FROM story_comment_reactions WHERE comment_id = $1 AND user_id = $2 ORDER BY created_at ASC`, id, user)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []string
	for rows.Next() {
		var emoji string
		if err := rows.Scan(&emoji); err != nil {
			return nil, err
		}
		out = append(out, emoji)
	}
	return out, rows.Err()
}

func (r *Repository) insertComment(ctx context.Context, storyID, author uuid.UUID, parent *int64, body string, anon bool) (int64, error) {
	var id int64
	err := r.db.QueryRow(ctx, `
		INSERT INTO story_comments (story_id, author_id, parent_id, body, is_anonymous)
		VALUES ($1, $2, $3, $4, $5) RETURNING id
	`, storyID, author, parent, body, anon).Scan(&id)
	return id, err
}

// topLevelParent resolves a reply target to its top comment, so a reply to a
// reply lands beside its sibling instead of starting a third level.
func (r *Repository) topLevelParent(ctx context.Context, storyID uuid.UUID, id int64) (int64, error) {
	var resolved int64
	err := r.db.QueryRow(ctx, `
		SELECT COALESCE(parent_id, id) FROM story_comments
		WHERE id = $1 AND story_id = $2
	`, id, storyID).Scan(&resolved)
	return resolved, err
}

func (r *Repository) commentByID(ctx context.Context, id int64) (author, storyAuthor uuid.UUID, err error) {
	err = r.db.QueryRow(ctx, `
		SELECT c.author_id, s.author_id
		FROM story_comments c
		JOIN stories s ON s.id = c.story_id
		WHERE c.id = $1
	`, id).Scan(&author, &storyAuthor)
	return
}

func (r *Repository) deleteComment(ctx context.Context, id int64) error {
	_, err := r.db.Exec(ctx, `DELETE FROM story_comments WHERE id = $1`, id)
	return err
}

// ── service ─────────────────────────────────────────────────────────────────

// Comments lists a story's comments for anyone who may see the story.
func (s *Service) Comments(ctx context.Context, storyID, viewer uuid.UUID) ([]StoryComment, error) {
	if _, err := s.Get(ctx, storyID, viewer); err != nil {
		return nil, err
	}
	return s.repo.listComments(ctx, storyID, viewer)
}

// AddComment posts a comment or a reply.
func (s *Service) AddComment(ctx context.Context, storyID, author uuid.UUID, parent *int64, body string, anon bool) (StoryComment, error) {
	story, err := s.Get(ctx, storyID, author)
	if err != nil {
		return StoryComment{}, err
	}

	body = strings.TrimSpace(body)
	if body == "" {
		return StoryComment{}, ErrEmptyBody
	}
	if len(body) > commentMaxLen {
		body = body[:commentMaxLen]
	}

	if !story.AllowComments {
		return StoryComment{}, ErrCommentsDisabled
	}
	// Anonymity is the story author's call, not the commenter's. Offering it
	// where it was switched off would publish a name the commenter believed
	// was hidden.
	if anon && !story.AllowAnonymousReplies {
		return StoryComment{}, ErrAnonNotAllowed
	}

	if parent != nil {
		top, err := s.repo.topLevelParent(ctx, storyID, *parent)
		if err != nil {
			if errors.Is(err, pgx.ErrNoRows) {
				return StoryComment{}, ErrCommentNotFound
			}
			return StoryComment{}, err
		}
		parent = &top
	}

	id, err := s.repo.insertComment(ctx, storyID, author, parent, body, anon)
	if err != nil {
		return StoryComment{}, err
	}

	all, err := s.repo.listComments(ctx, storyID, author)
	if err != nil {
		return StoryComment{}, err
	}
	for _, c := range all {
		if c.ID == id {
			return c, nil
		}
	}
	return StoryComment{}, ErrCommentNotFound
}

// DeleteComment removes a comment. Its author may delete it, and so may the
// story's author — they are the one who has to live with what is under it.
func (s *Service) DeleteComment(ctx context.Context, commentID int64, user uuid.UUID) error {
	commentAuthor, storyAuthor, err := s.repo.commentByID(ctx, commentID)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return ErrCommentNotFound
		}
		return err
	}
	if user != commentAuthor && user != storyAuthor {
		// Reported as missing: "you may not delete this" would confirm both
		// that it exists and that it is not yours.
		return ErrCommentNotFound
	}
	return s.repo.deleteComment(ctx, commentID)
}

func (s *Service) ReactComment(ctx context.Context, commentID int64, user uuid.UUID, emojis []string, clear bool) error {
	storyID, err := s.repo.commentContext(ctx, commentID)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return ErrCommentNotFound
		}
		return err
	}
	if _, err := s.Get(ctx, storyID, user); err != nil {
		return err
	}
	if clear {
		return s.repo.clearCommentReactions(ctx, commentID, user)
	}
	normalized, err := platformreactions.NormalizeSet(emojis)
	if err != nil {
		return err
	}
	return s.repo.setCommentReactions(ctx, commentID, user, normalized)
}
