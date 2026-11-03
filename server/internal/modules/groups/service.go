package groups

import (
	"context"
	"encoding/json"
	"errors"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
)

var (
	ErrNotFound                   = errors.New("group_not_found")
	ErrNotMember                  = errors.New("not_group_member")
	ErrNotAdmin                   = errors.New("not_group_admin")
	ErrLastAdmin                  = errors.New("cannot_remove_last_admin")
	ErrInvalidTitle               = errors.New("invalid_title")
	ErrInvalidRole                = errors.New("invalid_role")
	ErrInvalidHistory             = errors.New("invalid_history_settings")
	ErrInvalidPermission          = errors.New("invalid_permission")
	ErrNoEligibleAdmin            = errors.New("no_eligible_admin")
	ErrInvalidAchievement         = errors.New("invalid_achievement")
	ErrAchievementAlreadyAwarded  = errors.New("achievement_already_awarded")
	ErrInvalidAchievementEvidence = errors.New("invalid_achievement_evidence")
)

type Service struct {
	repo *Repository
}

func NewService(repo *Repository) *Service {
	return &Service{repo: repo}
}

func (s *Service) toGroup(row groupRow, members []Member) Group {
	title := ""
	if row.Title != nil {
		title = *row.Title
	}
	desc := ""
	if row.Description != nil {
		desc = *row.Description
	}
	avatar := ""
	if row.AvatarURL != nil {
		avatar = *row.AvatarURL
	}
	return Group{
		ID:             row.ID,
		Title:          title,
		Description:    desc,
		AvatarURL:      avatar,
		CreatedBy:      row.CreatedBy,
		CreatedAt:      row.CreatedAt,
		HistoryEnabled: row.HistoryEnabled,
		HistoryMode:    HistoryMode(row.HistoryMode),
		HistoryLimit:   row.HistoryLimit,
		MemberCount:    len(members),
		Members:        members,
		Permissions: GroupPermissions{
			Text:         PermissionLevel(row.TextPermission),
			Stickers:     PermissionLevel(row.StickersPermission),
			Audio:        PermissionLevel(row.AudioPermission),
			Media:        PermissionLevel(row.MediaPermission),
			Posting:      PermissionLevel(row.PostingPermission),
			PostingUntil: row.PostingUntil,
		},
	}
}

func (s *Service) load(ctx context.Context, id uuid.UUID) (Group, error) {
	row, err := s.repo.Get(ctx, id)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return Group{}, ErrNotFound
		}
		return Group{}, err
	}
	members, err := s.repo.ListMembers(ctx, id)
	if err != nil {
		return Group{}, err
	}
	return s.toGroup(row, members), nil
}

func (s *Service) requireMember(ctx context.Context, groupID, userID uuid.UUID) error {
	ok, err := s.repo.IsParticipant(ctx, groupID, userID)
	if err != nil {
		return err
	}
	if !ok {
		return ErrNotMember
	}
	return nil
}

func (s *Service) requireAdmin(ctx context.Context, groupID, userID uuid.UUID) error {
	if err := s.requireMember(ctx, groupID, userID); err != nil {
		return err
	}
	role, err := s.repo.MemberRole(ctx, groupID, userID)
	if err != nil {
		return err
	}
	if role != RoleAdmin {
		return ErrNotAdmin
	}
	return nil
}

func (s *Service) Create(ctx context.Context, creator uuid.UUID, req CreateGroupRequest) (Group, error) {
	title := strings.TrimSpace(req.Title)
	if len(title) < 1 || len(title) > 80 {
		return Group{}, ErrInvalidTitle
	}
	id, err := s.repo.Create(ctx, creator, title, strings.TrimSpace(req.Description), req.AvatarURL, req.MemberIDs)
	if err != nil {
		return Group{}, err
	}
	return s.load(ctx, id)
}

func (s *Service) Get(ctx context.Context, groupID, userID uuid.UUID) (Group, error) {
	if err := s.requireMember(ctx, groupID, userID); err != nil {
		// Hide existence from non-members.
		if errors.Is(err, ErrNotMember) {
			return Group{}, ErrNotFound
		}
		return Group{}, err
	}
	return s.load(ctx, groupID)
}

func (s *Service) List(ctx context.Context, userID uuid.UUID) ([]Group, error) {
	rows, err := s.repo.ListForUser(ctx, userID)
	if err != nil {
		return nil, err
	}
	out := make([]Group, 0, len(rows))
	for _, row := range rows {
		members, err := s.repo.ListMembers(ctx, row.ID)
		if err != nil {
			return nil, err
		}
		out = append(out, s.toGroup(row, members))
	}
	return out, nil
}

