import type { StoryReactionCount } from '@/data/story-reactions';

import { api } from './client';
import { mediaFileURL } from './media';

export type StoryKind = 'image' | 'video' | 'text' | 'audio' | 'poll' | 'question';
export type StoryVisibility = 'public' | 'contacts' | 'close';

export interface StoryDTO {
  id: string;
  author_id: string;
  author_name?: string;
  author_username?: string;
  author_avatar?: string;
  kind: StoryKind;
  caption: string;
  media_url?: string;
  accent: string;
  visibility: StoryVisibility;
  is_anonymous: boolean;
  duration_sec: number;
  expires_at: string;
  created_at: string;
  viewers: number;
  is_viewed: boolean;
  is_own: boolean;
  allow_comments?: boolean;
  allow_anonymous_replies?: boolean;
  /** Every emoji on the story with how many people left it, busiest first. */
  reactions?: StoryReactionCount[];
  /** What the reader themselves left, in the order they picked it. */
  my_reactions?: string[];
}

export function listStories() {
  return api.get<StoryDTO[]>('/api/stories');
}

export function getStory(id: string) {
  return api.get<StoryDTO>(`/api/stories/${id}`);
}

export function createStory(body: {
  kind: StoryKind;
  caption?: string;
  media_url?: string;
  accent?: string;
  visibility?: StoryVisibility;
  is_anonymous?: boolean;
  duration_sec?: number;
  ttl_hours?: number;
  allow_comments?: boolean;
  allow_anonymous_replies?: boolean;
}) {
  return api.post<StoryDTO>('/api/stories', body);
}

export type StoryViewer = {
  user_id: string;
  username: string;
  display_name?: string;
  avatar_uri?: string;
  viewed_at: string;
  /** The first of `emojis`. Kept by the server for older clients. */
  emoji?: string;
  /** Every emoji this viewer left, oldest first. Absent when they left none. */
  emojis?: string[];
};

/**
 * Who has seen a story. Author only — the server refuses anyone else.
 *
 * The reaction each viewer left comes back on the same row: a bare roll
 * call is not what an author opens this for.
 */
export function storyViewers(id: string) {
  return api.get<StoryViewer[]>(`/api/stories/${id}/viewers`);
}

export function viewStory(id: string) {
  return api.post<StoryDTO>(`/api/stories/${id}/view`);
}

/**
 * Set the whole set of reactions the reader leaves on a story, replacing
 * whatever they left before. An empty array takes them all back.
 *
 * Returns the story with the counts as they now stand, so the bar can settle
 * on the server's numbers rather than keeping its own guess.
 */
export function reactStory(id: string, emojis: readonly string[]) {
  return api.post<StoryDTO>(`/api/stories/${id}/react`, { reactions: emojis });
}

/**
 * The emoji the server accepts as reactions.
 *
 * The app ships its own copy in `data/story-reactions.ts` so the bar draws
 * offline and on the first frame; this is here to check that copy against the
 * server rather than to render from.
 */
export function storyReactionCatalogue() {
  return api.get<{ standard: string[]; extended: string[] }>('/api/stories/reactions');
}

export function deleteStory(id: string) {
  return api.del<void>(`/api/stories/${id}`);
}

/** Map API story → UI Story shape used by tabs/stories. */
export function mapStoryDTO(s: StoryDTO): import('@/data/mock').Story {
  // Media stories use real URLs; text/audio use accent as the visual (no stock photos).
  const cover =
    s.media_url && (s.kind === 'image' || s.kind === 'video' || s.kind === 'audio')
      ? mediaFileURL(s.media_url)
      : '';
  const leftMs = new Date(s.expires_at).getTime() - Date.now();
  const leftH = Math.max(0, Math.round(leftMs / 3600000));
  return {
    id: s.id,
    user: s.is_own ? 'You' : s.author_name || 'Someone',
    username: s.author_username ? `@${s.author_username.replace(/^@/, '')}` : '',
    avatarUri: s.author_avatar || '',
    coverUri: cover,
    kind: s.kind,
    caption: s.caption,
    postedAt: relativeTime(s.created_at),
    expiresIn: leftH > 0 ? `${leftH}h left` : 'expiring',
    durationSec: s.duration_sec || 5,
    accent: s.accent || '#4F46E5',
    // Absent means allowed: an older server that does not send these must
    // not read as "everything switched off".
    allowComments: s.allow_comments !== false,
    allowAnonymousReplies: s.allow_anonymous_replies !== false,
    viewers: s.viewers,
    // Absent on a server that predates multi-emoji reactions; empty reads
    // the same as "nobody reacted", which is what that server means.
    reactions: s.reactions ?? [],
    myReactions: s.my_reactions ?? [],
    replies: 0,
    isViewed: s.is_viewed,
    isOwn: s.is_own,
    visibility: s.visibility,
    isAnonymous: s.is_anonymous,
  };
}

function relativeTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const m = Math.floor(diff / 60000);
  if (m < 1) return 'Just now';
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h`;
  return `${Math.floor(h / 24)}d`;
}

// ── Blind channel ───────────────────────────────────────────────────────────
//
// Private replies to an anonymous story. Nothing here carries a user id, a
// username or an avatar — that is the point, and the server enforces it.

export type AnonThread = {
  id: string;
  story_id: string;
  last_message_at: string;
  created_at: string;
  author_revealed: boolean;
  sender_revealed: boolean;
  /** Which side the reader is on — never who the other party is. */
  role: 'author' | 'sender';
  /** First line, so threads can be told apart without a name. */
  preview?: string;
  unread?: number;
  /** Which story this is about. Never carries the story's author. */
  story_kind?: string;
  story_caption?: string;
  story_media_url?: string;
  story_expired: boolean;
};

export type AnonMessage = {
  id: number;
  /** Which side wrote it. Never who. */
  from_author: boolean;
  body: string;
  created_at: string;
};

/**
 * Write privately to a story's author without naming yourself.
 *
 * Succeeds even when the author has blocked you — the server drops it
 * silently, so this resolving is not proof it was delivered.
 */
export function writeAnon(storyId: string, body: string) {
  return api.post<void>(`/api/stories/${storyId}/anon`, { body });
}

/** Threads on the caller's own stories. */
export function anonInbox() {
  return api.get<AnonThread[]>('/api/anon-threads');
}

export function anonMessages(threadId: string) {
  return api.get<AnonMessage[]>(`/api/anon-threads/${threadId}/messages`);
}

export function replyAnon(threadId: string, body: string) {
  return api.post<AnonMessage>(`/api/anon-threads/${threadId}/messages`, { body });
}

/** Author only. The sender is never told. */
export function blockAnon(threadId: string) {
  return api.post<void>(`/api/anon-threads/${threadId}/block`, {});
}

/**
 * Offer to be known.
 *
 * Returns a chat id once both sides have agreed — at which point the blind
 * thread and everything in it is gone, and the conversation continues in a
 * normal chat. Nothing is carried across: those messages were written under
 * anonymity, and moving them would attribute them backwards.
 */
export function revealAnon(threadId: string) {
  return api.post<{ chat_id?: string } | void>(`/api/anon-threads/${threadId}/reveal`, {});
}

// ── Comments ────────────────────────────────────────────────────────────────

export type StoryCommentDTO = {
  id: number;
  story_id: string;
  /** Set on replies; always the top-level comment, never a reply to a reply. */
  parent_id?: number;
  body: string;
  /** Empty on anonymous comments — the server strips them, not the client. */
  author_id: string;
  author_name: string;
  author_username: string;
  author_avatar: string;
  is_anonymous: boolean;
  /** True for your own, including your own anonymous ones. */
  is_mine: boolean;
  created_at: string;
};

export function listComments(storyId: string) {
  return api.get<StoryCommentDTO[]>(`/api/stories/${storyId}/comments`);
}

export function addComment(
  storyId: string,
  body: string,
  opts: { parentId?: number; anonymous?: boolean } = {},
) {
  return api.post<StoryCommentDTO>(`/api/stories/${storyId}/comments`, {
    body,
    parent_id: opts.parentId,
    is_anonymous: opts.anonymous ?? false,
  });
}

/** Own comment, or any comment on your own story. */
export function deleteComment(commentId: number) {
  return api.del<void>(`/api/story-comments/${commentId}`);
}
