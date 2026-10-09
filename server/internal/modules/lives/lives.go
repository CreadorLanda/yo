// Package lives runs broadcasts: one person publishing to an audience that
// cannot publish back.
//
// Not part of the calls module, because the permission question is a different
// one. A call asks "are you in this chat", and everyone who is gets the same
// rights. A broadcast asks two questions — "may you start one here" and "may
// you watch this" — and answers them differently for a public channel, a
// private channel, and a group chat.
//
// What the SFU enforces is the part that matters: a viewer's token carries
// CanPublish=false, so an audience member cannot appear in the broadcast by
// patching the app. The rule lives in the token, not in the client.
package lives

import (
	"context"
	"errors"
	"net/http"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"

	"github.com/CreadorLanda/zwosocial/server/internal/middleware"
	"github.com/CreadorLanda/zwosocial/server/internal/platform/livekit"
)

var (
	// ErrDisabled means no SFU is configured.
	ErrDisabled = errors.New("lives_disabled")
	// ErrNotAllowed covers both "you may not broadcast here" and "you may not
	// watch this", reported as not-found so neither confirms what exists.
	ErrNotAllowed = errors.New("not_allowed")
	// ErrNoLive means there is nothing to watch.
	ErrNoLive = errors.New("no_live")
	// ErrAlreadyLive means this channel or chat is already broadcasting.
	// Reported rather than joined: two people going live in one place is two
	// broadcasts, and silently making the second person a co-host is not what
	// either of them pressed.
	ErrAlreadyLive = errors.New("already_live")
)

// Audience is what this module asks of the rest of the app.
//
// Narrow interfaces rather than imports: modules here do not reach into each
// other's storage, and both questions are already answered elsewhere.
type Audience interface {
	// CanBroadcastToChannel — may this user start a live on this channel.
	// The same permission as posting to it: a live is a post that happens now.
	CanBroadcastToChannel(ctx context.Context, channelID, userID uuid.UUID) (bool, error)
	// CanWatchChannel — may this user watch a channel's live. A public channel
	// admits anyone; a private one admits its members.
	CanWatchChannel(ctx context.Context, channelID, userID uuid.UUID) (bool, error)
	// InChat — membership of a group, which is both permissions at once: if you
	// are in the group you may go live in it and you may watch.
	InChat(ctx context.Context, chatID, userID uuid.UUID) (bool, error)
	// ChatMembers is who to tell when a broadcast starts.
	ChatMembers(ctx context.Context, chatID uuid.UUID) ([]uuid.UUID, error)
	// ChannelFollowers, likewise.
	ChannelFollowers(ctx context.Context, channelID uuid.UUID) ([]uuid.UUID, error)
}

// Identity resolves the name shown to the audience.
type Identity interface {
	DisplayName(ctx context.Context, userID uuid.UUID) (string, error)
}

// Announcer tells people a broadcast started, ended, or changed size.
type Announcer interface {
	Started(ctx context.Context, users []uuid.UUID, live Live)
	Ended(ctx context.Context, users []uuid.UUID, liveID uuid.UUID)
	// Viewers is the count changing. Sent to the people in the room rather than
	// the whole audience: it fires on every join and leave, and only someone
	// watching has anywhere to put it.
	Viewers(ctx context.Context, users []uuid.UUID, liveID uuid.UUID, n int)
}

type Service struct {
	signer   *livekit.Signer
	repo     *Repo
	audience Audience
	users    Identity
	announce Announcer
}

func NewService(signer *livekit.Signer, repo *Repo, audience Audience, users Identity, announce Announcer) *Service {
	return &Service{signer: signer, repo: repo, audience: audience, users: users, announce: announce}
}

// Grant is what the client needs to join a broadcast.
type Grant struct {
	Live Live   `json:"live"`
	URL  string `json:"url"`
	// Room is the live's id. Named after the broadcast, not its home, so
	// ending one and starting another is a different room rather than the same
	// room with new people in it.
	Room     string `json:"room"`
	Token    string `json:"token"`
	Identity string `json:"identity"`
	// Host says which side of the glass this token puts you on. The SFU
	// enforces it; this is so the client knows which screen to draw.
	Host bool `json:"host"`
}

// Start begins a broadcast.
func (s *Service) Start(ctx context.Context, in StartInput, host uuid.UUID) (Grant, error) {
	if !s.signer.Enabled() {
		return Grant{}, ErrDisabled
	}
	if err := s.mayBroadcast(ctx, in, host); err != nil {
		return Grant{}, err
	}

	live, err := s.repo.Start(ctx, in, host)
	if err != nil {
		return Grant{}, err
	}

	name, _ := s.users.DisplayName(ctx, host)
	if name == "" {
		name = "…"
	}
	token, _, err := s.signer.Sign(host.String(), name, live.ID.String(), livekit.Broadcaster)
	if err != nil {
		return Grant{}, err
	}
	live.HostName = name

	if s.announce != nil {
		if who, err := s.audienceOf(ctx, live); err == nil {
			s.announce.Started(ctx, without(who, host), live)
		}
	}

	return Grant{
		Live: live, URL: s.signer.URL(), Room: live.ID.String(),
		Token: token, Identity: host.String(), Host: true,
	}, nil
}

