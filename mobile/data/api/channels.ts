import { api } from './client';
import { mediaFileURL } from './media';
import type {
  ChannelCategory,
  ChannelComment,
  ChannelPost,
  ChannelReaction,
} from '@/data/mock';
import type {
  ChannelRole,
  ChannelSettings,
  ChannelVisibility,
  JoinMode,
  ManagedChannel,
  PostPermission,
} from '@/data/channel-store';
import type { GameMessagePayload } from '@/data/game';

export interface ChannelDTO {
  id: string;
  owner_id: string;
  name: string;
  handle: string;
  description: string;
  category: string;
  avatar_url?: string;
  cover_url?: string;
  visibility: ChannelVisibility;
  who_can_post: PostPermission;
  comments_enabled: boolean;
  allow_anon_comments: boolean;
  reactions_enabled: boolean;
  join_mode: JoinMode;
  verified: boolean;
  members: number;
  following: boolean;
  role: ChannelRole | 'none';
  created_at: string;
  posts?: ChannelPostDTO[];
}

export interface ChannelPostDTO {
  id: string;
  channel_id: string;
  author_id: string;
  text: string;
  post_type: string;
  media_url?: string;
  views: number;
  created_at: string;
  my_emoji?: string;
  my_emojis?: string[];
  reactions?: { emoji: string; count: number }[];
  game_payload?: GameMessagePayload;
}

export interface ChannelCommentDTO {
  id: string;
  post_id: string;
  parent_id?: string;
  author_id?: string;
  author_name?: string;
  text: string;
  anonymous: boolean;
  created_at: string;
  my_emojis?: string[];
  reactions?: { emoji: string; count: number }[];
}

export function listChannels(category?: string) {
  const q = category && category !== 'all' ? `?category=${encodeURIComponent(category)}` : '';
  return api.get<ChannelDTO[]>(`/api/channels${q}`);
}

export function getChannel(id: string) {
  return api.get<ChannelDTO>(`/api/channels/${id}`);
}

export function createChannelApi(body: {
  name: string;
  handle: string;
  description?: string;
  category?: string;
  avatar_url?: string;
  cover_url?: string;
  visibility?: ChannelVisibility;
  who_can_post?: PostPermission;
  comments_enabled?: boolean;
  allow_anon_comments?: boolean;
  reactions_enabled?: boolean;
  join_mode?: JoinMode;
}) {
  return api.post<ChannelDTO>('/api/channels', {
    ...body,
    handle: body.handle.replace(/^@/, ''),
  });
}

export function patchChannel(id: string, patch: Record<string, unknown>) {
  return api.patch<ChannelDTO>(`/api/channels/${id}`, patch);
}

export function followChannel(id: string) {
  return api.post<ChannelDTO>(`/api/channels/${id}/follow`);
}

export function unfollowChannel(id: string) {
  return api.del<ChannelDTO>(`/api/channels/${id}/follow`);
}

export function createChannelPost(
  channelId: string,
  body: { text?: string; post_type?: string; media_url?: string; game_payload?: GameMessagePayload },
) {
  return api.post<ChannelPostDTO>(`/api/channels/${channelId}/posts`, body);
}

export function reactToPost(postId: string, emoji: string) {
  return api.post<void>(`/api/channel-posts/${postId}/react`, { emoji });
}

export function setPostReactions(postId: string, emojis: readonly string[]) {
  return api.post<void>(`/api/channel-posts/${postId}/react`, { reactions: emojis });
}

export function clearPostReaction(postId: string) {
  return api.del<void>(`/api/channel-posts/${postId}/react`);
}

export function listPostComments(postId: string) {
  return api.get<ChannelCommentDTO[]>(`/api/channel-posts/${postId}/comments`);
}

export function addPostComment(postId: string, text: string, anonymous?: boolean, parentId?: string) {
  return api.post<ChannelCommentDTO>(`/api/channel-posts/${postId}/comments`, {
    text,
    anonymous: !!anonymous,
    parent_id: parentId,
  });
}

export function setCommentReactions(commentId: string, emojis: readonly string[]) {
  return api.post<void>(`/api/channel-comments/${commentId}/react`, { reactions: emojis });
}

export function clearCommentReactions(commentId: string) {
  return api.del<void>(`/api/channel-comments/${commentId}/react`);
}

export function checkHandleAvailable(handle: string) {
  return api.get<{ available: boolean }>(
    `/api/channels/handle-available?handle=${encodeURIComponent(handle.replace(/^@/, ''))}`,
  );
}

