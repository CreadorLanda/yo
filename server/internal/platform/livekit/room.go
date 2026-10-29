package livekit

import (
	"context"
	"fmt"
	"net/http"
	"strings"
	"time"

	"github.com/livekit/protocol/auth"
	lk "github.com/livekit/protocol/livekit"
	"github.com/twitchtv/twirp"
)

// Room changes what someone may do in a room that is already running.
//
// A token is only checked when someone connects. Promoting a viewer to the
// stage, taking them off it, or throwing someone out has to reach the SFU
// directly, or the change would wait for the next reconnect and a banned
// viewer could sit in the room for as long as their connection held.
type Room struct {
	cfg    Config
	client lk.RoomService
}

// NewRoom returns nil when the SFU is not configured, which every caller
// treats as "nothing to tell it".
func NewRoom(cfg Config) *Room {
	if !cfg.Enabled() {
		return nil
	}
	return &Room{
		cfg:    cfg,
		client: lk.NewRoomServiceProtobufClient(httpURL(cfg.URL), &http.Client{Timeout: 5 * time.Second}),
	}
}

// SetPublish grants or revokes publishing for someone already in the room.
// Subscribing and the data channel stay as they were: a guest leaving the
// stage goes back to watching and commenting, not out of the room.
func (r *Room) SetPublish(ctx context.Context, room, identity string, publish bool) error {
	ctx, err := r.admin(ctx, room)
	if err != nil {
		return err
	}
	_, err = r.client.UpdateParticipant(ctx, &lk.UpdateParticipantRequest{
		Room:     room,
		Identity: identity,
		Permission: &lk.ParticipantPermission{
			CanSubscribe:   true,
			CanPublish:     publish,
			CanPublishData: true,
		},
	})
	return ignoreNotFound(err)
}

// Remove takes someone out of the room now.
func (r *Room) Remove(ctx context.Context, room, identity string) error {
	ctx, err := r.admin(ctx, room)
	if err != nil {
		return err
	}
	_, err = r.client.RemoveParticipant(ctx, &lk.RoomParticipantIdentity{Room: room, Identity: identity})
	return ignoreNotFound(err)
}

// admin signs a short token allowed to administer this one room, and puts it
// on the request. Scoped to the room so a leaked header is worth one live.
func (r *Room) admin(ctx context.Context, room string) (context.Context, error) {
	token, err := auth.NewAccessToken(r.cfg.APIKey, r.cfg.APISecret).
		SetValidFor(time.Minute).
		SetVideoGrant(&auth.VideoGrant{Room: room, RoomAdmin: true}).
		ToJWT()
	if err != nil {
		return ctx, err
	}
	h := make(http.Header)
	h.Set("Authorization", "Bearer "+token)
	return twirp.WithHTTPRequestHeaders(ctx, h)
}

// The participant having already left is the outcome we wanted.
func ignoreNotFound(err error) error {
	if err == nil {
		return nil
	}
	if te, ok := err.(twirp.Error); ok && te.Code() == twirp.NotFound {
		return nil
	}
	return fmt.Errorf("livekit room service: %w", err)
}

// The clients dial ws(s)://; the service API is the same host over http(s).
func httpURL(u string) string {
	switch {
	case strings.HasPrefix(u, "wss://"):
		return "https://" + strings.TrimPrefix(u, "wss://")
	case strings.HasPrefix(u, "ws://"):
		return "http://" + strings.TrimPrefix(u, "ws://")
	}
	return u
}
