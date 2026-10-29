import { api } from './client';

export type MemberRole = 'admin' | 'moderator' | 'member';
export type HistoryMode = 'full' | 'view-only';
export type PermissionLevel = MemberRole;

export interface GroupPermissionsDTO {
  text: PermissionLevel;
  stickers: PermissionLevel;
  audio: PermissionLevel;
  media: PermissionLevel;
  posting: PermissionLevel;
  posting_until?: string;
}

export interface GroupMemberDTO {
  user_id: string;
  username?: string;
  display_name: string;
  avatar_uri?: string;
  role: MemberRole;
  joined_at: string;
}

export interface GroupDTO {
  id: string;
  title: string;
  description?: string;
  avatar_url?: string;
  created_by: string;
  created_at: string;
  history_enabled: boolean;
  history_mode: HistoryMode;
  history_limit: number;
  member_count: number;
  members?: GroupMemberDTO[];
  permissions: GroupPermissionsDTO;
}

export function listGroups() {
  return api.get<GroupDTO[]>('/api/groups');
}

export function getGroup(id: string) {
  return api.get<GroupDTO>(`/api/groups/${id}`);
}

export function createGroup(input: {
  title: string;
  description?: string;
  avatar_url?: string;
  member_ids?: string[];
}) {
  return api.post<GroupDTO>('/api/groups', input);
}

export function patchGroup(
  id: string,
  patch: {
    title?: string;
    description?: string;
    avatar_url?: string;
    history_enabled?: boolean;
    history_mode?: HistoryMode;
    history_limit?: number;
    permissions?: GroupPermissionsDTO;
  },
) {
  return api.patch<GroupDTO>(`/api/groups/${id}`, patch);
}

/**
 * Add people to a group.
 *
 * `shareHistory` decides whether they may read what was said before they
 * arrived. Omitted means share — the behaviour that existed before the choice
 * did, so an older client does not start hiding history silently.
 */
export function addGroupMembers(id: string, userIds: string[], shareHistory?: boolean) {
  return api.post<GroupDTO>(`/api/groups/${id}/members`, {
    user_ids: userIds,
    ...(shareHistory === undefined ? {} : { share_history: shareHistory }),
  });
}

export function removeGroupMember(id: string, userId: string) {
  return api.del<GroupDTO>(`/api/groups/${id}/members/${userId}`);
}

export function setGroupMemberRole(id: string, userId: string, role: MemberRole) {
  return api.patch<GroupDTO>(`/api/groups/${id}/members/${userId}`, { role });
}

export function bulkGroupMembers(
  id: string,
  userIds: string[],
  action: 'remove' | 'role',
  role?: MemberRole,
) {
  return api.post<GroupDTO>(`/api/groups/${id}/members/bulk`, {
    user_ids: userIds,
    action,
    ...(role ? { role } : {}),
  });
}

export type AchievementAwardDTO = {
  achievement_id: string;
  user_id: string;
  awarded_by: string;
  evidence_message_id: number;
  awarded_at: string;
};

export type AchievementDTO = {
  id: string;
  group_id: string;
  created_by: string;
  icon: string;
  name: string;
  criteria: Record<string, unknown>;
  created_at: string;
  awards: AchievementAwardDTO[];
};

export function listGroupAchievements(id: string) {
  return api.get<AchievementDTO[]>(`/api/groups/${id}/achievements`);
}

export function createGroupAchievement(
  id: string,
  input: { icon: string; name: string; criteria: Record<string, unknown> },
) {
  return api.post<AchievementDTO>(`/api/groups/${id}/achievements`, input);
}

export function awardGroupAchievement(
  id: string,
  achievementId: string,
  userId: string,
  evidenceMessageId: number,
) {
  return api.post<void>(`/api/groups/${id}/achievements/${achievementId}/awards`, {
    user_id: userId,
    evidence_message_id: evidenceMessageId,
  });
}

export function leaveGroup(id: string) {
  return api.post<void>(`/api/groups/${id}/leave`);
}

/**
 * A sender key sealed for one member.
 *
 * `user_id` is the recipient when publishing and the sender when fetching —
 * whichever end the caller is not.
 */
export type SenderKeyEntry = {
  user_id: string;
  ciphertext: string;
  epoch: number;
};

export function publishSenderKeys(
  id: string,
  epoch: number,
  entries: { user_id: string; ciphertext: string }[],
) {
  return api.post<void>(`/api/groups/${id}/sender-keys`, { epoch, entries });
}

export function fetchSenderKeys(id: string) {
  return api.get<{ epoch: number; keys: SenderKeyEntry[] }>(`/api/groups/${id}/sender-keys`);
}
