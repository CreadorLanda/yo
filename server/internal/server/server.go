// Package server wires platform packages to feature modules. This is the
// only place that knows about every module — modules themselves stay
// independent and self-contained.
package server

import (
	"context"
	"errors"
	"fmt"
	"net/http"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/redis/go-redis/v9"
	"github.com/rs/zerolog/log"

	"github.com/CreadorLanda/yo/server/internal/config"
	"github.com/CreadorLanda/yo/server/internal/middleware"
	"github.com/CreadorLanda/yo/server/internal/modules/auth"
	"github.com/CreadorLanda/yo/server/internal/modules/blocks"
	"github.com/CreadorLanda/yo/server/internal/modules/calls"
	"github.com/CreadorLanda/yo/server/internal/modules/channels"
	"github.com/CreadorLanda/yo/server/internal/modules/groups"
	"github.com/CreadorLanda/yo/server/internal/modules/health"
	"github.com/CreadorLanda/yo/server/internal/modules/keys"
	"github.com/CreadorLanda/yo/server/internal/modules/lives"
	"github.com/CreadorLanda/yo/server/internal/modules/media"
	"github.com/CreadorLanda/yo/server/internal/modules/messages"
	"github.com/CreadorLanda/yo/server/internal/modules/notifications"
	"github.com/CreadorLanda/yo/server/internal/modules/stickers"
	"github.com/CreadorLanda/yo/server/internal/modules/stories"
	"github.com/CreadorLanda/yo/server/internal/modules/users"
	lkplatform "github.com/CreadorLanda/yo/server/internal/platform/livekit"
	pgplatform "github.com/CreadorLanda/yo/server/internal/platform/postgres"
	"github.com/CreadorLanda/yo/server/internal/platform/realtime"
	rdplatform "github.com/CreadorLanda/yo/server/internal/platform/redis"
)

// Server is the running API process — owns the routers and the platform
// connections, so shutdown can close everything in one place.
type Server struct {
	cfg          config.Config
	router       http.Handler
	pg           *pgxpool.Pool
	rdb          *redis.Client
	pushWorker   *notifications.Worker
	callSweeper  *calls.Sweeper
	liveSweeper  *lives.Sweeper
	mediaSweeper *media.Sweeper
	msgSweeper   *messages.Sweeper
	pubSrv       *http.Server
	errCh        chan error
}

