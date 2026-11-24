package posts

import (
	"context"
	"errors"
	"strings"
	"unicode/utf8"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
)

var (
	ErrNotFound        = errors.New("post_not_found")
	ErrInvalidKind     = errors.New("invalid_kind")
	ErrInvalidVis      = errors.New("invalid_visibility")
	ErrNeedMedia       = errors.New("media_required")
	ErrTooManyMedia    = errors.New("too_many_media")
	ErrDuplicateMedia  = errors.New("duplicate_media")
	ErrMediaNotOwned   = errors.New("media_not_owned")
	ErrUnsupportedType = errors.New("unsupported_media_type")
	ErrReelNeedsVideo  = errors.New("reel_needs_one_video")
	ErrCaptionTooLong  = errors.New("caption_too_long")
)

// store is what the service needs from the database. An interface so the
// publishing rules can be tested without one.
type store interface {
	OwnedMedia(ctx context.Context, owner uuid.UUID, ids []uuid.UUID) (map[uuid.UUID]string, error)
	Insert(ctx context.Context, author uuid.UUID, kind Kind, caption string, vis Visibility, mediaIDs []uuid.UUID) (uuid.UUID, error)
	Get(ctx context.Context, id, viewer uuid.UUID) (row, error)
	ListByAuthor(ctx context.Context, viewer uuid.UUID, q ListQuery) ([]row, error)
	MediaFor(ctx context.Context, postIDs []uuid.UUID) (map[uuid.UUID][]Media, error)
	Delete(ctx context.Context, id, author uuid.UUID) error
}

type Service struct {
	repo store
}

func NewService(repo *Repository) *Service {
	return &Service{repo: repo}
}

func (s *Service) Create(ctx context.Context, author uuid.UUID, req CreateRequest) (Post, error) {
	switch req.Kind {
	case KindPost, KindReel:
	default:
		return Post{}, ErrInvalidKind
	}
	vis := req.Visibility
	if vis == "" {
		vis = VisContacts
	}
	switch vis {
	case VisPublic, VisContacts:
	default:
		return Post{}, ErrInvalidVis
	}
	caption := strings.TrimSpace(req.Caption)
	// Rejected rather than cut: a caption silently losing its end is worse
	// than being told it is too long, and the client shows the limit.
	if utf8.RuneCountInString(caption) > MaxCaptionRunes {
		return Post{}, ErrCaptionTooLong
	}

	ids := req.MediaIDs
	if len(ids) == 0 {
		return Post{}, ErrNeedMedia
	}
	if len(ids) > MaxMedia {
		return Post{}, ErrTooManyMedia
	}
	if req.Kind == KindReel && len(ids) != 1 {
		return Post{}, ErrReelNeedsVideo
	}
	seen := make(map[uuid.UUID]struct{}, len(ids))
	for _, id := range ids {
		if _, dup := seen[id]; dup {
			return Post{}, ErrDuplicateMedia
		}
		seen[id] = struct{}{}
	}

	// Ownership is read from the database, never taken from the request:
	// publishing someone else's media id would hand its bytes to this
	// author's whole audience.
	owned, err := s.repo.OwnedMedia(ctx, author, ids)
	if err != nil {
		return Post{}, err
	}
	for _, id := range ids {
		kind, ok := owned[id]
		if !ok {
			return Post{}, ErrMediaNotOwned
		}
		switch {
		case req.Kind == KindReel && kind != "video":
			return Post{}, ErrReelNeedsVideo
		case kind != "image" && kind != "video":
			return Post{}, ErrUnsupportedType
		}
	}

	id, err := s.repo.Insert(ctx, author, req.Kind, caption, vis, ids)
	if err != nil {
		return Post{}, err
	}
	return s.Get(ctx, id, author)
}

func (s *Service) Get(ctx context.Context, id, viewer uuid.UUID) (Post, error) {
	x, err := s.repo.Get(ctx, id, viewer)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return Post{}, ErrNotFound
		}
		return Post{}, err
	}
	list, err := s.withMedia(ctx, []row{x}, viewer)
	if err != nil {
		return Post{}, err
	}
	return list[0], nil
}

// ListByAuthor is one page of a profile grid. Posts the viewer may not see
// are simply absent, so a stranger and a contact get different lengths and
// neither learns what the other has.
func (s *Service) ListByAuthor(ctx context.Context, viewer uuid.UUID, q ListQuery) ([]Post, error) {
	switch q.Kind {
	case "", KindPost, KindReel:
	default:
		return nil, ErrInvalidKind
	}
	if q.Limit <= 0 {
		q.Limit = DefaultPageSize
	}
	if q.Limit > MaxPageSize {
		q.Limit = MaxPageSize
	}
	rows, err := s.repo.ListByAuthor(ctx, viewer, q)
	if err != nil {
		return nil, err
	}
	return s.withMedia(ctx, rows, viewer)
}

func (s *Service) Delete(ctx context.Context, id, author uuid.UUID) error {
	err := s.repo.Delete(ctx, id, author)
	if errors.Is(err, pgx.ErrNoRows) {
		// Someone else's post reads as missing, not forbidden: "you may not
		// delete this" confirms it exists.
		return ErrNotFound
	}
	return err
}

func (s *Service) withMedia(ctx context.Context, rows []row, viewer uuid.UUID) ([]Post, error) {
	ids := make([]uuid.UUID, 0, len(rows))
	for _, x := range rows {
		ids = append(ids, x.ID)
	}
	media, err := s.repo.MediaFor(ctx, ids)
	if err != nil {
		return nil, err
	}
	out := make([]Post, 0, len(rows))
	for _, x := range rows {
		slides := media[x.ID]
		if slides == nil {
			// Empty rather than absent: a client reading `media.length`
			// should not have to check for null first.
			slides = []Media{}
		}
		out = append(out, Post{
			ID:           x.ID,
			AuthorID:     x.AuthorID,
			AuthorName:   x.AuthorName,
			AuthorUser:   x.AuthorUser,
			AuthorAvatar: x.AuthorAvatar,
			Kind:         Kind(x.Kind),
			Caption:      x.Caption,
			Visibility:   Visibility(x.Visibility),
			Media:        slides,
			IsOwn:        x.AuthorID == viewer,
			CreatedAt:    x.CreatedAt,
		})
	}
	return out, nil
}
