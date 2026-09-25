package channels

import (
	"context"
	"errors"
	"regexp"
	"strings"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
)

var (
	ErrNotFound          = errors.New("channel_not_found")
	ErrHandleTaken       = errors.New("handle_taken")
	ErrInvalidHandle     = errors.New("invalid_handle")
	ErrInvalidName       = errors.New("invalid_name")
	ErrInvalidVisibility = errors.New("invalid_visibility")
	ErrInvalidPostPolicy = errors.New("invalid_post_policy")
	ErrInvalidJoinMode   = errors.New("invalid_join_mode")
	ErrForbidden         = errors.New("forbidden")
	ErrJoinApproval      = errors.New("join_requires_approval")
	ErrInviteOnly        = errors.New("channel_invite_only")
	ErrCannotPost        = errors.New("cannot_post")
	ErrCommentsOff       = errors.New("comments_disabled")
	ErrReactionsOff      = errors.New("reactions_disabled")
)

var handleRe = regexp.MustCompile(`^[a-z0-9_]{2,24}$`)

type Service struct {
	repo *Repository
}

func NewService(repo *Repository) *Service { return &Service{repo: repo} }

func (s *Service) toChannel(c channelRow) Channel {
	avatar, cover := "", ""
	if c.AvatarURL != nil {
		avatar = *c.AvatarURL
	}
	if c.CoverURL != nil {
		cover = *c.CoverURL
	}
	role := MemberRole(c.Role)
	if role == "" {
		role = RoleNone
	}
	return Channel{
		ID:                c.ID,
		OwnerID:           c.OwnerID,
		Name:              c.Name,
		Handle:            c.Handle,
		Description:       c.Description,
		Category:          c.Category,
		AvatarURL:         avatar,
		CoverURL:          cover,
		Visibility:        Visibility(c.Visibility),
		WhoCanPost:        PostPermission(c.WhoCanPost),
		CommentsEnabled:   c.CommentsEnabled,
		AllowAnonComments: c.AllowAnonComments,
		ReactionsEnabled:  c.ReactionsEnabled,
		JoinMode:          JoinMode(c.JoinMode),
		Verified:          c.Verified,
		Members:           c.Members,
		Following:         c.Following,
		Role:              role,
		CreatedAt:         c.CreatedAt,
	}
}

func normalizeHandle(raw string) string {
	h := strings.ToLower(strings.TrimSpace(raw))
	h = strings.TrimPrefix(h, "@")
	h = strings.Map(func(r rune) rune {
		if (r >= 'a' && r <= 'z') || (r >= '0' && r <= '9') || r == '_' {
			return r
		}
		return -1
	}, h)
	if len(h) > 24 {
		h = h[:24]
	}
	return h
}

func (s *Service) Create(ctx context.Context, owner uuid.UUID, req CreateChannelRequest) (Channel, error) {
	name := strings.TrimSpace(req.Name)
	if len(name) < 2 || len(name) > 60 {
		return Channel{}, ErrInvalidName
	}
	handle := normalizeHandle(req.Handle)
	if !handleRe.MatchString(handle) {
		return Channel{}, ErrInvalidHandle
	}
	taken, err := s.repo.HandleTaken(ctx, handle, nil)
	if err != nil {
		return Channel{}, err
	}
	if taken {
		return Channel{}, ErrHandleTaken
	}
	vis := req.Visibility
	if vis == "" {
		vis = VisPublic
	}
	if vis != VisPublic && vis != VisPrivate {
		return Channel{}, ErrInvalidVisibility
	}
	who := req.WhoCanPost
	if who == "" {
		who = PostAdmins
	}
	if who != PostAdmins && who != PostPublishers && who != PostEveryone {
		return Channel{}, ErrInvalidPostPolicy
	}
	join := req.JoinMode
	if join == "" {
		join = JoinOpen
	}
	if join != JoinOpen && join != JoinRequest && join != JoinInvite {
		return Channel{}, ErrInvalidJoinMode
	}
	cat := req.Category
	if cat == "" {
		cat = "other"
	}
	comments, anon, reacts := true, true, true
	if req.CommentsEnabled != nil {
		comments = *req.CommentsEnabled
	}
	if req.AllowAnonComments != nil {
		anon = *req.AllowAnonComments
	}
	if req.ReactionsEnabled != nil {
		reacts = *req.ReactionsEnabled
	}
	id, err := s.repo.Create(ctx, owner, name, handle, strings.TrimSpace(req.Description), cat,
		req.AvatarURL, req.CoverURL, vis, who, join, comments, anon, reacts)
	if err != nil {
		return Channel{}, err
	}
	return s.Get(ctx, id, owner)
}