export function mapPostDTO(p: ChannelPostDTO): ChannelPost {
  const reactions: ChannelReaction[] = (p.reactions ?? []).map((r) => ({
    emoji: r.emoji,
    count: r.count,
  }));
  return {
    id: p.id,
    text: p.text,
    mediaUri: p.media_url ? mediaFileURL(p.media_url) : undefined,
    timestamp: relative(p.created_at),
    createdAt: p.created_at,
    views: p.views,
    reactions,
    myReaction: (p.my_emojis ?? (p.my_emoji ? [p.my_emoji] : []))[0] || null,
    myReactions: p.my_emojis ?? (p.my_emoji ? [p.my_emoji] : []),
    type: (p.post_type as ChannelPost['type']) || 'text',
    // Needed to decide who may edit or delete it. Dropping it here meant the
    // screen had no way to tell your own post from anyone else's.
    authorId: p.author_id,
    gamePayload: p.game_payload,
    comments: [],
  };
}

export function mapChannelDTO(c: ChannelDTO): ManagedChannel {
  const settings: ChannelSettings = {
    visibility: c.visibility || 'public',
    whoCanPost: c.who_can_post || 'admins',
    commentsEnabled: c.comments_enabled,
    commentsRequireApproval: false,
    allowAnonymousComments: c.allow_anon_comments,
    reactionsEnabled: c.reactions_enabled,
    slowModeSec: 0,
    joinMode: c.join_mode || 'open',
    showMemberList: true,
    showHistoryToNew: true,
  };
  const cat = (c.category || 'other') as Exclude<ChannelCategory, 'all'>;
  return {
    id: c.id,
    name: c.name,
    handle: c.handle.startsWith('@') ? c.handle : `@${c.handle}`,
    avatarUri: c.avatar_url || '',
    coverUri: c.cover_url || '',
    description: c.description || '',
    category: cat,
    members: c.members,
    verified: c.verified,
    rules: [],
    posts: (c.posts ?? []).map(mapPostDTO),
    isOwned: c.role === 'owner',
    role: c.role === 'none' ? 'none' : c.role,
    settings,
    createdAt: c.created_at,
  };
}

function relative(iso: string): string {
  const m = Math.floor((Date.now() - new Date(iso).getTime()) / 60000);
  if (m < 1) return 'now';
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h`;
  return `${Math.floor(h / 24)}d`;
}

// ── Members ─────────────────────────────────────────────────────────────────

export type ChannelMemberRole = 'owner' | 'admin' | 'publisher' | 'member';

export type ChannelMember = {
  user_id: string;
  username: string;
  display_name?: string;
  avatar_uri?: string;
  role: ChannelMemberRole;
  joined_at: string;
};

/** Everyone in a channel, most privileged first. */
export function listChannelMembers(channelId: string) {
  return api.get<ChannelMember[]>(`/api/channels/${channelId}/members`);
}

/**
 * Promote or demote someone. Owners and admins only.
 *
 * 'owner' is not accepted: transferring a channel is a separate act, not one
 * tap inside a role picker.
 */
export function setChannelMemberRole(
  channelId: string,
  userId: string,
  role: Exclude<ChannelMemberRole, 'owner'>,
) {
  return api.patch<void>(`/api/channels/${channelId}/members/${userId}`, { role });
}

export function removeChannelMember(channelId: string, userId: string) {
  return api.del<void>(`/api/channels/${channelId}/members/${userId}`);
}

// ── Post mutations ──────────────────────────────────────────────────────────

/** Author, or the channel's owner/admins. Text only. */
export function editChannelPost(postId: string, text: string) {
  return api.patch<void>(`/api/channel-posts/${postId}`, { text });
}

export function deleteChannelPost(postId: string) {
  return api.del<void>(`/api/channel-posts/${postId}`);
}

/**
 * Add someone to a channel with a role, by handle.
 *
 * By username rather than from a list — the follower list is not shown, and
 * choosing who may publish is a decision about a person you already have in
 * mind. Naming someone already in the channel changes their role.
 */
export function addChannelMember(
  channelId: string,
  username: string,
  role: Exclude<ChannelMemberRole, 'owner'>,
) {
  return api.post<ChannelMember>(`/api/channels/${channelId}/members`, { username, role });
}

// ── Role invitations ────────────────────────────────────────────────────────

export type ChannelRoleInvite = {
  id: string;
  channel_id: string;
  channel_name: string;
  channel_handle: string;
  channel_avatar?: string;
  role: 'admin' | 'publisher';
  /** Named on purpose: "someone made you an admin" is not a decision anyone
   *  can weigh. */
  invited_by_name: string;
  invited_by_username: string;
  created_at: string;
};

/** Requests waiting on the signed-in user. */
export function listChannelInvites() {
  return api.get<ChannelRoleInvite[]>('/api/channel-invites');
}

export function acceptChannelInvite(inviteId: string) {
  return api.post<{ channel_id: string }>(`/api/channel-invites/${inviteId}/accept`, {});
}

/** The channel is not told, and nothing is recorded. */
export function declineChannelInvite(inviteId: string) {
  return api.post<void>(`/api/channel-invites/${inviteId}/decline`, {});
}
