package channels

import (
	"context"
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
)

// Channel membership: who is in a channel, and what they may do.
//
// The four roles already existed in the schema and nothing exposed them, so a
// channel was in practice owner-or-nobody: there was no way to see who had
// joined, no way to promote anyone, and no way to remove someone.

var (
	ErrMemberNotFound = errors.New("member_not_found")
	ErrInvalidRole    = errors.New("invalid_role")
	ErrCannotDemote   = errors.New("cannot_change_owner")
	ErrSelfRole       = errors.New("cannot_change_own_role")
)

// Member is one participant, as anyone allowed to see the list gets them.
type Member struct {
	UserID      uuid.UUID  `json:"user_id"`
	Username    string     `json:"username"`
	DisplayName string     `json:"display_name,omitempty"`
	AvatarURI   string     `json:"avatar_uri,omitempty"`
	Role        MemberRole `json:"role"`
	JoinedAt    time.Time  `json:"joined_at"`
}

// assignable are the roles a manager may hand out. Owner is missing on
// purpose: ownership transfers are a different operation with different
// consequences, and folding it into "change role" makes it one tap away
// from giving your channel to someone else by accident.
var assignable = map[MemberRole]bool{
	RoleAdmin:     true,
	RolePublisher: true,
	RoleMember:    true,
}

// ── repository ──────────────────────────────────────────────────────────────

// ListManagers returns the people who run a channel — owner, admins and
// publishers — most privileged first, then oldest first within a role.
//
// Plain followers are deliberately absent. Who follows a channel is the most
// exposing thing this table holds: it is a membership list of an interest,
// and it belongs to the followers rather than to the channel. The people who
// run a channel are acting in public on its behalf, which is different.
func (r *Repository) ListManagers(ctx context.Context, channelID uuid.UUID) ([]Member, error) {
	rows, err := r.db.Query(ctx, `
		SELECT m.user_id, u.username, COALESCE(u.display_name, ''),
		       COALESCE(u.avatar_uri, ''), m.role, m.joined_at
		FROM channel_members m
		JOIN users u ON u.id = m.user_id
		WHERE m.channel_id = $1
		  AND m.role IN ('owner', 'admin', 'publisher')
		ORDER BY CASE m.role
		           WHEN 'owner' THEN 0
		           WHEN 'admin' THEN 1
		           WHEN 'publisher' THEN 2
		           ELSE 3
		         END,
		         m.joined_at ASC
	`, channelID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	out := []Member{}
	for rows.Next() {
		var m Member
		if err := rows.Scan(&m.UserID, &m.Username, &m.DisplayName,
			&m.AvatarURI, &m.Role, &m.JoinedAt); err != nil {
			return nil, err
		}
		out = append(out, m)
	}
	return out, rows.Err()
}

func (r *Repository) memberRole(ctx context.Context, channelID, userID uuid.UUID) (MemberRole, error) {
	var role MemberRole
	err := r.db.QueryRow(ctx,
		`SELECT role FROM channel_members WHERE channel_id = $1 AND user_id = $2`,
		channelID, userID).Scan(&role)
	return role, err
}

func (r *Repository) setMemberRole(ctx context.Context, channelID, userID uuid.UUID, role MemberRole) error {
	tag, err := r.db.Exec(ctx,
		`UPDATE channel_members SET role = $3 WHERE channel_id = $1 AND user_id = $2`,
		channelID, userID, string(role))
	if err != nil {
		return err
	}
	if tag.RowsAffected() == 0 {
		return pgx.ErrNoRows
	}
	return nil
}

func (r *Repository) removeMember(ctx context.Context, channelID, userID uuid.UUID) error {
	tag, err := r.db.Exec(ctx,
		`DELETE FROM channel_members WHERE channel_id = $1 AND user_id = $2`,
		channelID, userID)
	if err != nil {
		return err
	}
	if tag.RowsAffected() == 0 {
		return pgx.ErrNoRows
	}
	return nil
}

// ── service ─────────────────────────────────────────────────────────────────

// Members lists the people who run a channel. Owners and admins only.
//
// This was readable by anyone who could see the channel, on the reasoning
// that a follower deciding whether to trust a channel should know who runs
// it. That traded away more than it bought: the same endpoint also exposed
// every follower, which is a list of who is interested in what — and that
// belongs to them, not to the channel.
func (s *Service) Members(ctx context.Context, channelID, user uuid.UUID) ([]Member, error) {
	ch, err := s.Get(ctx, channelID, user)
	if err != nil {
		return nil, err
	}
	if !s.canManage(ch, user) {
		return nil, ErrForbidden
	}
	return s.repo.ListManagers(ctx, channelID)
}

// SetMemberRole promotes or demotes someone. Owners and admins only.
func (s *Service) SetMemberRole(ctx context.Context, channelID, actor, target uuid.UUID, role MemberRole) error {
	ch, err := s.Get(ctx, channelID, actor)
	if err != nil {
		return err
	}
	if !s.canManage(ch, actor) {
		return ErrForbidden
	}
	if !assignable[role] {
		return ErrInvalidRole
	}
	if target == actor {
		// Nobody demotes themselves by accident, and nobody promotes
		// themselves at all.
		return ErrSelfRole
	}

	current, err := s.repo.memberRole(ctx, channelID, target)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return ErrMemberNotFound
		}
		return fmt.Errorf("member role: %w", err)
	}
	if current == RoleOwner {
		// The owner is not a role anyone else can edit — otherwise an admin
		// could quietly demote the person who made the channel.
		return ErrCannotDemote
	}
	// An admin may not touch another admin: peers cannot remove each other's
	// powers, or the last one standing wins whatever argument they were
	// having. Only the owner can.
	if current == RoleAdmin && ch.OwnerID != actor {
		return ErrForbidden
	}
	return s.repo.setMemberRole(ctx, channelID, target, role)
}