func (s *Service) List(ctx context.Context, viewer uuid.UUID, category string) ([]Channel, error) {
	rows, err := s.repo.List(ctx, viewer, category)
	if err != nil {
		return nil, err
	}
	out := make([]Channel, 0, len(rows))
	for _, r := range rows {
		out = append(out, s.toChannel(r))
	}
	return out, nil
}

func (s *Service) Get(ctx context.Context, id, viewer uuid.UUID) (Channel, error) {
	row, err := s.repo.Get(ctx, id, viewer)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return Channel{}, ErrNotFound
		}
		return Channel{}, err
	}
	ch := s.toChannel(row)
	if ch.Visibility == VisPrivate && !ch.Following && ch.OwnerID != viewer {
		return Channel{}, ErrNotFound
	}
	posts, err := s.repo.ListPosts(ctx, id, viewer, 30)
	if err != nil {
		return Channel{}, err
	}
	ch.Posts = posts
	return ch, nil
}

func (s *Service) canManage(ch Channel, user uuid.UUID) bool {
	return ch.OwnerID == user || ch.Role == RoleOwner || ch.Role == RoleAdmin
}

func (s *Service) canPost(ch Channel, user uuid.UUID) bool {
	if ch.OwnerID == user || ch.Role == RoleOwner || ch.Role == RoleAdmin {
		return true
	}
	switch ch.WhoCanPost {
	case PostEveryone:
		return ch.Following
	case PostPublishers:
		return ch.Role == RolePublisher
	default:
		return false
	}
}

func (s *Service) Patch(ctx context.Context, id, user uuid.UUID, req PatchChannelRequest) (Channel, error) {
	ch, err := s.Get(ctx, id, user)
	if err != nil {
		return Channel{}, err
	}
	if !s.canManage(ch, user) {
		return Channel{}, ErrForbidden
	}
	if req.Visibility != nil && *req.Visibility != VisPublic && *req.Visibility != VisPrivate {
		return Channel{}, ErrInvalidVisibility
	}
	if req.WhoCanPost != nil && *req.WhoCanPost != PostAdmins && *req.WhoCanPost != PostPublishers && *req.WhoCanPost != PostEveryone {
		return Channel{}, ErrInvalidPostPolicy
	}
	if req.JoinMode != nil && *req.JoinMode != JoinOpen && *req.JoinMode != JoinRequest && *req.JoinMode != JoinInvite {
		return Channel{}, ErrInvalidJoinMode
	}
	var handle *string
	if req.Handle != nil {
		h := normalizeHandle(*req.Handle)
		if !handleRe.MatchString(h) {
			return Channel{}, ErrInvalidHandle
		}
		taken, err := s.repo.HandleTaken(ctx, h, &id)
		if err != nil {
			return Channel{}, err
		}
		if taken {
			return Channel{}, ErrHandleTaken
		}
		handle = &h
	}
	var name *string
	if req.Name != nil {
		n := strings.TrimSpace(*req.Name)
		if len(n) < 2 {
			return Channel{}, ErrInvalidName
		}
		name = &n
	}
	if err := s.repo.Patch(ctx, id, name, handle, req.Description, req.Category,
		req.AvatarURL, req.CoverURL, req.Visibility, req.WhoCanPost, req.JoinMode,
		req.CommentsEnabled, req.AllowAnonComments, req.ReactionsEnabled); err != nil {
		return Channel{}, err
	}
	return s.Get(ctx, id, user)
}

func (s *Service) Follow(ctx context.Context, id, user uuid.UUID) (Channel, error) {
	ch, err := s.Get(ctx, id, user)
	if err != nil {
		return Channel{}, err
	}
	if ch.Following {
		return ch, nil
	}
	switch ch.JoinMode {
	case JoinRequest:
		// There is no persisted request workflow yet. Refusing here is safer
		// than silently turning an approval-only channel into an open one.
		return Channel{}, ErrJoinApproval
	case JoinInvite:
		return Channel{}, ErrInviteOnly
	case JoinOpen:
		// continue
	default:
		return Channel{}, ErrForbidden
	}
	if err := s.repo.Follow(ctx, id, user, RoleMember); err != nil {
		return Channel{}, err
	}
	return s.Get(ctx, id, user)
}