// New constructs the Server: opens the platform connections, builds each
// module, and registers routes.
func New(cfg config.Config) (*Server, error) {
	ctx := context.Background()

	pg, err := pgplatform.Open(ctx, cfg.Postgres.URL)
	if err != nil {
		return nil, err
	}
	rdb, err := rdplatform.Open(ctx, cfg.Redis.URL)
	if err != nil {
		pg.Close()
		return nil, err
	}

	if cfg.Env == "prod" {
		gin.SetMode(gin.ReleaseMode)
	}
	r := gin.New()
	r.Use(middleware.RequestID(), middleware.Recovery(), gin.Logger())

	api := r.Group("/api")

	// Health is mounted on /api so a single load-balancer rule covers it.
	health.New(pg, rdb).Register(api)

	// Public routes (no auth required).
	authRepo := auth.NewRepository(pg)
	authSvc := auth.NewService(authRepo, rdb, cfg.JWT)
	authCtl := auth.NewController(authSvc, cfg)
	auth.Register(api, authCtl)

	// Protected routes — every endpoint past this point needs a valid
	// access token. Mounted as a sub-group so /auth/* stays open.
	authed := api.Group("")
	authed.Use(middleware.Auth([]byte(cfg.JWT.Secret)))

	usersRepo := users.NewRepository(pg)
	usersCtl := users.NewController(users.NewService(usersRepo))
	users.Register(authed, usersCtl)

	keysRepo := keys.NewRepository(pg)
	keysSvc := keys.NewService(keysRepo, usersRepo)
	keysCtl := keys.NewController(keysSvc)
	keys.Register(authed, keysCtl)

	// Realtime hub (WebSocket fan-out for messaging events).
	hub := realtime.NewHub()
	// The hub knows who holds a socket; the database is where "when were they
	// last holding one" has to live, so that it survives a restart. Only the
	// closing edge is recorded — while they are connected they are online,
	// and a last-seen for someone who is here now is not a fact anyone needs.
	//
	// A frozen last seen declines the write inside TouchLastSeen, so nothing
	// here has to know about the setting.
	hub.OnPresenceChange = func(userID uuid.UUID, online bool) {
		if online {
			return
		}
		ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
		defer cancel()
		if err := usersRepo.TouchLastSeen(ctx, userID); err != nil {
			log.Warn().Err(err).Str("user", userID.String()).Msg("last seen not recorded")
		}
	}

	// Notifications — device tokens, prefs, Redis push queue + worker.
	notifRepo := notifications.NewRepository(pg)
	notifSvc := notifications.NewService(notifRepo, rdb)
	notifCtl := notifications.NewController(notifSvc)
	notifications.Register(authed, notifCtl)
	pushWorker := notifications.NewWorker(notifRepo, rdb, notifications.WorkerOpts{
		WebhookURL: cfg.Push.WebhookURL,
		FCM: notifications.FCMConfig{
			ProjectID:       cfg.Push.FCMProjectID,
			CredentialsFile: cfg.Push.FCMCredentialsFile,
			CredentialsJSON: []byte(cfg.Push.FCMCredentialsJSON),
		},
	})

	// Native E2E-encrypted messaging (push for offline peers via notifSvc).
	msgRepo := messages.NewRepository(pg, cfg.Crypto.MessageKey)
	// Blocking, which both messages and calls consult through a narrow
	// interface rather than importing this module.
	blocksRepo := blocks.NewRepo(pg)
	blocksCtl := blocks.NewController(blocks.NewService(blocksRepo, blockDirectory{
		users: usersRepo, chats: msgRepo,
	}))

	msgSvc := messages.NewService(msgRepo, usersRepo, hub, notifSvc).
		WithBlocks(blocksRepo)
	msgCtl := messages.NewController(msgSvc, hub, []byte(cfg.JWT.Secret))
	messages.Register(authed, msgCtl)
	// WS lives on the public /api group — token is validated inside the handler.
	messages.RegisterWS(api, msgCtl)

	// Media uploads (auth) + public file streaming by UUID.
	mediaRepo := media.NewRepository(pg)
	mediaSvc := media.NewService(mediaRepo, cfg.Media.Dir, cfg.Media.MaxUploadBytes, cfg.Media.TTL)
	mediaCtl := media.NewController(mediaSvc)
	media.Register(authed, mediaCtl)

	// The server is a relay for media, not a store: bytes are swept once
	// every recipient has them, or when the deadline passes.
	mediaSweeper := media.NewSweeper(mediaRepo, cfg.Media.Dir, cfg.Media.SweepEvery)

	// Group chats (roles + history settings on chats type=group).
	groupsRepo := groups.NewRepository(pg)
	groupsCtl := groups.NewController(groups.NewService(groupsRepo))
	groups.Register(authed, groupsCtl)

	// Ephemeral stories (24h feed + views).
	storiesRepo := stories.NewRepository(pg)
	storiesCtl := stories.NewController(stories.NewService(storiesRepo, chatOpener{msgSvc}))
	stories.Register(authed, storiesCtl)

	// Imported sticker packs (bytes live in media_objects).
	stickersRepo := stickers.NewRepository(pg)
	stickersCtl := stickers.NewController(stickers.NewService(stickersRepo, mediaCopier{mediaSvc}))
	stickers.Register(authed, stickersCtl)

	// Calls: the server signs who may join which room and nothing else. No
	// audio or video passes through here — the SFU is a separate process, and
	// the streams are encrypted with a key derived on the devices.
	//
	// The history repo records who rang whom and who answered — the call log
	// read from bundled sample data before this.
	callsHistory := calls.NewHistoryRepo(pg)
	// A call whose participants all vanished would otherwise stay "running"
	// forever, and the log would offer to join an empty room.
	callSweeper := calls.NewSweeper(callsHistory, 10*time.Minute, 4*time.Hour)
	callsCtl := calls.NewController(calls.NewService(
		calls.Config{
			URL:       cfg.LiveKit.URL,
			APIKey:    cfg.LiveKit.APIKey,
			APISecret: cfg.LiveKit.APISecret,
		},
		chatParticipation{msgRepo},
		userNames{usersRepo},
		callRinger{repo: msgRepo, hub: hub, push: notifSvc},
		callsHistory,
		callTrace{repo: msgRepo, hub: hub},
	).WithBlocks(callBlocks{blocks: blocksRepo, chats: msgRepo}))
	calls.Register(authed, callsCtl)
	blocks.Register(authed, blocksCtl)

	// Discover channels + posts.
	channelsRepo := channels.NewRepository(pg)
	channelsCtl := channels.NewController(channels.NewService(channelsRepo))
	channels.Register(authed, channelsCtl)

	// Live broadcasts. One person publishing to an audience that cannot
	// publish back — enforced in the token the SFU checks, not in the client.
	livesRepo := lives.NewRepo(pg)
	// A host whose phone dies reports nothing, so a broadcast would stay live
	// forever and offer an empty room. Same fault calls had, same backstop.
	liveSweeper := lives.NewSweeper(livesRepo, 10*time.Minute, 6*time.Hour)
	livesCtl := lives.NewController(lives.NewService(
		lkplatform.NewSigner(lkplatform.Config{
			URL:       cfg.LiveKit.URL,
			APIKey:    cfg.LiveKit.APIKey,
			APISecret: cfg.LiveKit.APISecret,
		}),
		livesRepo,
		liveAudience{chats: msgRepo, channels: channelsRepo},
		userNames{usersRepo},
		liveAnnouncer{hub: hub},
	))
	lives.Register(authed, livesCtl)

	return &Server{
		cfg: cfg, router: r, pg: pg, rdb: rdb,
		pushWorker: pushWorker, mediaSweeper: mediaSweeper, callSweeper: callSweeper,
		liveSweeper: liveSweeper,
		msgSweeper:  messages.NewSweeper(msgSvc, 5*time.Minute),
		errCh:       make(chan error, 2),
	}, nil
}