// RemoveMember drops someone from a channel. Owners and admins only.
func (s *Service) RemoveMember(ctx context.Context, channelID, actor, target uuid.UUID) error {
	ch, err := s.Get(ctx, channelID, actor)
	if err != nil {
		return err
	}
	if !s.canManage(ch, actor) {
		return ErrForbidden
	}
	if target == actor {
		return ErrSelfRole
	}

	current, err := s.repo.memberRole(ctx, channelID, target)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return ErrMemberNotFound
		}
		return err
	}
	if current == RoleOwner {
		return ErrCannotDemote
	}
	if current == RoleAdmin && ch.OwnerID != actor {
		return ErrForbidden
	}
	return s.repo.removeMember(ctx, channelID, target)
}

// ── posts ───────────────────────────────────────────────────────────────────

// EditPost rewrites a post's text.
//
// The author may edit their own; owners and admins may edit any, because a
// channel's managers are the ones answerable for what it publishes.
//
// Only the text: swapping the media of a post people have already reacted to
// changes what they endorsed, which an edit should not be able to do quietly.
func (s *Service) EditPost(ctx context.Context, postID, user uuid.UUID, text string) error {
	post, err := s.repo.GetPost(ctx, postID)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return ErrNotFound
		}
		return err
	}
	if err := s.assertCanMutatePost(ctx, post, user); err != nil {
		return err
	}
	if post.PostType == PostGame || len(post.GamePayload) > 0 {
		return ErrImmutableGame
	}
	text = strings.TrimSpace(text)
	if text == "" && post.MediaURL == "" {
		// A text post edited to nothing is a delete pretending not to be.
		return ErrInvalidName
	}
	return s.repo.UpdatePostText(ctx, postID, text)
}

// DeletePost removes a post. Same permissions as editing.
func (s *Service) DeletePost(ctx context.Context, postID, user uuid.UUID) error {
	post, err := s.repo.GetPost(ctx, postID)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return ErrNotFound
		}
		return err
	}
	if err := s.assertCanMutatePost(ctx, post, user); err != nil {
		return err
	}
	if post.PostType == PostGame || len(post.GamePayload) > 0 {
		return ErrImmutableGame
	}
	return s.repo.DeletePost(ctx, postID)
}

// assertCanMutatePost is the shared rule, so edit and delete cannot drift
// into disagreeing about who is allowed.
func (s *Service) assertCanMutatePost(ctx context.Context, post Post, user uuid.UUID) error {
	if post.AuthorID == user {
		return nil
	}
	ch, err := s.Get(ctx, post.ChannelID, user)
	if err != nil {
		// Reported as missing rather than forbidden: someone who cannot see
		// the channel should not learn the post exists.
		return ErrNotFound
	}
	if !s.canManage(ch, user) {
		return ErrForbidden
	}
	return nil
}

