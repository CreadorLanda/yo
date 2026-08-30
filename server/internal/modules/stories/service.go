package stories

import (
	"context"
	"errors"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
)

var (
	ErrNotFound     = errors.New("story_not_found")
	ErrNotAuthor    = errors.New("not_story_author")
	ErrInvalidKind  = errors.New("invalid_kind")
	ErrInvalidVis   = errors.New("invalid_visibility")
	ErrNeedMedia    = errors.New("media_required")
	ErrEmptyCaption = errors.New("empty_caption")
	ErrInvalidEmoji = errors.New("invalid_emoji")
)

type Service struct {
	repo  *Repository
	chats DirectChatOpener
}

// DirectChatOpener finds or creates the one-to-one chat between two people.
//
// An interface rather than the messages service itself: modules here do not
// import each other, and this is the only thing stories needs from chats.
type DirectChatOpener interface {
	OpenDirectChat(ctx context.Context, a, b uuid.UUID) (uuid.UUID, error)
}

// NewService takes an optional chat opener. Nil means blind threads simply
// never graduate, which is the right degradation for a build that has not
// wired it: nothing breaks, the button just does not finish.
func NewService(repo *Repository, chats DirectChatOpener) *Service {
	return &Service{repo: repo, chats: chats}
}

func (s *Service) toStory(x row, me uuid.UUID) Story {
	media := ""
	if x.MediaURL != nil {
		media = *x.MediaURL
	}
	name, user, avatar := x.AuthorName, x.AuthorUser, x.AuthorAvatar
	if x.IsAnonymous && x.AuthorID != me {
		name, user, avatar = "Anonymous", "", ""
	}
	return Story{
		ID:                    x.ID,
		AuthorID:              x.AuthorID,
		AuthorName:            name,
		AuthorUser:            user,
		AuthorAvatar:          avatar,
		Kind:                  Kind(x.Kind),
		Caption:               x.Caption,
		MediaURL:              media,
		Accent:                x.Accent,
		Visibility:            Visibility(x.Visibility),
		IsAnonymous:           x.IsAnonymous,
		AllowComments:         x.AllowComments,
		AllowAnonymousReplies: x.AllowAnonymousReplies,
		DurationSec:           x.DurationSec,
		ExpiresAt:             x.ExpiresAt,
		CreatedAt:             x.CreatedAt,
		Viewers:               x.Viewers,
		IsViewed:              x.IsViewed,
		IsOwn:                 x.AuthorID == me,
	}
}

func (s *Service) Create(ctx context.Context, author uuid.UUID, req CreateRequest) (Story, error) {
	kind := req.Kind
	switch kind {
	case KindImage, KindVideo, KindText, KindAudio, KindPoll, KindQuestion:
	default:
		return Story{}, ErrInvalidKind
	}
	vis := req.Visibility
	if vis == "" {
		vis = VisContacts
	}
	switch vis {
	case VisPublic, VisContacts, VisClose:
	default:
		return Story{}, ErrInvalidVis
	}
	caption := strings.TrimSpace(req.Caption)
	// Text-like kinds need a caption (poll/question store options in caption).
	if (kind == KindText || kind == KindPoll || kind == KindQuestion) && caption == "" {
		return Story{}, ErrEmptyCaption
	}
	if (kind == KindImage || kind == KindVideo || kind == KindAudio) && strings.TrimSpace(req.MediaURL) == "" {
		return Story{}, ErrNeedMedia
	}
	accent := req.Accent
	if accent == "" {
		accent = "#2D5BFF"
	}
	dur := req.DurationSec
	if dur <= 0 {
		dur = 5
	}
	if dur > 30 {
		dur = 30
	}
	// 1h to 72h, defaulting to a day.
	//
	// Clamped rather than rejected: the bound is a product decision, not
	// something a caller can get wrong in a way worth failing a publish
	// over. A story the author waited to upload should not be lost to a
	// number being out of range.
	ttl := req.TTLHours
	if ttl <= 0 {
		ttl = StoryTTLDefaultHours
	}
	if ttl < StoryTTLMinHours {
		ttl = StoryTTLMinHours
	}
	if ttl > StoryTTLMaxHours {
		ttl = StoryTTLMaxHours
	}
	expires := time.Now().UTC().Add(time.Duration(ttl) * time.Hour)

	// Absent means "leave it on": a client that predates these fields must
	// not silently publish every story with comments disabled.
	allowComments := req.AllowComments == nil || *req.AllowComments
	allowAnon := req.AllowAnonymousReplies == nil || *req.AllowAnonymousReplies

	id, err := s.repo.Insert(ctx, author, kind, caption, strings.TrimSpace(req.MediaURL),
		accent, vis, req.IsAnonymous, dur, expires, allowComments, allowAnon)
	if err != nil {
		return Story{}, err
	}
	return s.Get(ctx, id, author)
}

