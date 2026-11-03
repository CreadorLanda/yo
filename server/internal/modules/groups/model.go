package groups

import (
	"encoding/json"
	"time"

	"github.com/google/uuid"
)

type MemberRole string

const (
	RoleAdmin     MemberRole = "admin"
	RoleModerator MemberRole = "moderator"
	RoleMember    MemberRole = "member"
)

type PermissionLevel string

const (
	PermissionMember    PermissionLevel = "member"
	PermissionModerator PermissionLevel = "moderator"
	PermissionAdmin     PermissionLevel = "admin"
)

type GroupPermissions struct {
	Text         PermissionLevel `json:"text"`
	Stickers     PermissionLevel `json:"stickers"`
	Audio        PermissionLevel `json:"audio"`
	Media        PermissionLevel `json:"media"`
	Posting      PermissionLevel `json:"posting"`
	PostingUntil *time.Time      `json:"posting_until,omitempty"`
}

type HistoryMode string

const (
	HistoryFull     HistoryMode = "full"
	HistoryViewOnly HistoryMode = "view-only"
)

type Member struct {
	UserID      uuid.UUID  `json:"user_id"`
	Username    string     `json:"username,omitempty"`
	DisplayName string     `json:"display_name"`
	AvatarURI   string     `json:"avatar_uri,omitempty"`
	Role        MemberRole `json:"role"`
	JoinedAt    time.Time  `json:"joined_at"`
}

type Group struct {
	ID             uuid.UUID   `json:"id"`
	Title          string      `json:"title"`
	Description    string      `json:"description,omitempty"`
	AvatarURL      string      `json:"avatar_url,omitempty"`
	CreatedBy      uuid.UUID   `json:"created_by"`
	CreatedAt      time.Time   `json:"created_at"`
	HistoryEnabled bool        `json:"history_enabled"`
	HistoryMode    HistoryMode `json:"history_mode"`
	// HistoryLimit is max past messages for new members; -1 = unlimited.
	HistoryLimit int              `json:"history_limit"`
	MemberCount  int              `json:"member_count"`
	Members      []Member         `json:"members,omitempty"`
	Permissions  GroupPermissions `json:"permissions"`
}

type CreateGroupRequest struct {
	Title       string      `json:"title" binding:"required"`
	Description string      `json:"description"`
	AvatarURL   string      `json:"avatar_url"`
	MemberIDs   []uuid.UUID `json:"member_ids"` // peers; creator always included as admin
}

type PatchGroupRequest struct {
	Title          *string           `json:"title"`
	Description    *string           `json:"description"`
	AvatarURL      *string           `json:"avatar_url"`
	HistoryEnabled *bool             `json:"history_enabled"`
	HistoryMode    *HistoryMode      `json:"history_mode"`
	HistoryLimit   *int              `json:"history_limit"`
	Permissions    *GroupPermissions `json:"permissions"`
}

type AddMembersRequest struct {
	UserIDs []uuid.UUID `json:"user_ids" binding:"required"`
	// ShareHistory decides whether these people may read what was said before
	// they arrived. A pointer so "not sent" is distinguishable from "false":
	// an older client that omits it keeps the previous behaviour of sharing
	// everything, rather than silently hiding history from everyone it adds.
	ShareHistory *bool `json:"share_history"`
}

type SetRoleRequest struct {
	Role MemberRole `json:"role" binding:"required"`
}

type BulkMemberRequest struct {
	UserIDs []uuid.UUID `json:"user_ids" binding:"required,min=1,max=100"`
	Action  string      `json:"action" binding:"required,oneof=remove role"`
	Role    MemberRole  `json:"role"`
}

type Achievement struct {
	ID        uuid.UUID          `json:"id"`
	GroupID   uuid.UUID          `json:"group_id"`
	CreatedBy uuid.UUID          `json:"created_by"`
	Icon      string             `json:"icon"`
	Name      string             `json:"name"`
	Criteria  json.RawMessage    `json:"criteria"`
	CreatedAt time.Time          `json:"created_at"`
	Awards    []AchievementAward `json:"awards"`
}

type AchievementAward struct {
	AchievementID     uuid.UUID `json:"achievement_id"`
	UserID            uuid.UUID `json:"user_id"`
	AwardedBy         uuid.UUID `json:"awarded_by"`
	EvidenceMessageID int64     `json:"evidence_message_id"`
	AwardedAt         time.Time `json:"awarded_at"`
}

type CreateAchievementRequest struct {
	Icon     string          `json:"icon" binding:"required,max=16"`
	Name     string          `json:"name" binding:"required,max=80"`
	Criteria json.RawMessage `json:"criteria" binding:"required"`
}

type AwardAchievementRequest struct {
	UserID            uuid.UUID `json:"user_id" binding:"required"`
	EvidenceMessageID int64     `json:"evidence_message_id" binding:"required,min=1"`
}