// Join puts someone in the audience.
//
// The host joining their own broadcast — after a crash, or from a second
// device — gets the broadcaster's token back rather than a viewer's, or they
// would return to their own live unable to speak.
func (s *Service) Join(ctx context.Context, liveID, userID uuid.UUID) (Grant, error) {
	if !s.signer.Enabled() {
		return Grant{}, ErrDisabled
	}
	live, err := s.repo.Get(ctx, liveID)
	if err != nil {
		return Grant{}, ErrNoLive
	}
	if live.EndedAt != nil {
		return Grant{}, ErrNoLive
	}
	if ok, err := s.mayWatch(ctx, live, userID); err != nil || !ok {
		return Grant{}, ErrNotAllowed
	}

	host := live.HostID == userID
	role := livekit.Viewer
	if host {
		role = livekit.Broadcaster
	}

	name, _ := s.users.DisplayName(ctx, userID)
	if name == "" {
		name = "…"
	}
	token, _, err := s.signer.Sign(userID.String(), name, live.ID.String(), role)
	if err != nil {
		return Grant{}, err
	}

	// The host is not a viewer. Counting them would put "1 watching" on an
	// empty broadcast, which is the number they are watching most closely.
	if !host {
		n, err := s.repo.Watch(ctx, live.ID, userID)
		if err == nil {
			live.Viewers = n
			s.announceViewers(ctx, live, n)
		}
	} else {
		live.Viewers, _ = s.repo.ViewerCount(ctx, live.ID)
	}

	return Grant{
		Live: live, URL: s.signer.URL(), Room: live.ID.String(),
		Token: token, Identity: userID.String(), Host: host,
	}, nil
}

// Leave takes someone out of the audience.
func (s *Service) Leave(ctx context.Context, liveID, userID uuid.UUID) error {
	live, err := s.repo.Get(ctx, liveID)
	if err != nil {
		return nil // nothing to leave, and saying so helps nobody
	}
	n, err := s.repo.Unwatch(ctx, liveID, userID)
	if err != nil {
		return err
	}
	live.Viewers = n
	s.announceViewers(ctx, live, n)
	return nil
}

// End stops a broadcast. Only the host may.
func (s *Service) End(ctx context.Context, liveID, userID uuid.UUID) error {
	live, err := s.repo.Get(ctx, liveID)
	if err != nil {
		return ErrNoLive
	}
	if live.HostID != userID {
		return ErrNotAllowed
	}
	if err := s.repo.End(ctx, liveID); err != nil {
		return err
	}
	if s.announce != nil {
		// Everyone who was watching, plus everyone who was told it started —
		// both have something on screen that is now false.
		if who, err := s.audienceOf(ctx, live); err == nil {
			s.announce.Ended(ctx, without(who, userID), liveID)
		}
	}
	return nil
}

// Running lists what this user can watch right now.
func (s *Service) Running(ctx context.Context, userID uuid.UUID) ([]Live, error) {
	return s.repo.RunningFor(ctx, userID)
}

func (s *Service) mayBroadcast(ctx context.Context, in StartInput, host uuid.UUID) error {
	switch {
	case in.ChannelID != nil:
		ok, err := s.audience.CanBroadcastToChannel(ctx, *in.ChannelID, host)
		if err != nil || !ok {
			return ErrNotAllowed
		}
	case in.ChatID != nil:
		ok, err := s.audience.InChat(ctx, *in.ChatID, host)
		if err != nil || !ok {
			return ErrNotAllowed
		}
	default:
		return ErrNotAllowed
	}
	return nil
}

func (s *Service) mayWatch(ctx context.Context, live Live, userID uuid.UUID) (bool, error) {
	if live.ChannelID != nil {
		return s.audience.CanWatchChannel(ctx, *live.ChannelID, userID)
	}
	if live.ChatID != nil {
		return s.audience.InChat(ctx, *live.ChatID, userID)
	}
	return false, nil
}

func (s *Service) audienceOf(ctx context.Context, live Live) ([]uuid.UUID, error) {
	if live.ChannelID != nil {
		return s.audience.ChannelFollowers(ctx, *live.ChannelID)
	}
	if live.ChatID != nil {
		return s.audience.ChatMembers(ctx, *live.ChatID)
	}
	return nil, nil
}

// announceViewers tells the room its own size — the people watching and the
// host, not the whole audience. A follower who never opened it has nowhere to
// put the number.
func (s *Service) announceViewers(ctx context.Context, live Live, n int) {
	if s.announce == nil {
		return
	}
	watching, err := s.repo.Watching(ctx, live.ID)
	if err != nil {
		return
	}
	s.announce.Viewers(ctx, append(watching, live.HostID), live.ID, n)
}