// userIDByUsername resolves a handle to an id.
//
// Read straight from the users table rather than through the users module:
// modules here do not import each other's repositories, and a join is not a
// dependency. Handles are stored normalised, so the caller normalises first.
func (r *Repository) userIDByUsername(ctx context.Context, username string) (uuid.UUID, error) {
	var id uuid.UUID
	err := r.db.QueryRow(ctx,
		`SELECT id FROM users WHERE lower(username) = lower($1)`, username).Scan(&id)
	return id, err
}

func (r *Repository) upsertMember(ctx context.Context, channelID, userID uuid.UUID, role MemberRole) error {
	_, err := r.db.Exec(ctx, `
		INSERT INTO channel_members (channel_id, user_id, role)
		VALUES ($1, $2, $3)
		ON CONFLICT (channel_id, user_id) DO UPDATE SET role = EXCLUDED.role
	`, channelID, userID, string(role))
	return err
}

// AddMemberByUsername puts someone into a channel with a role, by handle.
//
// By username rather than by picking from a list, because the follower list
// is no longer shown — and should not be. Making someone a publisher is a
// decision about a specific person you already have in mind, not something
// you browse for.
//
// Idempotent: naming someone already in the channel changes their role
// rather than failing, which is what "add them as an admin" means when they
// happen to already be following.
func (s *Service) AddMemberByUsername(ctx context.Context, channelID, actor uuid.UUID, username string, role MemberRole) (Member, error) {
	ch, err := s.Get(ctx, channelID, actor)
	if err != nil {
		return Member{}, err
	}
	if !s.canManage(ch, actor) {
		return Member{}, ErrForbidden
	}
	if !assignable[role] {
		return Member{}, ErrInvalidRole
	}
	// Only the owner may mint admins — the mirror of the rule that stops an
	// admin demoting a peer.
	if role == RoleAdmin && ch.OwnerID != actor {
		return Member{}, ErrForbidden
	}

	targetID, err := s.repo.userIDByUsername(ctx, normalizeHandle(username))
	if err != nil {
		// Same answer whether the handle is unknown or malformed: this
		// endpoint is not a way to test which usernames exist.
		return Member{}, ErrMemberNotFound
	}
	if targetID == actor {
		return Member{}, ErrSelfRole
	}

	current, err := s.repo.memberRole(ctx, channelID, targetID)
	switch {
	case err == nil && current == RoleOwner:
		return Member{}, ErrCannotDemote
	case err == nil && current == RoleAdmin && ch.OwnerID != actor:
		return Member{}, ErrForbidden
	case err != nil && !errors.Is(err, pgx.ErrNoRows):
		return Member{}, err
	}

	// A role that carries responsibility is offered, not imposed: the person
	// gets a request they can refuse. Plain membership is applied directly —
	// that is following, and nothing about it speaks for them.
	if invitable[role] {
		if err := s.repo.upsertInvite(ctx, channelID, targetID, actor, role); err != nil {
			return Member{}, err
		}
		// Nothing to report yet; the caller shows "invitation sent".
		return Member{UserID: targetID, Role: role}, ErrInvitePending
	}

	if err := s.repo.upsertMember(ctx, channelID, targetID, role); err != nil {
		return Member{}, err
	}

	// Read the row back directly rather than looking for it in the manager
	// list: demoting someone to plain member is a legitimate use of this
	// call, and they are not on that list afterwards.
	return s.repo.memberByID(ctx, channelID, targetID)
}

func (r *Repository) memberByID(ctx context.Context, channelID, userID uuid.UUID) (Member, error) {
	var m Member
	err := r.db.QueryRow(ctx, `
		SELECT m.user_id, u.username, COALESCE(u.display_name, ''),
		       COALESCE(u.avatar_uri, ''), m.role, m.joined_at
		FROM channel_members m
		JOIN users u ON u.id = m.user_id
		WHERE m.channel_id = $1 AND m.user_id = $2
	`, channelID, userID).Scan(&m.UserID, &m.Username, &m.DisplayName,
		&m.AvatarURI, &m.Role, &m.JoinedAt)
	if errors.Is(err, pgx.ErrNoRows) {
		return Member{}, ErrMemberNotFound
	}
	return m, err
}
