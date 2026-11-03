package lives

import (
	"context"
	"strings"
	"unicode/utf8"

	"github.com/google/uuid"
)

// MaxComment is the longest comment, in characters. The database holds the
// same limit, so a client that skips this check is refused there too.
const MaxComment = 300

// access is what one person is in one live.
type access struct {
	host      bool
	cohost    bool
	moderator bool
	member    Member
}

func (a access) onStage() bool {
	return a.member.Stage != nil && *a.member.Stage == StageOn
}

func (a access) role() string {
	switch {
	case a.host:
		return "host"
	case a.cohost:
		return "cohost"
	case a.moderator:
		return "moderator"
	case a.onStage():
		return "guest"
	}
	return "viewer"
}

// access works out someone's part. Moderation comes from three places: being
// a host, being appointed in this live, or moderating the group or channel it
// was started in. The last is read live rather than copied, so demoting a
// group admin takes effect in their running broadcasts too.
func (s *Service) access(ctx context.Context, live Live, userID uuid.UUID) (access, error) {
	m, _, err := s.repo.Member(ctx, live.ID, userID)
	if err != nil {
		return access{}, err
	}
	a := access{host: live.HostID == userID, cohost: m.Cohost, member: m}
	a.moderator = a.host || a.cohost || m.Moderator
	if !a.moderator {
		switch {
		case live.ChatID != nil:
			a.moderator, _ = s.audience.ModeratesChat(ctx, *live.ChatID, userID)
		case live.ChannelID != nil:
			a.moderator, _ = s.audience.ModeratesChannel(ctx, *live.ChannelID, userID)
		}
	}
	return a, nil
}

func (s *Service) nameOf(ctx context.Context, userID uuid.UUID) string {
	name, _ := s.users.DisplayName(ctx, userID)
	if name == "" {
		return "…"
	}
	return name
}

// hostIDs is the host and, in a joint live, the co-hosts.
func (s *Service) hostIDs(ctx context.Context, live Live) ([]uuid.UUID, error) {
	cohosts, err := s.repo.CohostIDs(ctx, live.ID)
	if err != nil {
		return nil, err
	}
	return union([]uuid.UUID{live.HostID}, cohosts), nil
}

// roomUsers is who has the live open: the audience and the hosts. Events that
// only make sense on the live screen go to them, not to everyone who may
// watch.
func (s *Service) roomUsers(ctx context.Context, live Live) ([]uuid.UUID, error) {
	watching, err := s.repo.Watching(ctx, live.ID)
	if err != nil {
		return nil, err
	}
	hosts, err := s.hostIDs(ctx, live)
	if err != nil {
		return nil, err
	}
	return union(watching, hosts), nil
}

func (s *Service) notifyRoom(ctx context.Context, live Live, event string, data map[string]any) {
	if s.announce == nil {
		return
	}
	users, err := s.roomUsers(ctx, live)
	if err != nil {
		return
	}
	s.announce.Notify(ctx, users, event, live.ID, data)
}

func (s *Service) notify(ctx context.Context, users []uuid.UUID, event string, live Live, data map[string]any) {
	if s.announce != nil {
		s.announce.Notify(ctx, users, event, live.ID, data)
	}
}

func (s *Service) setPublish(ctx context.Context, live Live, userID uuid.UUID, publish bool) {
	if s.room != nil {
		_ = s.room.SetPublish(ctx, live.ID.String(), userID.String(), publish)
	}
}

// running loads a live that has not ended and the caller's part in it.
func (s *Service) running(ctx context.Context, liveID, userID uuid.UUID) (Live, access, error) {
	live, err := s.repo.Get(ctx, liveID)
	if err != nil || live.EndedAt != nil {
		return Live{}, access{}, ErrNoLive
	}
	acc, err := s.access(ctx, live, userID)
	if err != nil {
		return Live{}, access{}, err
	}
	if err := s.mayWatch(ctx, live, userID, acc); err != nil {
		return Live{}, access{}, err
	}
	return live, acc, nil
}

// Details is what the live screen needs on open: the live, who has a part in
// it, what the caller may do, and the recent comments.
type Details struct {
	Live     Live      `json:"live"`
	Members  []Member  `json:"members"`
	Role     string    `json:"role"`
	Mod      bool      `json:"moderator"`
	Stage    *string   `json:"stage,omitempty"`
	Comments []Comment `json:"comments"`
}