func (s *Service) Get(ctx context.Context, id, viewer uuid.UUID) (Story, error) {
	x, err := s.repo.Get(ctx, id, viewer)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return Story{}, ErrNotFound
		}
		return Story{}, err
	}
	list := []Story{s.toStory(x, viewer)}
	if err := s.attachReactions(ctx, list, viewer); err != nil {
		return Story{}, err
	}
	return list[0], nil
}

// attachReactions fills in each story's reaction counts and the reader's own
// picks, in place.
//
// One pair of queries for the whole slice rather than a pair per story: the
// feed returns up to a hundred.
func (s *Service) attachReactions(ctx context.Context, list []Story, viewer uuid.UUID) error {
	if len(list) == 0 {
		return nil
	}
	ids := make([]uuid.UUID, 0, len(list))
	for _, st := range list {
		ids = append(ids, st.ID)
	}
	counts, err := s.repo.ReactionsFor(ctx, ids)
	if err != nil {
		return err
	}
	mine, err := s.repo.MyReactionsFor(ctx, ids, viewer)
	if err != nil {
		return err
	}
	for i := range list {
		// Empty rather than absent: a client reading `reactions.length`
		// should not have to check for null first.
		list[i].Reactions = []Reaction{}
		if got := counts[list[i].ID]; got != nil {
			list[i].Reactions = got
		}
		list[i].MyReactions = []string{}
		if got := mine[list[i].ID]; got != nil {
			list[i].MyReactions = got
		}
	}
	return nil
}

func (s *Service) Feed(ctx context.Context, viewer uuid.UUID) ([]Story, error) {
	rows, err := s.repo.Feed(ctx, viewer)
	if err != nil {
		return nil, err
	}
	out := make([]Story, 0, len(rows))
	for _, x := range rows {
		out = append(out, s.toStory(x, viewer))
	}
	if err := s.attachReactions(ctx, out, viewer); err != nil {
		return nil, err
	}
	return out, nil
}

func (s *Service) View(ctx context.Context, id, viewer uuid.UUID) (Story, error) {
	st, err := s.Get(ctx, id, viewer)
	if err != nil {
		return Story{}, err
	}
	if st.AuthorID != viewer {
		_ = s.repo.MarkViewed(ctx, id, viewer)
		st, _ = s.Get(ctx, id, viewer)
	}
	return st, nil
}

func (s *Service) Delete(ctx context.Context, id, author uuid.UUID) error {
	err := s.repo.Delete(ctx, id, author)
	if errors.Is(err, pgx.ErrNoRows) {
		return ErrNotFound
	}
	return err
}

// React replaces the caller's reactions on a story and returns the story as
// it now reads, counts included.
//
// Replacing rather than adding is what the client's reaction bar shows: the
// caller's own picks are filled in, so it already holds the whole set. An
// empty `reactions` array takes them all back.
//
// Returning the story saves the client a second call for the new counts, and
// keeps the numbers it draws the server's numbers rather than its own guess
// at what its tap did.
func (s *Service) React(ctx context.Context, id, user uuid.UUID, req ReactRequest) (Story, error) {
	if _, err := s.Get(ctx, id, user); err != nil {
		return Story{}, err
	}
	emojis, err := requestedReactions(req)
	if err != nil {
		return Story{}, err
	}
	if err := s.repo.SetReactions(ctx, id, user, emojis); err != nil {
		return Story{}, err
	}
	return s.Get(ctx, id, user)
}

// ReactionCatalogue is the emoji this server accepts as reactions.
//
// Served so the set has one definition. A client carrying its own copy drifts
// from it, and the drift shows up as a reaction the app offers and the server
// then refuses.
func (s *Service) ReactionCatalogue() ReactionCatalogue {
	return ReactionCatalogue{
		Standard: append([]string(nil), StandardReactions...),
		Extended: append([]string(nil), ExtendedReactions...),
	}
}

// Viewers returns who has seen a story. Author only.
//
// Anyone else asking would learn the audience of a story they merely
// received, which is a different thing from being allowed to watch it.
func (s *Service) Viewers(ctx context.Context, id, user uuid.UUID) ([]Viewer, error) {
	story, err := s.Get(ctx, id, user)
	if err != nil {
		return nil, err
	}
	if story.AuthorID != user {
		return nil, ErrNotAuthor
	}
	return s.repo.Viewers(ctx, id)
}