// chatParticipation and userNames adapt existing repositories to the narrow
// interfaces the calls module declares, so it imports neither — same pattern
// as mediaCopier below.
type chatParticipation struct{ repo *messages.Repository }

func (c chatParticipation) IsParticipant(ctx context.Context, chatID, userID uuid.UUID) (bool, error) {
	return c.repo.IsParticipant(ctx, chatID, userID)
}

func (c chatParticipation) MemberIDs(ctx context.Context, chatID uuid.UUID) ([]uuid.UUID, error) {
	return c.repo.ParticipantIDs(ctx, chatID)
}

// callRinger makes the other phones ring.
//
// Live participants get a websocket event, which the app turns into an
// incoming-call screen. Everyone else gets a push — without it a call is
// silent until someone happens to open the app.
type callRinger struct {
	repo *messages.Repository
	hub  *realtime.Hub
	push *notifications.Service
}

func (c callRinger) Ring(ctx context.Context, chatID, caller uuid.UUID, callerName, mode string) {
	ids, err := c.repo.ParticipantIDs(ctx, chatID)
	if err != nil {
		return
	}
	data := map[string]string{
		"type":        "call.incoming",
		"chat_id":     chatID.String(),
		"caller_id":   caller.String(),
		"caller_name": callerName,
		"mode":        mode,
	}

	for _, uid := range ids {
		if uid == caller {
			continue
		}
		if c.hub != nil && c.hub.Online(uid) {
			// Already on the wire — a push as well would ring twice.
			c.hub.PublishJSON([]uuid.UUID{uid}, "call.incoming", chatID.String(), data)
			continue
		}
		if c.push != nil {
			_ = c.push.NotifyUser(ctx, uid, "calls", callerName, callBody(mode), data)
		}
	}
}

// RingUsers reaches a named few rather than everyone in the chat.
//
// Used when people are pulled into a call already running: they may not be in
// the conversation at all, so "everyone in the chat" would both miss them and
// ring people who are already talking.
func (c callRinger) RingUsers(ctx context.Context, chatID uuid.UUID, users []uuid.UUID, callerName, mode string) {
	data := map[string]string{
		"type":        "call.incoming",
		"chat_id":     chatID.String(),
		"caller_name": callerName,
		"mode":        mode,
	}
	for _, uid := range users {
		if c.hub != nil && c.hub.Online(uid) {
			c.hub.PublishJSON([]uuid.UUID{uid}, "call.incoming", chatID.String(), data)
			continue
		}
		if c.push != nil {
			_ = c.push.NotifyUser(ctx, uid, "calls", callerName, callBody(mode), data)
		}
	}
}

// Stopped tells the phones still ringing that the call is over.
//
// Only over the websocket, and deliberately: a push saying "the call you were
// never told about has ended" is worse than silence. A phone that was asleep
// gets the missed call in the log, which is where it belongs.
func (c callRinger) Stopped(ctx context.Context, chatID uuid.UUID, users []uuid.UUID) {
	if c.hub == nil {
		return
	}
	data := map[string]string{
		"type":    "call.ended",
		"chat_id": chatID.String(),
	}
	for _, uid := range users {
		if c.hub.Online(uid) {
			c.hub.PublishJSON([]uuid.UUID{uid}, "call.ended", chatID.String(), data)
		}
	}
}

// blockDirectory lets the blocks module ask whether a person exists and who
// the other side of a chat is, without importing users or messages.
type blockDirectory struct {
	users *users.Repository
	chats *messages.Repository
}