func (s *Service) Patch(ctx context.Context, groupID, userID uuid.UUID, req PatchGroupRequest) (Group, error) {
	if err := s.requireAdmin(ctx, groupID, userID); err != nil {
		return Group{}, err
	}
	var title, desc, avatar *string
	if req.Title != nil {
		t := strings.TrimSpace(*req.Title)
		if len(t) < 1 || len(t) > 80 {
			return Group{}, ErrInvalidTitle
		}
		title = &t
	}
	if req.Description != nil {
		d := strings.TrimSpace(*req.Description)
		desc = &d
	}
	if req.AvatarURL != nil {
		avatar = req.AvatarURL
	}
	if req.HistoryMode != nil {
		if *req.HistoryMode != HistoryFull && *req.HistoryMode != HistoryViewOnly {
			return Group{}, ErrInvalidHistory
		}
	}
	if req.HistoryLimit != nil {
		// allow -1 (unlimited) or positive
		if *req.HistoryLimit < -1 || *req.HistoryLimit == 0 {
			return Group{}, ErrInvalidHistory
		}
	}
	if req.Permissions != nil && !validPermissions(*req.Permissions) {
		return Group{}, ErrInvalidPermission
	}
	if err := s.repo.Patch(ctx, groupID, userID, title, desc, avatar, req.HistoryEnabled, req.HistoryMode, req.HistoryLimit, req.Permissions); err != nil {
		return Group{}, err
	}
	return s.load(ctx, groupID)
}

func validPermissions(p GroupPermissions) bool {
	return validPermission(p.Text) && validPermission(p.Stickers) && validPermission(p.Audio) &&
		validPermission(p.Media) && validPermission(p.Posting)
}

func validPermission(p PermissionLevel) bool {
	return p == PermissionMember || p == PermissionModerator || p == PermissionAdmin
}

func roleRank(role MemberRole) int {
	switch role {
	case RoleAdmin:
		return 3
	case RoleModerator:
		return 2
	default:
		return 1
	}
}

// CanSend is the narrow policy boundary used by messages.Service. The caller
// is already known to be a participant there; this method still rechecks the
// role and group row so policy cannot be bypassed by another transport.
func (s *Service) CanSend(ctx context.Context, chatID, userID uuid.UUID, messageType string) (bool, error) {
	role, err := s.repo.MemberRole(ctx, chatID, userID)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return false, ErrNotMember
		}
		return false, err
	}
	row, err := s.repo.Get(ctx, chatID)
	if err != nil {
		return false, err
	}
	minimum := PermissionLevel(row.TextPermission)
	switch messageType {
	case "sticker":
		minimum = PermissionLevel(row.StickersPermission)
	case "audio":
		minimum = PermissionLevel(row.AudioPermission)
	case "image", "video", "document":
		minimum = PermissionLevel(row.MediaPermission)
	}
	if row.PostingUntil != nil && row.PostingUntil.After(time.Now()) && roleRank(role) < roleRank(MemberRole(row.PostingPermission)) {
		return false, nil
	}
	return roleRank(role) >= roleRank(MemberRole(minimum)), nil
}

// AddMembers adds people, and decides how far back each may read.
//
// shareHistory is the adder's choice, made once at the moment of adding. It is
// not a group setting: one of those can be flipped later, retroactively
// exposing a conversation to someone who joined under different terms.
func (s *Service) AddMembers(ctx context.Context, groupID, actor uuid.UUID, userIDs []uuid.UUID, shareHistory bool) (Group, error) {
	if err := s.requireAdmin(ctx, groupID, actor); err != nil {
		return Group{}, err
	}
	addedIDs, err := s.repo.AddMembersWithHistoryAndRotate(ctx, groupID, actor, userIDs, shareHistory)
	if err != nil {
		return Group{}, err
	}

	// Nothing happened, so nothing is announced and nothing rotates.
	//
	// The notice used to be written unconditionally: adding someone already in
	// the group, or sending an empty list, still put "members added" in the
	// thread and still retired everyone's sender key. A group notice should
	// describe something that occurred.
	if len(addedIDs) == 0 {
		return s.load(ctx, groupID)
	}
	return s.load(ctx, groupID)
}