func (s *Service) Details(ctx context.Context, liveID, userID uuid.UUID) (Details, error) {
	live, acc, err := s.running(ctx, liveID, userID)
	if err != nil {
		return Details{}, err
	}
	members, err := s.repo.Members(ctx, live.ID)
	if err != nil {
		return Details{}, err
	}
	comments, err := s.repo.Comments(ctx, live.ID, 50)
	if err != nil {
		return Details{}, err
	}
	return Details{
		Live: live, Members: members, Role: acc.role(), Mod: acc.moderator,
		Stage: acc.member.Stage, Comments: comments,
	}, nil
}

// Respond answers whatever is waiting for this person: the co-host
// invitation of a joint live, or a call to the stage.
func (s *Service) Respond(ctx context.Context, liveID, userID uuid.UUID, accept bool) error {
	live, acc, err := s.running(ctx, liveID, userID)
	if err != nil {
		return err
	}
	m := acc.member
	switch {
	case m.Cohost && (m.CohostAnswer == nil || *m.CohostAnswer == "pending"):
		answer := "declined"
		if accept {
			answer = "accepted"
		}
		if err := s.repo.SetCohostAnswer(ctx, live.ID, userID, answer); err != nil {
			return err
		}
		s.notifyRoom(ctx, live, "live.member", map[string]any{"user_id": userID, "cohost_answer": answer})
	case m.Stage != nil && *m.Stage == StageInvited:
		var stage *string
		if accept {
			on := StageOn
			stage = &on
		}
		if err := s.repo.SetStage(ctx, live.ID, userID, userID, stage); err != nil {
			return err
		}
		if accept {
			s.setPublish(ctx, live, userID, true)
		}
		s.notifyRoom(ctx, live, "live.stage", map[string]any{"user_id": userID, "stage": stage})
	default:
		return ErrNothingPending
	}
	return nil
}

// RequestStage is a viewer raising their hand. The moderators see it and
// decide; nothing reaches the SFU until one of them does.
func (s *Service) RequestStage(ctx context.Context, liveID, userID uuid.UUID) error {
	live, acc, err := s.running(ctx, liveID, userID)
	if err != nil {
		return err
	}
	if acc.host || acc.cohost || acc.member.Stage != nil {
		return ErrNothingPending
	}
	requested := StageRequested
	if err := s.repo.SetStage(ctx, live.ID, userID, userID, &requested); err != nil {
		return err
	}
	s.notifyRoom(ctx, live, "live.stage", map[string]any{
		"user_id": userID, "name": s.nameOf(ctx, userID), "stage": requested,
	})
	return nil
}

// LeaveStage is someone stepping down, or withdrawing a request or an
// invitation they do not want.
func (s *Service) LeaveStage(ctx context.Context, liveID, userID uuid.UUID) error {
	live, acc, err := s.running(ctx, liveID, userID)
	if err != nil {
		return err
	}
	return s.clearStage(ctx, live, acc.member, userID)
}

func (s *Service) clearStage(ctx context.Context, live Live, m Member, by uuid.UUID) error {
	if m.Stage == nil {
		return nil
	}
	wasOn := *m.Stage == StageOn
	if err := s.repo.SetStage(ctx, live.ID, m.UserID, by, nil); err != nil {
		return err
	}
	if wasOn {
		s.setPublish(ctx, live, m.UserID, false)
	}
	s.notifyRoom(ctx, live, "live.stage", map[string]any{"user_id": m.UserID, "stage": nil})
	return nil
}

// InviteToStage calls someone up. Someone who asked is put straight on; anyone
// else is invited and has to accept, the same as a call.
func (s *Service) InviteToStage(ctx context.Context, liveID, actor, target uuid.UUID) error {
	live, acc, err := s.running(ctx, liveID, actor)
	if err != nil {
		return err
	}
	if !acc.moderator {
		return ErrForbidden
	}
	tacc, err := s.access(ctx, live, target)
	if err != nil {
		return err
	}
	if tacc.host || tacc.cohost {
		return ErrInvalid
	}
	if err := s.mayWatch(ctx, live, target, tacc); err != nil {
		return ErrInvalid
	}
	stage := StageInvited
	if tacc.member.Stage != nil && *tacc.member.Stage == StageRequested {
		stage = StageOn
	}
	if err := s.repo.SetStage(ctx, live.ID, target, actor, &stage); err != nil {
		return err
	}
	if stage == StageOn {
		s.setPublish(ctx, live, target, true)
	} else {
		s.notify(ctx, []uuid.UUID{target}, "live.stage_invite", live, map[string]any{
			"live": live, "by": s.nameOf(ctx, actor),
		})
	}
	s.notifyRoom(ctx, live, "live.stage", map[string]any{
		"user_id": target, "name": s.nameOf(ctx, target), "stage": stage,
	})
	return nil
}

