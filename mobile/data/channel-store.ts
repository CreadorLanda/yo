import { useSyncExternalStore } from 'react';

import {
  addPostComment as apiAddComment,
  createChannelApi,
  createChannelPost as apiCreatePost,
  followChannel as apiFollow,
  getChannel as apiGetChannel,
  listChannels,
  listPostComments as apiListComments,
  mapChannelDTO,
  mapPostDTO,
  patchChannel as apiPatchChannel,
  setPostReactions as apiSetReactions,
  unfollowChannel as apiUnfollow,
  type ChannelCommentDTO,
  type ChannelDTO,
  type ChannelPostDTO,
} from '@/data/api/channels';
import {
  type Channel,
  type ChannelCategory,
  type ChannelComment,
  type ChannelPost,
} from './mock';
import type { GameMessagePayload } from '@/data/game';
import { comparePostsNewestFirst } from './channel-post-order';

export { comparePostsNewestFirst } from './channel-post-order';

function isUUID(id: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id);
}

function mapCommentDTO(c: ChannelCommentDTO): ChannelComment {
  return {
    id: c.id,
    text: c.text,
    timestamp: 'now',
    anonymous: c.anonymous,
    authorName: c.anonymous ? undefined : c.author_name || undefined,
    likes: 0,
    reactions: (c.reactions ?? []).map((r) => ({ emoji: r.emoji, count: r.count })),
    myReactions: c.my_emojis ?? [],
  };
}

/**
 * Channel store — seed mocks + live API merge.
 */

export type ChannelVisibility = 'public' | 'private';
export type PostPermission = 'admins' | 'publishers' | 'everyone';
export type JoinMode = 'open' | 'request' | 'invite';
export type SlowMode = 0 | 10 | 30 | 60 | 300;
export type ChannelRole = 'owner' | 'admin' | 'publisher' | 'member' | 'none';

export type ChannelSettings = {
  visibility: ChannelVisibility;
  whoCanPost: PostPermission;
  commentsEnabled: boolean;
  commentsRequireApproval: boolean;
  allowAnonymousComments: boolean;
  reactionsEnabled: boolean;
  slowModeSec: SlowMode;
  joinMode: JoinMode;
  showMemberList: boolean;
  showHistoryToNew: boolean;
};

export type ManagedChannel = Channel & {
  isOwned?: boolean;
  role?: ChannelRole;
  settings: ChannelSettings;
  createdAt?: string;
};

export type CreateChannelInput = {
  name: string;
  handle: string;
  description: string;
  category: Exclude<ChannelCategory, 'all'>;
  visibility: ChannelVisibility;
  whoCanPost: PostPermission;
  commentsEnabled: boolean;
  allowAnonymousComments: boolean;
  reactionsEnabled: boolean;
  joinMode: JoinMode;
  /** Uploaded media paths. Empty means "use the generated art". */
  avatarUri?: string;
  coverUri?: string;
};

const DEFAULT_SETTINGS: ChannelSettings = {
  visibility: 'public',
  whoCanPost: 'admins',
  commentsEnabled: true,
  commentsRequireApproval: true,
  allowAnonymousComments: true,
  reactionsEnabled: true,
  slowModeSec: 0,
  joinMode: 'open',
  showMemberList: true,
  showHistoryToNew: true,
};

// Empty until the API answers.
//
// This used to start from the bundled CHANNELS fixture with 'ch1' already
// followed, so a brand-new account opened Discover to a handful of channels
// that do not exist and one it had never joined. Following one of them wrote
// to an id the server has never heard of.
let channels: ManagedChannel[] = [];
let followed = new Set<string>();
let apiBooted = false;
const listeners = new Set<() => void>();