func (d blockDirectory) Exists(ctx context.Context, userID uuid.UUID) (bool, error) {
	_, err := d.users.ByID(ctx, userID)
	if err != nil {
		return false, nil
	}
	return true, nil
}

func (d blockDirectory) PeerOf(ctx context.Context, chatID, userID uuid.UUID) (uuid.UUID, error) {
	peer, err := d.chats.PeerUser(ctx, chatID, userID)
	if err != nil {
		return uuid.Nil, err
	}
	if peer == nil {
		// A group, which has no single peer. Calls read this as "not a
		// one-to-one call" and let it through, which is the intended rule.
		return uuid.Nil, errNoPeer
	}
	return peer.ID, nil
}

var errNoPeer = errors.New("no_peer")

// callBlocks is the same pair of questions, for the calls module.
type callBlocks struct {
	blocks *blocks.Repo
	chats  *messages.Repository
}

func (c callBlocks) EitherWay(ctx context.Context, a, b uuid.UUID) (bool, error) {
	return c.blocks.EitherWay(ctx, a, b)
}

func (c callBlocks) PeerOf(ctx context.Context, chatID, userID uuid.UUID) (uuid.UUID, error) {
	return blockDirectory{chats: c.chats}.PeerOf(ctx, chatID, userID)
}

// liveAudience answers the two questions a broadcast asks, from the modules
// that already know: who is in a chat, and what a channel lets someone do.
//
// The same adapter pattern as chatParticipation — the lives module imports
// neither messages nor channels.
type liveAudience struct {
	chats    *messages.Repository
	channels *channels.Repository
}

// CanBroadcastToChannel mirrors who may post: a live is a post that happens
// now, and a channel that lets you write to it lets you speak to it.
func (a liveAudience) CanBroadcastToChannel(ctx context.Context, channelID, userID uuid.UUID) (bool, error) {
	c, err := a.channels.Get(ctx, channelID, userID)
	if err != nil {
		return false, err
	}
	switch c.Role {
	case string(channels.RoleOwner), string(channels.RoleAdmin):
		return true, nil
	case string(channels.RolePublisher):
		return c.WhoCanPost == string(channels.PostPublishers) ||
			c.WhoCanPost == string(channels.PostEveryone), nil
	default:
		return c.WhoCanPost == string(channels.PostEveryone) && c.Following, nil
	}
}

// CanWatchChannel: a public channel is public — that is the whole meaning of
// the setting. A private one admits the people who joined it.
func (a liveAudience) CanWatchChannel(ctx context.Context, channelID, userID uuid.UUID) (bool, error) {
	c, err := a.channels.Get(ctx, channelID, userID)
	if err != nil {
		return false, err
	}
	if c.Visibility == string(channels.VisPublic) {
		return true, nil
	}
	return c.Following, nil
}

func (a liveAudience) InChat(ctx context.Context, chatID, userID uuid.UUID) (bool, error) {
	return a.chats.IsParticipant(ctx, chatID, userID)
}

func (a liveAudience) ChatMembers(ctx context.Context, chatID uuid.UUID) ([]uuid.UUID, error) {
	return a.chats.ParticipantIDs(ctx, chatID)
}

func (a liveAudience) ChannelFollowers(ctx context.Context, channelID uuid.UUID) ([]uuid.UUID, error) {
	return a.channels.MemberIDs(ctx, channelID)
}

// liveAnnouncer tells people over the websocket.
//
// No push. A broadcast is worth interrupting someone for only if they asked to
// be interrupted, and there is no such setting yet; waking every follower of
// every channel is how an app gets muted. The live shows up when they open it.
type liveAnnouncer struct{ hub *realtime.Hub }

func (a liveAnnouncer) Started(_ context.Context, users []uuid.UUID, live lives.Live) {
	if a.hub == nil {
		return
	}
	a.hub.PublishJSON(users, "live.started", live.ID.String(), map[string]any{
		"type": "live.started", "live": live,
	})
}

func (a liveAnnouncer) Ended(_ context.Context, users []uuid.UUID, liveID uuid.UUID) {
	if a.hub == nil {
		return
	}
	a.hub.PublishJSON(users, "live.ended", liveID.String(), map[string]string{
		"type": "live.ended", "live_id": liveID.String(),
	})
}

func (a liveAnnouncer) Viewers(_ context.Context, users []uuid.UUID, liveID uuid.UUID, n int) {
	if a.hub == nil {
		return
	}
	a.hub.PublishJSON(users, "live.viewers", liveID.String(), map[string]any{
		"type": "live.viewers", "live_id": liveID.String(), "viewers": n,
	})
}