func (s *Service) Unfollow(ctx context.Context, id, user uuid.UUID) (Channel, error) {
	if err := s.repo.Unfollow(ctx, id, user); err != nil {
		return Channel{}, err
	}
	return s.Get(ctx, id, user)
}

func (s *Service) CreatePost(ctx context.Context, channelID, user uuid.UUID, req CreatePostRequest) (Post, error) {
	ch, err := s.Get(ctx, channelID, user)
	if err != nil {
		return Post{}, err
	}
	if !s.canPost(ch, user) {
		return Post{}, ErrCannotPost
	}
	ptype := req.PostType
	if ptype == "" {
		if req.MediaURL != "" {
			ptype = PostImage
		} else {
			ptype = PostText
		}
	}
	text := strings.TrimSpace(req.Text)
	id, err := s.repo.InsertPost(ctx, channelID, user, text, ptype, strings.TrimSpace(req.MediaURL))
	if err != nil {
		return Post{}, err
	}
	posts, err := s.repo.ListPosts(ctx, channelID, user, 1)
	if err != nil {
		return Post{}, err
	}
	for _, p := range posts {
		if p.ID == id {
			return p, nil
		}
	}
	return Post{ID: id, ChannelID: channelID, AuthorID: user, Text: text, PostType: ptype, MediaURL: req.MediaURL}, nil
}

func (s *Service) ListPosts(ctx context.Context, channelID, user uuid.UUID) ([]Post, error) {
	if _, err := s.Get(ctx, channelID, user); err != nil {
		return nil, err
	}
	return s.repo.ListPosts(ctx, channelID, user, 30)
}

func (s *Service) React(ctx context.Context, postID, user uuid.UUID, emoji string, clear bool) error {
	post, err := s.repo.GetPost(ctx, postID)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return ErrNotFound
		}
		return err
	}
	ch, err := s.Get(ctx, post.ChannelID, user)
	if err != nil {
		return err
	}
	if !ch.ReactionsEnabled {
		return ErrReactionsOff
	}
	if clear {
		return s.repo.ClearReaction(ctx, postID, user)
	}
	emoji = strings.TrimSpace(emoji)
	if emoji == "" {
		return ErrNotFound
	}
	return s.repo.SetReaction(ctx, postID, user, emoji)
}

func (s *Service) Comment(ctx context.Context, postID, user uuid.UUID, req CommentRequest) (Comment, error) {
	post, err := s.repo.GetPost(ctx, postID)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return Comment{}, ErrNotFound
		}
		return Comment{}, err
	}
	ch, err := s.Get(ctx, post.ChannelID, user)
	if err != nil {
		return Comment{}, err
	}
	if !ch.CommentsEnabled {
		return Comment{}, ErrCommentsOff
	}
	text := strings.TrimSpace(req.Text)
	if text == "" {
		return Comment{}, ErrInvalidName
	}
	var author *uuid.UUID
	if !req.Anonymous || !ch.AllowAnonComments {
		author = &user
		req.Anonymous = false
	}
	id, err := s.repo.AddComment(ctx, postID, author, text, req.Anonymous)
	if err != nil {
		return Comment{}, err
	}
	return Comment{ID: id, PostID: postID, AuthorID: author, Text: text, Anonymous: req.Anonymous}, nil
}

func (s *Service) ListComments(ctx context.Context, postID, user uuid.UUID) ([]Comment, error) {
	post, err := s.repo.GetPost(ctx, postID)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, ErrNotFound
		}
		return nil, err
	}
	if _, err := s.Get(ctx, post.ChannelID, user); err != nil {
		return nil, err
	}
	return s.repo.ListComments(ctx, postID)
}

func (s *Service) CheckHandle(ctx context.Context, handle string) (bool, error) {
	h := normalizeHandle(handle)
	if !handleRe.MatchString(h) {
		return false, nil
	}
	taken, err := s.repo.HandleTaken(ctx, h, nil)
	return !taken, err
}