function emit() {
  listeners.forEach((l) => l());
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** Load public channels from API and merge (API wins on id collision). */
export async function bootstrapChannels(): Promise<void> {
  if (apiBooted) return;
  try {
    const list = await listChannels();
    if (!list?.length) {
      apiBooted = true;
      return;
    }
    const mapped = list.map(mapChannelDTO);
    const byId = new Map(channels.map((c) => [c.id, c]));
    for (const c of mapped) {
      // Keep richer posts already loaded via refreshChannel.
      const prev = byId.get(c.id);
      if (prev?.posts?.length && !c.posts.length) {
        byId.set(c.id, { ...c, posts: prev.posts });
      } else {
        byId.set(c.id, c);
      }
    }
    channels = Array.from(byId.values());
    const nextFollow = new Set(followed);
    for (const raw of list) {
      if (raw.following) nextFollow.add(raw.id);
    }
    followed = nextFollow;
    apiBooted = true;
    emit();
  } catch {
    apiBooted = true;
  }
}

/**
 * Fetch a single channel with posts from the API and merge into the store.
 * Safe for mock seed ids (no-ops when not a UUID).
 */
export async function refreshChannel(id: string): Promise<ManagedChannel | undefined> {
  if (!isUUID(id)) return getChannel(id);
  try {
    const dto = await apiGetChannel(id);
    mergeDTO(dto);
    return getChannel(id);
  } catch {
    return getChannel(id);
  }
}

/** Merge a server-announced post without a second fetch. */
export function mergeChannelPost(channelId: string, dto: ChannelPostDTO): void {
  if (dto.channel_id !== channelId) return;
  const mapped = mapPostDTO(dto);
  channels = channels.map((c) => {
    if (c.id !== channelId) return c;
    const posts = [mapped, ...c.posts.filter((p) => p.id !== mapped.id)];
    posts.sort(comparePostsNewestFirst);
    return { ...c, posts };
  });
  emit();
}

function mergeDTO(dto: ChannelDTO) {
  const mapped = mapChannelDTO(dto);
  const idx = channels.findIndex((c) => c.id === mapped.id);
  if (idx >= 0) {
    const next = [...channels];
    next[idx] = { ...next[idx], ...mapped, posts: mapped.posts.length ? mapped.posts : next[idx].posts };
    channels = next;
  } else {
    channels = [mapped, ...channels];
  }
  if (dto.following) {
    followed = new Set(followed).add(dto.id);
  } else {
    const n = new Set(followed);
    n.delete(dto.id);
    followed = n;
  }
  emit();
}

function normalizeHandle(raw: string) {
  const cleaned = raw
    .toLowerCase()
    .replace(/^@/, '')
    .replace(/[^a-z0-9_]/g, '')
    .slice(0, 24);
  return cleaned ? `@${cleaned}` : '';
}

// ── Follows ─────────────────────────────────────────────────────────────────

export function toggleFollow(id: string) {
  const was = followed.has(id);
  const next = new Set(followed);
  if (was) next.delete(id);
  else next.add(id);
  followed = next;
  // Optimistic member count
  channels = channels.map((c) => {
    if (c.id !== id) return c;
    return { ...c, members: Math.max(0, c.members + (was ? -1 : 1)) };
  });
  emit();
  if (isUUID(id)) {
    (was ? apiUnfollow(id) : apiFollow(id))
      .then(mergeDTO)
      .catch(() => {
        /* keep optimistic */
      });
  }
}

export function useIsFollowing(id: string): boolean {
  return useSyncExternalStore(subscribe, () => followed.has(id));
}

export function useFollowedCount(): number {
  return useSyncExternalStore(subscribe, () => followed.size);
}

// ── Channels ────────────────────────────────────────────────────────────────

export function useChannels(): ManagedChannel[] {
  return useSyncExternalStore(subscribe, () => channels);
}

export function useChannel(id: string | undefined): ManagedChannel | undefined {
  return useSyncExternalStore(
    subscribe,
    () => channels.find((c) => c.id === id),
  );
}

export function getChannel(id: string): ManagedChannel | undefined {
  return channels.find((c) => c.id === id);
}

export function createChannel(input: CreateChannelInput): ManagedChannel {
  const handle = normalizeHandle(input.handle || input.name);
  const id = `ch_${Date.now().toString(36)}`;

  const channel: ManagedChannel = {
    id,
    name: input.name.trim().slice(0, 60) || 'New channel',
    handle: handle || `@channel_${id.slice(-4)}`,
    // Empty rather than invented. These used to be a dicebear avatar and a
    // random picsum photograph, so every new channel arrived wearing a stock
    // picture of a landscape it had nothing to do with — and both depended
    // on third-party services staying up to render at all.
    avatarUri: input.avatarUri ?? '',
    coverUri: input.coverUri ?? '',
    description: input.description.trim().slice(0, 500),
    category: input.category,
    members: 1,
    verified: false,
    rules: [],
    posts: [],
    isOwned: true,
    role: 'owner',
    createdAt: new Date().toISOString(),
    settings: {
      ...DEFAULT_SETTINGS,
      visibility: input.visibility,
      whoCanPost: input.whoCanPost,
      commentsEnabled: input.commentsEnabled,
      allowAnonymousComments: input.allowAnonymousComments,
      reactionsEnabled: input.reactionsEnabled,
      joinMode: input.joinMode,
    },
  };

  channels = [channel, ...channels];
  followed = new Set(followed).add(id);
  emit();

  // Fire-and-forget API create; replace local id when server responds.
  createChannelApi({
    name: channel.name,
    handle: channel.handle,
    description: channel.description,
    category: channel.category,
    visibility: input.visibility,
    who_can_post: input.whoCanPost,
    comments_enabled: input.commentsEnabled,
    allow_anon_comments: input.allowAnonymousComments,
    reactions_enabled: input.reactionsEnabled,
    join_mode: input.joinMode,
    avatar_url: input.avatarUri,
    cover_url: input.coverUri,
  })
    .then((dto) => {
      const mapped = mapChannelDTO(dto);
      channels = channels.filter((c) => c.id !== id);
      channels = [mapped, ...channels];
      followed = new Set(followed);
      followed.delete(id);
      followed.add(mapped.id);
      emit();
    })
    .catch(() => {
      /* keep local-only channel */
    });

  return channel;
}

export function updateChannel(
  id: string,
  patch: Partial<
    Pick<ManagedChannel, 'name' | 'handle' | 'description' | 'category' | 'rules' | 'avatarUri' | 'coverUri'>
  >,
): ManagedChannel | undefined {
  let updated: ManagedChannel | undefined;
  channels = channels.map((c) => {
    if (c.id !== id) return c;
    updated = {
      ...c,
      ...patch,
      handle: patch.handle !== undefined ? normalizeHandle(patch.handle) || c.handle : c.handle,
      name: patch.name !== undefined ? patch.name.trim().slice(0, 60) : c.name,
      description:
        patch.description !== undefined ? patch.description.trim().slice(0, 500) : c.description,
    };
    return updated;
  });
  emit();
  return updated;
}

export function updateChannelSettings(
  id: string,
  patch: Partial<ChannelSettings>,
): ManagedChannel | undefined {
  let updated: ManagedChannel | undefined;
  channels = channels.map((c) => {
    if (c.id !== id) return c;
    updated = { ...c, settings: { ...c.settings, ...patch } };
    return updated;
  });
  emit();
  return updated;
}

/** Persist profile + settings fields to the API (UUID channels only). */
export function persistChannelToApi(
  id: string,
  profile: Partial<Pick<ManagedChannel, 'name' | 'handle' | 'description' | 'category'>>,
  settings: Partial<ChannelSettings>,
): void {
  if (!isUUID(id)) return;
  const body: Record<string, unknown> = {};
  if (profile.name != null) body.name = profile.name;
  if (profile.handle != null) body.handle = profile.handle.replace(/^@/, '');
  if (profile.description != null) body.description = profile.description;
  if (profile.category != null) body.category = profile.category;
  if (settings.visibility != null) body.visibility = settings.visibility;
  if (settings.whoCanPost != null) body.who_can_post = settings.whoCanPost;
  if (settings.joinMode != null) body.join_mode = settings.joinMode;
  if (settings.commentsEnabled != null) body.comments_enabled = settings.commentsEnabled;
  if (settings.allowAnonymousComments != null) {
    body.allow_anon_comments = settings.allowAnonymousComments;
  }
  if (settings.reactionsEnabled != null) body.reactions_enabled = settings.reactionsEnabled;
  apiPatchChannel(id, body)
    .then(mergeDTO)
    .catch(() => {
      /* keep local */
    });
}

export function canPublish(channel: ManagedChannel | undefined): boolean {
  if (!channel) return false;
  if (channel.role === 'owner' || channel.role === 'admin') return true;
  if (channel.settings.whoCanPost === 'everyone' && followed.has(channel.id)) return true;
  if (channel.settings.whoCanPost === 'publishers' && channel.role === 'publisher') return true;
  return !!channel.isOwned;
}

export function canManage(channel: ManagedChannel | undefined): boolean {
  if (!channel) return false;
  return channel.isOwned || channel.role === 'owner' || channel.role === 'admin';
}

export type AddPostInput = {
  text: string;
  type?: ChannelPost['type'];
  mediaUri?: string;
  gameKind?: ChannelPost['gameKind'];
  gamePayload?: GameMessagePayload;
};

/** Publish an event without optimistic state; game events are append-only. */
export async function publishChannelPost(
  channelId: string,
  input: AddPostInput,
): Promise<ChannelPost> {
  if (!isUUID(channelId)) throw new Error('channel_not_persisted');
  let mediaUrl = input.mediaUri;
  if (mediaUrl?.includes('/api/media/')) {
    mediaUrl = mediaUrl.slice(mediaUrl.indexOf('/api/media/'));
  }
  const dto = await apiCreatePost(channelId, {
    text: input.text.trim(),
    post_type: input.type,
    media_url: mediaUrl,
    game_payload: input.gamePayload,
  });
  const mapped = mapPostDTO(dto);
  mergeChannelPost(channelId, dto);
  return mapped;
}

export function addChannelPost(
  channelId: string,
  textOrInput: string | AddPostInput,
): ChannelPost | undefined {
  const channel = channels.find((c) => c.id === channelId);
  if (!channel || !canPublish(channel)) return undefined;

  const input: AddPostInput =
    typeof textOrInput === 'string' ? { text: textOrInput } : textOrInput;

  const post: ChannelPost = {
    id: `p_${Date.now().toString(36)}`,
    text: input.text.trim(),
    timestamp: 'now',
    views: 1,
    reactions: [],
    comments: [],
    type: input.type ?? (input.mediaUri ? 'image' : 'text'),
    mediaUri: input.mediaUri,
    gameKind: input.gameKind,
    gamePayload: input.gamePayload,
  };

  channels = channels.map((c) =>
    c.id === channelId ? { ...c, posts: [post, ...c.posts] } : c,
  );
  emit();

  if (isUUID(channelId)) {
    // Prefer relative media path for the API when given a full URL.
    let mediaUrl = post.mediaUri;
    if (mediaUrl?.includes('/api/media/')) {
      const idx = mediaUrl.indexOf('/api/media/');
      mediaUrl = mediaUrl.slice(idx);
    }
    apiCreatePost(channelId, {
      text: post.text,
      post_type: post.type,
      media_url: mediaUrl,
      game_payload: post.gamePayload,
    })
      .then((dto) => {
        const mapped = mapPostDTO(dto);
        channels = channels.map((c) => {
          if (c.id !== channelId) return c;
          return {
            ...c,
            posts: [mapped, ...c.posts.filter((p) => p.id !== post.id)],
          };
        });
        emit();
      })
      .catch(() => {});
  }

  return post;
}

/** Optimistic reaction replacement; persists for UUID posts. */
export function setPostReactions(
  channelId: string,
  postId: string,
  emojis: readonly string[],
): void {
  let previous: string[] = [];
  channels = channels.map((c) => {
    if (c.id !== channelId) return c;
    return {
      ...c,
      posts: c.posts.map((post) => {
        if (post.id !== postId) return post;
        previous = post.myReactions ?? (post.myReaction ? [post.myReaction] : []);
        const reactions = [...(post.reactions ?? [])];
        const apply = (em: string, delta: number) => {
          const i = reactions.findIndex((r) => r.emoji === em);
          if (i < 0) {
            if (delta > 0) reactions.push({ emoji: em, count: delta });
            return;
          }
          const n = reactions[i].count + delta;
          if (n <= 0) reactions.splice(i, 1);
          else reactions[i] = { ...reactions[i], count: n };
        };
        for (const oldEmoji of previous) if (!emojis.includes(oldEmoji)) apply(oldEmoji, -1);
        for (const newEmoji of emojis) if (!previous.includes(newEmoji)) apply(newEmoji, 1);
        return {
          ...post,
          reactions,
          myReaction: emojis[0] ?? null,
          myReactions: [...emojis],
        };
      }),
    };
  });
  emit();

  if (!isUUID(postId)) return;
  apiSetReactions(postId, emojis).catch(() => {});
}

export function setPostReaction(channelId: string, postId: string, emoji: string | null): void {
  const post = getChannel(channelId)?.posts.find((item) => item.id === postId);
  const current = post?.myReactions ?? (post?.myReaction ? [post.myReaction] : []);
  const next = emoji && !current.includes(emoji) ? [...current, emoji] : current.filter((item) => item !== emoji);
  setPostReactions(channelId, postId, next.slice(0, 2));
}

/** Load comments for a post from the API and merge into the store. */
export async function loadPostComments(
  channelId: string,
  postId: string,
): Promise<ChannelComment[]> {
  if (!isUUID(postId)) {
    return getChannel(channelId)?.posts.find((p) => p.id === postId)?.comments ?? [];
  }
  try {
    const list = await apiListComments(postId);
    const mapped = (list ?? []).map(mapCommentDTO);
    channels = channels.map((c) => {
      if (c.id !== channelId) return c;
      return {
        ...c,
        posts: c.posts.map((p) => (p.id === postId ? { ...p, comments: mapped } : p)),
      };
    });
    emit();
    return mapped;
  } catch {
    return getChannel(channelId)?.posts.find((p) => p.id === postId)?.comments ?? [];
  }
}

/** Optimistic comment; persists for UUID posts. */
export function addCommentToPost(
  channelId: string,
  postId: string,
  text: string,
  anonymous: boolean,
  authorName?: string,
): ChannelComment | undefined {
  const comment: ChannelComment = {
    id: `c_${Date.now().toString(36)}`,
    text: text.trim(),
    timestamp: 'now',
    anonymous,
    authorName: anonymous ? undefined : authorName,
    pending: true,
    likes: 0,
  };
  if (!comment.text) return undefined;

  channels = channels.map((c) => {
    if (c.id !== channelId) return c;
    return {
      ...c,
      posts: c.posts.map((p) =>
        p.id === postId ? { ...p, comments: [...(p.comments ?? []), comment] } : p,
      ),
    };
  });
  emit();

  if (isUUID(postId)) {
    apiAddComment(postId, comment.text, anonymous)
      .then((dto) => {
        const mapped = mapCommentDTO(dto);
        channels = channels.map((c) => {
          if (c.id !== channelId) return c;
          return {
            ...c,
            posts: c.posts.map((p) => {
              if (p.id !== postId) return p;
              return {
                ...p,
                comments: (p.comments ?? []).map((x) => (x.id === comment.id ? mapped : x)),
              };
            }),
          };
        });
        emit();
      })
      .catch(() => {});
  }

  return comment;
}

export function isHandleAvailable(handle: string, exceptId?: string): boolean {
  const h = normalizeHandle(handle);
  if (!h || h.length < 3) return false;
  return !channels.some((c) => c.handle === h && c.id !== exceptId);
}

export { normalizeHandle };
