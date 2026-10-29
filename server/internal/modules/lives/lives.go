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
	// ErrBanned means a moderator removed this person from this live.
	// Said plainly: they were in it, so there is nothing left to hide.
	ErrBanned = errors.New("banned")
	// ErrForbidden is an action inside a live this person may see but may not
	// take, such as a viewer trying to ban someone.
	ErrForbidden = errors.New("forbidden")
	// ErrInvalid is a request that makes no sense, like a place audience for a
	// live from Stories or an empty comment.
	ErrInvalid = errors.New("invalid_request")
	// ErrNothingPending is answering an invitation that is not there.
	ErrNothingPending = errors.New("nothing_pending")
	// ErrCommentsOff means the hosts turned comments off.
	ErrCommentsOff = errors.New("comments_off")
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
	// DirectPeer is the other person when the chat is a direct one, and nil
	// for a group. A live in a direct chat is a joint live.
	DirectPeer(ctx context.Context, chatID, userID uuid.UUID) (*uuid.UUID, error)
	// IsContact — the two share a conversation.
	IsContact(ctx context.Context, a, b uuid.UUID) (bool, error)
	// Contacts is everyone this user shares a conversation with.
	Contacts(ctx context.Context, userID uuid.UUID) ([]uuid.UUID, error)
	// ModeratesChat — a group admin or moderator, who moderates a live in
	// their group without being appointed.
	ModeratesChat(ctx context.Context, chatID, userID uuid.UUID) (bool, error)
	// ModeratesChannel — a channel owner or admin, likewise.
	ModeratesChannel(ctx context.Context, channelID, userID uuid.UUID) (bool, error)
}

// RoomControl changes rights in a room that is already running. A token is
// only read on connect, so promoting, demoting and removing have to reach the
// SFU directly.
type RoomControl interface {
	SetPublish(ctx context.Context, room, identity string, publish bool) error
	Remove(ctx context.Context, room, identity string) error
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
	// Notify is everything else that happens inside a live: a comment, someone
	// called on stage, a ban. event is the websocket type, data its body.
	Notify(ctx context.Context, users []uuid.UUID, event string, liveID uuid.UUID, data map[string]any)
}

type Service struct {
	signer   *livekit.Signer
	repo     *Repo
	audience Audience
	users    Identity
	announce Announcer
	room     RoomControl
}

func NewService(signer *livekit.Signer, repo *Repo, audience Audience, users Identity, announce Announcer) *Service {
	return &Service{signer: signer, repo: repo, audience: audience, users: users, announce: announce}
}

// WithRoom wires the SFU's room service. Separate from NewService so tests
// and a server without an SFU keep working: with none, a change of rights
// waits for the person's next connect.
func (s *Service) WithRoom(r RoomControl) *Service {
	s.room = r
	return s
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
	// enforces it; this is so the client knows which screen to draw. True for
	// both hosts of a joint live.
	Host bool `json:"host"`
	// Role is host, cohost, moderator, guest or viewer: the most a person is
	// in this live, for the client to decide which tools to show.
	Role string `json:"role"`
	// Moderator says whether the moderation tools apply to this person.
	Moderator bool `json:"moderator"`
}

