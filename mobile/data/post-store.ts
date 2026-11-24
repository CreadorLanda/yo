import { useSyncExternalStore } from 'react';

import { t } from '@/i18n';

import { uploadMedia } from './api/media';
import {
  createPost,
  deletePost,
  listPosts,
  type PostDTO,
  type PostKind,
  type PostVisibility,
} from './api/posts';
import type { CapturedItem } from './camera-modes';
import { showToast } from './toast-store';

/**
 * The signed-in person's own posts and reels: the grid on their profile.
 *
 * Publishing works the way stories do. The composer closes at once, a tile
 * appears in the grid marked as uploading, and the upload carries on behind
 * it; a toast says how it ended. A failed one stays in the grid so it can be
 * retried rather than silently lost.
 */

export type PostSlide = {
  id: string;
  kind: 'image' | 'video';
  /** A server path, or a local file while the post is still uploading. */
  uri: string;
  width?: number;
  height?: number;
  durationMs?: number;
};

export type Post = {
  id: string;
  kind: PostKind;
  caption: string;
  visibility: PostVisibility;
  slides: PostSlide[];
  createdAt: string;
  isOwn: boolean;
  authorName: string;
  authorUsername: string;
  authorAvatar: string;
  /** Present only on a tile that has not reached the server. */
  uploadStatus?: 'uploading' | 'failed';
};

export type PostPublishInput = {
  kind: PostKind;
  caption: string;
  visibility: PostVisibility;
  items: CapturedItem[];
  authorName: string;
  authorUsername: string;
  authorAvatar: string;
};

type State = { posts: Post[]; loading: boolean; loaded: boolean; error: boolean };

let state: State = { posts: [], loading: false, loaded: false, error: false };
const failedJobs = new Map<string, PostPublishInput>();
const listeners = new Set<() => void>();

function set(next: Partial<State>) {
  state = { ...state, ...next };
  listeners.forEach((l) => l());
}

function subscribe(l: () => void) {
  listeners.add(l);
  return () => listeners.delete(l);
}

export function useMyPosts(): State {
  return useSyncExternalStore(subscribe, () => state);
}

export function mapPostDTO(dto: PostDTO): Post {
  return {
    id: dto.id,
    kind: dto.kind,
    caption: dto.caption,
    visibility: dto.visibility,
    slides: (dto.media ?? []).map((m) => ({
      id: m.id,
      kind: m.kind,
      uri: m.url,
      width: m.width,
      height: m.height,
      durationMs: m.duration_ms,
    })),
    createdAt: dto.created_at,
    isOwn: dto.is_own,
    authorName: dto.author_name ?? '',
    authorUsername: dto.author_username ?? '',
    authorAvatar: dto.author_avatar ?? '',
  };
}

/** Tiles still on their way up, or stuck, which the server knows nothing of. */
function pendingTiles(): Post[] {
  return state.posts.filter((p) => p.uploadStatus);
}

export async function refreshMyPosts(): Promise<void> {
  if (state.loading) return;
  set({ loading: true, error: false });
  try {
    const list = await listPosts({ author: 'me' });
    // Read again after the await: a publish may have started meanwhile, and
    // its tile must not be dropped by a list fetched before it existed.
    set({ posts: [...pendingTiles(), ...list.map(mapPostDTO)], loading: false, loaded: true });
  } catch {
    set({ loading: false, loaded: true, error: true });
  }
}

/** A post from the grid, or one still uploading, by id. */
export function findMyPost(id: string): Post | undefined {
  return state.posts.find((p) => p.id === id);
}

/**
 * Publish in the background. The caller closes the composer right after.
 */
export function queuePostPublish(input: PostPublishInput): string {
  const localId = `pending_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`;
  const optimistic: Post = {
    id: localId,
    kind: input.kind,
    caption: input.caption,
    visibility: input.visibility,
    slides: input.items.map((item, i) => ({
      id: `${localId}_${i}`,
      kind: item.kind === 'video' ? 'video' : 'image',
      uri: item.uri,
      width: item.width,
      height: item.height,
      durationMs: item.durationMs,
    })),
    createdAt: new Date().toISOString(),
    isOwn: true,
    authorName: input.authorName,
    authorUsername: input.authorUsername,
    authorAvatar: input.authorAvatar,
    uploadStatus: 'uploading',
  };
  set({ posts: [optimistic, ...state.posts] });
  showToast(t(input.kind === 'reel' ? 'posts.sending_reel' : 'posts.sending_post'), 'info', 0);
  void runPublish(localId, input);
  return localId;
}

export function retryPostPublish(localId: string): boolean {
  const job = failedJobs.get(localId);
  if (!job) return false;
  failedJobs.delete(localId);
  set({
    posts: state.posts.map((p) => (p.id === localId ? { ...p, uploadStatus: 'uploading' as const } : p)),
  });
  showToast(t(job.kind === 'reel' ? 'posts.sending_reel' : 'posts.sending_post'), 'info', 0);
  void runPublish(localId, job);
  return true;
}

/** Drop a tile that never reached the server. */
export function discardPendingPost(localId: string): void {
  failedJobs.delete(localId);
  set({ posts: state.posts.filter((p) => p.id !== localId) });
}

async function runPublish(localId: string, input: PostPublishInput): Promise<void> {
  try {
    // One at a time, in order. Slides are large, and a failure halfway is
    // cheaper to retry than ten uploads racing each other on a phone link.
    const mediaIds: string[] = [];
    for (const item of input.items) {
      const video = item.kind === 'video';
      const up = await uploadMedia({
        uri: item.uri,
        mimeType: item.mimeType ?? (video ? 'video/mp4' : 'image/jpeg'),
        width: item.width,
        height: item.height,
        durationMs: item.durationMs,
      });
      mediaIds.push(up.id);
    }
    const dto = await createPost({
      kind: input.kind,
      caption: input.caption,
      visibility: input.visibility,
      media_ids: mediaIds,
    });
    const mapped = mapPostDTO(dto);
    // Keep showing the local files: they are already on the device, and the
    // server copies would have to be downloaded to show the same picture.
    mapped.slides = mapped.slides.map((slide, i) => ({ ...slide, uri: input.items[i]?.uri ?? slide.uri }));
    failedJobs.delete(localId);
    set({ posts: [mapped, ...state.posts.filter((p) => p.id !== localId && p.id !== mapped.id)] });
    showToast(t(input.kind === 'reel' ? 'posts.posted_reel' : 'posts.posted_post'), 'success', 2600);
  } catch (e) {
    const detail = e && typeof e === 'object' && 'message' in e ? String((e as { message?: string }).message) : '';
    failedJobs.set(localId, input);
    set({
      posts: state.posts.map((p) => (p.id === localId ? { ...p, uploadStatus: 'failed' as const } : p)),
    });
    showToast(detail ? `${t('posts.post_failed')}: ${detail}` : t('posts.post_failed'), 'error', 4200);
  }
}

/** Delete on the server first; the tile goes only once that is confirmed. */
export async function removeMyPost(id: string): Promise<void> {
  await deletePost(id);
  set({ posts: state.posts.filter((p) => p.id !== id) });
}

/**
 * Drop everything on sign-out. Module state outlives the account that
 * fetched it, and the next person would open their profile to someone
 * else's grid.
 */
export function resetPostStore(): void {
  failedJobs.clear();
  set({ posts: [], loading: false, loaded: false, error: false });
}