// RemoveFromStage sends a guest back to the audience.
func (s *Service) RemoveFromStage(ctx context.Context, liveID, actor, target uuid.UUID) error {
	live, acc, err := s.running(ctx, liveID, actor)
	if err != nil {
		return err
	}
	if !acc.moderator {
		return ErrForbidden
	}
	m, _, err := s.repo.Member(ctx, live.ID, target)
	if err != nil {
		return err
	}
	return s.clearStage(ctx, live, m, actor)
}

// SetModerator appoints or removes a moderator. Only a host may: a moderator
// making moderators would let one bad appointment multiply.
func (s *Service) SetModerator(ctx context.Context, liveID, actor, target uuid.UUID, on bool) error {
	live, acc, err := s.running(ctx, liveID, actor)
	if err != nil {
		return err
	}
	if !acc.host && !acc.cohost {
		return ErrForbidden
	}
	if target == live.HostID {
		return ErrInvalid
	}
	tacc, err := s.access(ctx, live, target)
	if err != nil {
		return err
	}
	if tacc.cohost {
		return ErrInvalid
	}
	if err := s.repo.SetModerator(ctx, live.ID, target, actor, on); err != nil {
		return err
	}
	s.notifyRoom(ctx, live, "live.member", map[string]any{"user_id": target, "moderator": on})
	return nil
}

// Invite adds people to the audience and tells them. In a 'selected' live this
// is how anyone new gets in; elsewhere it is a nudge.
func (s *Service) Invite(ctx context.Context, liveID, actor uuid.UUID, targets []uuid.UUID) error {
	live, acc, err := s.running(ctx, liveID, actor)
	if err != nil {
		return err
	}
	if !acc.moderator {
		return ErrForbidden
	}
	if len(targets) == 0 || len(targets) > 50 {
		return ErrInvalid
	}
	invited := make([]uuid.UUID, 0, len(targets))
	for _, t := range targets {
		if t == actor {
			continue
		}
		if banned, _ := s.repo.IsBanned(ctx, live.ID, t); banned {
			continue
		}
		if err := s.repo.Allow(ctx, live.ID, t, actor); err != nil {
			return err
		}
		invited = append(invited, t)
	}
	s.notify(ctx, invited, "live.invite", live, map[string]any{"live": live, "by": s.nameOf(ctx, actor)})
	return nil
}

// Ban removes someone from the live and keeps them out of it. A host cannot
// be banned, and only a host may ban a moderator.
func (s *Service) Ban(ctx context.Context, liveID, actor, target uuid.UUID) error {
	live, acc, err := s.running(ctx, liveID, actor)
	if err != nil {
		return err
	}
	if !acc.moderator || actor == target {
		return ErrForbidden
	}
	tacc, err := s.access(ctx, live, target)
	if err != nil {
		return err
	}
	if tacc.host || tacc.cohost {
		return ErrForbidden
	}
	if tacc.moderator && !acc.host && !acc.cohost {
		return ErrForbidden
	}
	if err := s.repo.Ban(ctx, live.ID, target, actor); err != nil {
		return err
	}
	if s.room != nil {
		_ = s.room.Remove(ctx, live.ID.String(), target.String())
	}
	s.notify(ctx, []uuid.UUID{target}, "live.banned", live, map[string]any{"live_id": live.ID})
	s.notifyRoom(ctx, live, "live.member", map[string]any{"user_id": target, "banned": true})
	if n, err := s.repo.ViewerCount(ctx, live.ID); err == nil {
		s.announceViewers(ctx, live, n)
	}
	return nil
}