// Start begins a broadcast.
//
// In a direct chat the other person becomes a co-host and is invited the way
// a call rings them; declining keeps their seat, so they can walk in later.
func (s *Service) Start(ctx context.Context, in StartInput, host uuid.UUID) (Grant, error) {
	if !s.signer.Enabled() {
		return Grant{}, ErrDisabled
	}
	if in.ChannelID != nil && in.ChatID != nil {
		return Grant{}, ErrInvalid
	}
	if err := s.mayBroadcast(ctx, in, host); err != nil {
		return Grant{}, err
	}

	home := in.ChannelID != nil || in.ChatID != nil
	if in.Audience == "" {
		in.Audience = AudienceContacts
		if home {
			in.Audience = AudiencePlace
		}
	}
	if !in.Audience.valid() || (in.Audience == AudiencePlace && !home) {
		return Grant{}, ErrInvalid
	}
	if in.Audience != AudienceSelected {
		in.Viewers = nil
	}
	in.Cohost = nil
	if in.ChatID != nil {
		if peer, err := s.audience.DirectPeer(ctx, *in.ChatID, host); err == nil && peer != nil {
			in.Cohost = peer
		}
	}

	live, err := s.repo.Start(ctx, in, host)
	if err != nil {
		return Grant{}, err
	}

	name := s.nameOf(ctx, host)
	token, _, err := s.signer.Sign(host.String(), name, live.ID.String(), livekit.Broadcaster)
	if err != nil {
		return Grant{}, err
	}
	live.HostName = name

	if s.announce != nil {
		if who, err := s.audienceOf(ctx, live); err == nil {
			s.announce.Started(ctx, without(who, host), live)
		}
		if in.Cohost != nil {
			s.announce.Notify(ctx, []uuid.UUID{*in.Cohost}, "live.cohost_invite", live.ID,
				map[string]any{"live": live})
		}
	}

	return Grant{
		Live: live, URL: s.signer.URL(), Room: live.ID.String(),
		Token: token, Identity: host.String(), Host: true, Role: "host", Moderator: true,
	}, nil
}