func callBody(mode string) string {
	if mode == "video" {
		return "Incoming video call"
	}
	return "Incoming call"
}

// callTrace writes the row a call leaves in the conversation.
//
// The content is the call id and mode, not a sentence: the outcome — answered,
// missed, how long it lasted — is not known when the row is written, and the
// client resolves it from the call log when rendering.
type callTrace struct {
	repo *messages.Repository
	hub  *realtime.Hub
}

func (c callTrace) RecordCall(ctx context.Context, chatID, caller, callID uuid.UUID, mode string) {
	body := fmt.Sprintf(`{"call_id":%q,"mode":%q}`, callID.String(), mode)
	id, err := c.repo.InsertMessage(ctx, chatID, caller, body, messages.MsgCall, nil, nil, messages.Origin{})
	if err != nil || c.hub == nil {
		return
	}
	// Live participants see the row appear as the call starts, which is what
	// makes "join" reachable without leaving the conversation.
	ids, err := c.repo.ParticipantIDs(ctx, chatID)
	if err != nil {
		return
	}
	c.hub.PublishJSON(ids, "message.new", chatID.String(), map[string]any{
		"id": id, "chat_id": chatID.String(), "sender_id": caller.String(),
		"content": body, "message_type": string(messages.MsgCall),
	})
}

type userNames struct{ repo *users.Repository }

func (u userNames) DisplayName(ctx context.Context, userID uuid.UUID) (string, error) {
	usr, err := u.repo.ByID(ctx, userID)
	if err != nil || usr == nil {
		return "", err
	}
	return usr.DisplayName, nil
}

// mediaCopier adapts media.Service to the narrow interface the stickers
// module declares, so neither module has to know the other's shape.
type mediaCopier struct{ svc *media.Service }

func (m mediaCopier) Duplicate(ctx context.Context, srcID, newOwner uuid.UUID) (uuid.UUID, error) {
	obj, err := m.svc.Duplicate(ctx, srcID, newOwner)
	if err != nil {
		return uuid.Nil, err
	}
	return obj.ID, nil
}

func (s *Server) Handler() http.Handler { return s.router }

// ListenAndServe starts all listeners in the background.
// Returns immediately. Errors are sent to s.errCh.
func (s *Server) ListenAndServe() {
	s.pubSrv = &http.Server{
		Addr:              s.cfg.HTTP.Addr,
		Handler:           s.router,
		ReadHeaderTimeout: 10 * time.Second,
	}
	go func() {
		err := s.pubSrv.ListenAndServe()
		if err != nil && !errors.Is(err, http.ErrServerClosed) {
			s.errCh <- err
		}
	}()

	if s.callSweeper != nil {
		s.callSweeper.Start()
	}
	if s.liveSweeper != nil {
		s.liveSweeper.Start()
	}
	if s.pushWorker != nil {
		s.pushWorker.Start()
	}
	if s.mediaSweeper != nil {
		s.mediaSweeper.Start()
	}
	if s.msgSweeper != nil {
		s.msgSweeper.Start()
	}
}

// Err returns a channel that receives the first listener error.
func (s *Server) Err() <-chan error { return s.errCh }

// Close releases platform connections and stops all listeners.
// Safe to call multiple times.
func (s *Server) Close() {
	// Stop, not Start. This said Start, so shutting the server down launched
	// the sweeper's goroutine and ticker instead of cancelling them — the one
	// thing Close exists to do, done backwards.
	if s.callSweeper != nil {
		s.callSweeper.Stop()
	}
	if s.liveSweeper != nil {
		s.liveSweeper.Stop()
	}
	if s.pushWorker != nil {
		s.pushWorker.Stop()
	}
	if s.mediaSweeper != nil {
		s.mediaSweeper.Stop()
	}
	if s.msgSweeper != nil {
		s.msgSweeper.Stop()
	}
	if s.pubSrv != nil {
		_ = s.pubSrv.Close()
	}
	if s.rdb != nil {
		_ = s.rdb.Close()
	}
	if s.pg != nil {
		s.pg.Close()
	}
}

// chatOpener lets a blind story thread graduate into a real conversation
// without the stories module importing the messages one.
type chatOpener struct{ svc *messages.Service }

func (c chatOpener) OpenDirectChat(ctx context.Context, a, b uuid.UUID) (uuid.UUID, error) {
	chat, err := c.svc.CreateDirectChat(ctx, a, b)
	if err != nil {
		return uuid.Nil, err
	}
	return chat.ID, nil
}