func without(ids []uuid.UUID, skip uuid.UUID) []uuid.UUID {
	out := make([]uuid.UUID, 0, len(ids))
	for _, id := range ids {
		if id != skip {
			out = append(out, id)
		}
	}
	return out
}

// ── controller ──────────────────────────────────────────────────────────────

type Controller struct{ svc *Service }

func NewController(svc *Service) *Controller { return &Controller{svc: svc} }

type startRequest struct {
	ChannelID *uuid.UUID `json:"channel_id"`
	ChatID    *uuid.UUID `json:"chat_id"`
	Title     string     `json:"title"`
}

// PostStart — POST /lives
func (c *Controller) PostStart(ctx *gin.Context) {
	var req startRequest
	if err := ctx.ShouldBindJSON(&req); err != nil {
		ctx.JSON(http.StatusBadRequest, gin.H{"error": "invalid_request"})
		return
	}
	if (req.ChannelID == nil) == (req.ChatID == nil) {
		// Neither, or both. A live belongs to exactly one place.
		ctx.JSON(http.StatusBadRequest, gin.H{"error": "one_home_required"})
		return
	}

	grant, err := c.svc.Start(ctx.Request.Context(), StartInput{
		ChannelID: req.ChannelID, ChatID: req.ChatID, Title: req.Title,
	}, middleware.UserIDFrom(ctx))
	writeGrant(ctx, grant, err)
}

// PostJoin — POST /lives/:id/join
func (c *Controller) PostJoin(ctx *gin.Context) {
	liveID, err := uuid.Parse(ctx.Param("id"))
	if err != nil {
		ctx.JSON(http.StatusBadRequest, gin.H{"error": "invalid_id"})
		return
	}
	grant, err := c.svc.Join(ctx.Request.Context(), liveID, middleware.UserIDFrom(ctx))
	writeGrant(ctx, grant, err)
}

// PostLeave — POST /lives/:id/leave
func (c *Controller) PostLeave(ctx *gin.Context) {
	liveID, err := uuid.Parse(ctx.Param("id"))
	if err != nil {
		ctx.JSON(http.StatusBadRequest, gin.H{"error": "invalid_id"})
		return
	}
	if err := c.svc.Leave(ctx.Request.Context(), liveID, middleware.UserIDFrom(ctx)); err != nil {
		ctx.JSON(http.StatusInternalServerError, gin.H{"error": "internal"})
		return
	}
	ctx.Status(http.StatusNoContent)
}

// PostEnd — POST /lives/:id/end
func (c *Controller) PostEnd(ctx *gin.Context) {
	liveID, err := uuid.Parse(ctx.Param("id"))
	if err != nil {
		ctx.JSON(http.StatusBadRequest, gin.H{"error": "invalid_id"})
		return
	}
	switch err := c.svc.End(ctx.Request.Context(), liveID, middleware.UserIDFrom(ctx)); {
	case errors.Is(err, ErrNoLive), errors.Is(err, ErrNotAllowed):
		ctx.JSON(http.StatusNotFound, gin.H{"error": "no_live"})
	case err != nil:
		ctx.JSON(http.StatusInternalServerError, gin.H{"error": "internal"})
	default:
		ctx.Status(http.StatusNoContent)
	}
}

// GetRunning — GET /lives
func (c *Controller) GetRunning(ctx *gin.Context) {
	list, err := c.svc.Running(ctx.Request.Context(), middleware.UserIDFrom(ctx))
	if err != nil {
		ctx.JSON(http.StatusInternalServerError, gin.H{"error": "internal"})
		return
	}
	ctx.JSON(http.StatusOK, list)
}

func writeGrant(ctx *gin.Context, grant Grant, err error) {
	switch {
	case errors.Is(err, ErrDisabled):
		ctx.JSON(http.StatusServiceUnavailable, gin.H{"error": ErrDisabled.Error()})
	case errors.Is(err, ErrAlreadyLive):
		ctx.JSON(http.StatusConflict, gin.H{"error": ErrAlreadyLive.Error()})
	case errors.Is(err, ErrNoLive), errors.Is(err, ErrNotAllowed):
		// Not-found for both: "you may not watch this" also confirms it exists.
		ctx.JSON(http.StatusNotFound, gin.H{"error": "no_live"})
	case err != nil:
		ctx.JSON(http.StatusInternalServerError, gin.H{"error": "internal"})
	default:
		ctx.JSON(http.StatusOK, grant)
	}
}

// Register mounts the live routes on a JWT-protected group.
func Register(rg *gin.RouterGroup, c *Controller) {
	rg.POST("/lives", c.PostStart)
	rg.GET("/lives", c.GetRunning)
	rg.POST("/lives/:id/join", c.PostJoin)
	rg.POST("/lives/:id/leave", c.PostLeave)
	rg.POST("/lives/:id/end", c.PostEnd)
}