// Join puts someone in the room, with the rights their part gives them.
//
// The host joining their own broadcast (after a crash, or from a second
// device) gets the broadcaster's token back rather than a viewer's, and so
// does a co-host, whether they accepted the invitation, declined it, or never
// answered: declining is "not now", not "never".
func (s *Service) Join(ctx context.Context, liveID, userID uuid.UUID) (Grant, error) {
	if !s.signer.Enabled() {
		return Grant{}, ErrDisabled
	}
	live, err := s.repo.Get(ctx, liveID)
	if err != nil || live.EndedAt != nil {
		return Grant{}, ErrNoLive
	}
	acc, err := s.access(ctx, live, userID)
	if err != nil {
		return Grant{}, err
	}
	if err := s.mayWatch(ctx, live, userID, acc); err != nil {
		return Grant{}, err
	}

	broadcaster := acc.host || acc.cohost
	role := livekit.Viewer
	if broadcaster || acc.onStage() {
		role = livekit.Broadcaster
	}

	token, _, err := s.signer.Sign(userID.String(), s.nameOf(ctx, userID), live.ID.String(), role)
	if err != nil {
		return Grant{}, err
	}

	if acc.cohost && (acc.member.CohostAnswer == nil || *acc.member.CohostAnswer != "accepted") {
		_ = s.repo.SetCohostAnswer(ctx, live.ID, userID, "accepted")
		s.notifyRoom(ctx, live, "live.member", map[string]any{"user_id": userID, "cohost_answer": "accepted"})
	}

	// Hosts are not viewers. Counting them would put "1 watching" on an empty
	// broadcast, which is the number they are watching most closely.
	if !broadcaster {
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
		Token: token, Identity: userID.String(), Host: broadcaster,
		Role: acc.role(), Moderator: acc.moderator,
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
	acc, err := s.access(ctx, live, userID)
	if err != nil {
		return err
	}
	if !acc.host && !acc.cohost {
		return ErrNotAllowed
	}
	if err := s.repo.End(ctx, liveID); err != nil {
		return err
	}
	if s.announce != nil {
		// Everyone who was watching, plus everyone who was told it started —
		// both have something on screen that is now false.
		who, _ := s.audienceOf(ctx, live)
		room, _ := s.roomUsers(ctx, live)
		s.announce.Ended(ctx, without(union(who, room), userID), liveID)
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
		// From Stories: anyone may go live to an audience they choose.
	}
	return nil
}

// mayWatch answers "may this person be in this live". Anyone with a part in
// it may; a ban overrides everything but hosting it.
func (s *Service) mayWatch(ctx context.Context, live Live, userID uuid.UUID, acc access) error {
	if acc.host || acc.cohost {
		return nil
	}
	if banned, err := s.repo.IsBanned(ctx, live.ID, userID); err != nil {
		return err
	} else if banned {
		return ErrBanned
	}
	if acc.moderator || acc.member.Allowed || acc.member.Stage != nil {
		return nil
	}
	var ok bool
	var err error
	switch live.Audience {
	case AudiencePublic:
		return nil
	case AudienceSelected:
		ok = false
	case AudienceContacts:
		ok, err = s.contactOfAHost(ctx, live, userID)
	default:
		switch {
		case live.ChannelID != nil:
			ok, err = s.audience.CanWatchChannel(ctx, *live.ChannelID, userID)
		case live.ChatID != nil:
			ok, err = s.audience.InChat(ctx, *live.ChatID, userID)
		}
	}
	if err != nil || !ok {
		return ErrNotAllowed
	}
	return nil
}

func (s *Service) contactOfAHost(ctx context.Context, live Live, userID uuid.UUID) (bool, error) {
	hosts, err := s.hostIDs(ctx, live)
	if err != nil {
		return false, err
	}
	for _, h := range hosts {
		if ok, err := s.audience.IsContact(ctx, h, userID); err == nil && ok {
			return true, nil
		}
	}
	return false, nil
}

// audienceOf is who to tell a live started or ended: the people allowed to
// watch it. A public live is announced to the hosts' contacts, since "anyone
// with the link" is nobody in particular.
func (s *Service) audienceOf(ctx context.Context, live Live) ([]uuid.UUID, error) {
	invited, err := s.repo.AllowedIDs(ctx, live.ID)
	if err != nil {
		return nil, err
	}
	switch live.Audience {
	case AudienceSelected:
		return invited, nil
	case AudienceContacts, AudiencePublic:
		hosts, err := s.hostIDs(ctx, live)
		if err != nil {
			return nil, err
		}
		out := invited
		for _, h := range hosts {
			c, err := s.audience.Contacts(ctx, h)
			if err != nil {
				return nil, err
			}
			out = union(out, c)
		}
		return out, nil
	}
	if live.ChannelID != nil {
		members, err := s.audience.ChannelFollowers(ctx, *live.ChannelID)
		return union(members, invited), err
	}
	if live.ChatID != nil {
		members, err := s.audience.ChatMembers(ctx, *live.ChatID)
		return union(members, invited), err
	}
	return invited, nil
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
	hosts, _ := s.hostIDs(ctx, live)
	s.announce.Viewers(ctx, union(watching, hosts), live.ID, n)
}

// union merges two id lists without repeats.
func union(a, b []uuid.UUID) []uuid.UUID {
	seen := make(map[uuid.UUID]bool, len(a)+len(b))
	out := make([]uuid.UUID, 0, len(a)+len(b))
	for _, list := range [][]uuid.UUID{a, b} {
		for _, id := range list {
			if !seen[id] {
				seen[id] = true
				out = append(out, id)
			}
		}
	}
	return out
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
	ChannelID *uuid.UUID   `json:"channel_id"`
	ChatID    *uuid.UUID   `json:"chat_id"`
	Title     string       `json:"title"`
	Audience  AudienceKind `json:"audience"`
	ViewerIDs []uuid.UUID  `json:"viewer_ids"`
}

// PostStart — POST /lives
func (c *Controller) PostStart(ctx *gin.Context) {
	var req startRequest
	if err := ctx.ShouldBindJSON(&req); err != nil {
		ctx.JSON(http.StatusBadRequest, gin.H{"error": "invalid_request"})
		return
	}
	if req.ChannelID != nil && req.ChatID != nil {
		// Both. A live belongs to at most one place; neither is a live from
		// Stories.
		ctx.JSON(http.StatusBadRequest, gin.H{"error": "one_home_required"})
		return
	}
	if len(req.ViewerIDs) > 200 {
		ctx.JSON(http.StatusBadRequest, gin.H{"error": "invalid_request"})
		return
	}

	grant, err := c.svc.Start(ctx.Request.Context(), StartInput{
		ChannelID: req.ChannelID, ChatID: req.ChatID, Title: req.Title,
		Audience: req.Audience, Viewers: req.ViewerIDs,
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
	case errors.Is(err, ErrBanned):
		ctx.JSON(http.StatusForbidden, gin.H{"error": ErrBanned.Error()})
	case errors.Is(err, ErrInvalid):
		ctx.JSON(http.StatusBadRequest, gin.H{"error": ErrInvalid.Error()})
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
	registerTools(rg, c)
}