func (s *Service) RemoveMember(ctx context.Context, groupID, actor, target uuid.UUID) (Group, error) {
	// Admin can remove others; anyone can leave themselves.
	if actor != target {
		if err := s.requireAdmin(ctx, groupID, actor); err != nil {
			return Group{}, err
		}
	} else {
		if err := s.requireMember(ctx, groupID, actor); err != nil {
			return Group{}, err
		}
	}

	_, err := s.repo.MemberRole(ctx, groupID, target)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return Group{}, ErrNotMember
		}
		return Group{}, err
	}
	_, err = s.repo.ApplyMemberChanges(ctx, groupID, actor, []uuid.UUID{target}, "remove", "")
	if err != nil {
		if errors.Is(err, ErrNoEligibleAdmin) || errors.Is(err, ErrLastAdmin) {
			return Group{}, err
		}
		if errors.Is(err, pgx.ErrNoRows) {
			return Group{}, ErrNotMember
		}
		return Group{}, err
	}
	// If actor left, they can no longer load the group — return empty-ish ok via Get error.
	if actor == target {
		return Group{ID: groupID}, nil
	}
	return s.load(ctx, groupID)
}

func (s *Service) SetRole(ctx context.Context, groupID, actor, target uuid.UUID, role MemberRole) (Group, error) {
	if err := s.requireAdmin(ctx, groupID, actor); err != nil {
		return Group{}, err
	}
	if role != RoleAdmin && role != RoleModerator && role != RoleMember {
		return Group{}, ErrInvalidRole
	}
	if _, err := s.repo.MemberRole(ctx, groupID, target); err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return Group{}, ErrNotMember
		}
		return Group{}, err
	}
	if err := func() error {
		_, err := s.repo.ApplyMemberChanges(ctx, groupID, actor, []uuid.UUID{target}, "role", role)
		return err
	}(); err != nil {
		return Group{}, err
	}
	return s.load(ctx, groupID)
}

func (s *Service) BulkMemberChanges(ctx context.Context, groupID, actor uuid.UUID, req BulkMemberRequest) (Group, error) {
	if err := s.requireAdmin(ctx, groupID, actor); err != nil {
		return Group{}, err
	}
	if len(req.UserIDs) == 0 || len(req.UserIDs) > 100 {
		return Group{}, ErrInvalidRole
	}
	if req.Action != "remove" && req.Action != "role" {
		return Group{}, ErrInvalidRole
	}
	if req.Action == "role" && req.Role != RoleAdmin && req.Role != RoleModerator && req.Role != RoleMember {
		return Group{}, ErrInvalidRole
	}
	if containsUUID(req.UserIDs, actor) {
		return Group{}, ErrInvalidRole
	}
	if _, err := s.repo.ApplyMemberChanges(ctx, groupID, actor, req.UserIDs, req.Action, req.Role); err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return Group{}, ErrNotMember
		}
		return Group{}, err
	}
	return s.load(ctx, groupID)
}

func (s *Service) CreateAchievement(ctx context.Context, groupID, actor uuid.UUID, req CreateAchievementRequest) (Achievement, error) {
	if err := s.requireAdmin(ctx, groupID, actor); err != nil {
		return Achievement{}, err
	}
	icon := strings.TrimSpace(req.Icon)
	name := strings.TrimSpace(req.Name)
	var criteria map[string]any
	if len(icon) == 0 || len(name) == 0 || len(req.Criteria) == 0 || json.Unmarshal(req.Criteria, &criteria) != nil || len(criteria) == 0 {
		return Achievement{}, ErrInvalidAchievement
	}
	id, err := s.repo.CreateAchievement(ctx, groupID, actor, icon, name, req.Criteria)
	if err != nil {
		return Achievement{}, err
	}
	list, err := s.repo.ListAchievements(ctx, groupID)
	if err != nil {
		return Achievement{}, err
	}
	for _, a := range list {
		if a.ID == id {
			return a, nil
		}
	}
	return Achievement{}, ErrInvalidAchievement
}

func (s *Service) ListAchievements(ctx context.Context, groupID, actor uuid.UUID) ([]Achievement, error) {
	if err := s.requireMember(ctx, groupID, actor); err != nil {
		return nil, err
	}
	return s.repo.ListAchievements(ctx, groupID)
}

func (s *Service) AwardAchievement(ctx context.Context, groupID, actor, achievementID uuid.UUID, req AwardAchievementRequest) error {
	if err := s.requireAdmin(ctx, groupID, actor); err != nil {
		return err
	}
	return s.repo.AwardAchievement(ctx, groupID, actor, achievementID, req.UserID, req.EvidenceMessageID)
}