func (s *Service) Unban(ctx context.Context, liveID, actor, target uuid.UUID) error {
	live, acc, err := s.running(ctx, liveID, actor)
	if err != nil {
		return err
	}
	if !acc.moderator {
		return ErrForbidden
	}
	return s.repo.Unban(ctx, live.ID, target)
}

func (s *Service) Bans(ctx context.Context, liveID, actor uuid.UUID) ([]Banned, error) {
	live, acc, err := s.running(ctx, liveID, actor)
	if err != nil {
		return nil, err
	}
	if !acc.moderator {
		return nil, ErrForbidden
	}
	return s.repo.Bans(ctx, live.ID)
}

// Audience lists who is watching, for the moderators.
func (s *Service) Audience(ctx context.Context, liveID, actor uuid.UUID) ([]Viewer, error) {
	live, acc, err := s.running(ctx, liveID, actor)
	if err != nil {
		return nil, err
	}
	if !acc.moderator {
		return nil, ErrForbidden
	}
	return s.repo.Audience(ctx, live.ID)
}

// Comment posts a line to the live's chat and pushes it to everyone in it.
func (s *Service) Comment(ctx context.Context, liveID, userID uuid.UUID, body string) (Comment, error) {
	live, acc, err := s.running(ctx, liveID, userID)
	if err != nil {
		return Comment{}, err
	}
	if !live.CommentsEnabled && !acc.moderator {
		return Comment{}, ErrCommentsOff
	}
	body = strings.TrimSpace(body)
	if body == "" || utf8.RuneCountInString(body) > MaxComment {
		return Comment{}, ErrInvalid
	}
	c, err := s.repo.AddComment(ctx, live.ID, userID, body)
	if err != nil {
		return Comment{}, err
	}
	s.notifyRoom(ctx, live, "live.comment", map[string]any{"comment": c})
	return c, nil
}

func (s *Service) Comments(ctx context.Context, liveID, userID uuid.UUID) ([]Comment, error) {
	live, _, err := s.running(ctx, liveID, userID)
	if err != nil {
		return nil, err
	}
	return s.repo.Comments(ctx, live.ID, 50)
}

// DeleteComment takes a comment down: the author's own, or anyone's for a
// moderator.
func (s *Service) DeleteComment(ctx context.Context, liveID, actor uuid.UUID, id int64) error {
	live, acc, err := s.running(ctx, liveID, actor)
	if err != nil {
		return err
	}
	author, err := s.repo.CommentAuthor(ctx, live.ID, id)
	if err != nil {
		return ErrInvalid
	}
	if author != actor && !acc.moderator {
		return ErrForbidden
	}
	if err := s.repo.DeleteComment(ctx, live.ID, id, actor); err != nil {
		return err
	}
	s.notifyRoom(ctx, live, "live.comment_deleted", map[string]any{"id": id})
	return nil
}

// Hearts adds to the count. The animation travels the SFU's data channel; this
// is only the number, sent in batches, so a capped n per call is plenty.
func (s *Service) Hearts(ctx context.Context, liveID, userID uuid.UUID, n int) error {
	live, _, err := s.running(ctx, liveID, userID)
	if err != nil {
		return err
	}
	if n < 1 || n > 50 {
		return ErrInvalid
	}
	return s.repo.AddHearts(ctx, live.ID, n)
}

// SetComments turns the chat on or off. Moderators can still write, so they
// can say why.
func (s *Service) SetComments(ctx context.Context, liveID, actor uuid.UUID, on bool) error {
	live, acc, err := s.running(ctx, liveID, actor)
	if err != nil {
		return err
	}
	if !acc.moderator {
		return ErrForbidden
	}
	if err := s.repo.SetCommentsEnabled(ctx, live.ID, on); err != nil {
		return err
	}
	s.notifyRoom(ctx, live, "live.settings", map[string]any{"comments_enabled": on})
	return nil
}

// Stats are for the hosts and moderators, during the live and after it ends,
// which is when the host looks at them most.
func (s *Service) Stats(ctx context.Context, liveID, actor uuid.UUID) (Stats, error) {
	live, err := s.repo.Get(ctx, liveID)
	if err != nil {
		return Stats{}, ErrNoLive
	}
	acc, err := s.access(ctx, live, actor)
	if err != nil {
		return Stats{}, err
	}
	if !acc.moderator {
		return Stats{}, ErrForbidden
	}
	return s.repo.Stats(ctx, live.ID)
}
