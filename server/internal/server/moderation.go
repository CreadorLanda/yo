package server

import (
	"context"
	"errors"
	"time"

	"github.com/google/uuid"

	"github.com/CreadorLanda/zwosocial/server/internal/modules/bots"
	"github.com/CreadorLanda/zwosocial/server/internal/modules/groups"
	"github.com/CreadorLanda/zwosocial/server/internal/modules/messages"
)

// moderator lets a bot moderate (#333) through the groups and messages
// modules, which the bots module may not import, and translates their
// errors into the bots module's.
type moderator struct {
	groups   *groups.Service
	messages *messages.Service
}

var _ bots.Moderator = moderator{}

func modErr(err error) error {
	switch {
	case err == nil:
		return nil
	case errors.Is(err, groups.ErrCannotModerate):
		return bots.ErrCannotModerate
	case errors.Is(err, groups.ErrInvalidMute):
		return bots.ErrInvalidMute
	case errors.Is(err, groups.ErrNotMember):
		return bots.ErrNotMember
	case errors.Is(err, groups.ErrNotFound):
		return bots.ErrChatNotFound
	case errors.Is(err, messages.ErrMessageNotFound):
		return bots.ErrMessageNotFound
	}
	return err
}

func (m moderator) Mute(ctx context.Context, chatID, actor, target uuid.UUID, until time.Time) error {
	return modErr(m.groups.Mute(ctx, chatID, actor, target, until))
}

func (m moderator) Unmute(ctx context.Context, chatID, actor, target uuid.UUID) error {
	return modErr(m.groups.Unmute(ctx, chatID, actor, target))
}

func (m moderator) Kick(ctx context.Context, chatID, actor, target uuid.UUID) error {
	return modErr(m.groups.Kick(ctx, chatID, actor, target))
}

func (m moderator) Ban(ctx context.Context, chatID, actor, target uuid.UUID, reason string) error {
	return modErr(m.groups.Ban(ctx, chatID, actor, target, reason))
}

func (m moderator) Unban(ctx context.Context, chatID, actor, target uuid.UUID) error {
	return modErr(m.groups.Unban(ctx, chatID, actor, target))
}

func (m moderator) DeleteMessage(ctx context.Context, chatID uuid.UUID, messageID int64) error {
	return modErr(m.messages.DeleteAsModerator(ctx, chatID, messageID))
}
