import { useSyncExternalStore } from 'react';

import { mediaFileURL, uploadMedia } from '@/data/api/media';
import {
  createStory,
  getStory,
  listStories,
  mapStoryDTO,
  reactStory,
  type StoryDTO,
  type StoryKind,
  type StoryVisibility,
} from '@/data/api/stories';
import type { Story } from '@/data/mock';
import { applyMyReactions } from '@/data/story-reactions';
import { showToast } from '@/data/toast-store';
import { t } from '@/i18n';

/**
 * Stories feed — backend only. No mock seed.
 * Supports WhatsApp-style background publish with optimistic UI + toast.
 */

let feed: Story[] = [];
let booted = false;
let loading = false;
let lastError: string | null = null;
/** localId → last failed job for retry */
const failedJobs = new Map<string, StoryPublishInput>();
const listeners = new Set<() => void>();

function emit() {
  listeners.forEach((l) => l());
}

function subscribe(l: () => void) {
  listeners.add(l);
  return () => listeners.delete(l);
}

export type StoryPublishInput = {
  kind: StoryKind;
  caption: string;
  /** Local file URI for image/video/audio (uploaded in background). */
  localMediaUri?: string | null;
  mediaMimeType?: string;
  audioDurationMs?: number;
  accent?: string;
  visibility?: StoryVisibility;
  isAnonymous?: boolean;
  durationSec?: number;
  /** Hours before it expires. Server clamps to 1..72; omit for 24. */
  ttlHours?: number;
  allowComments?: boolean;
  allowAnonymousReplies?: boolean;
  /** Display fields for optimistic card. */
  authorName?: string;
  authorUsername?: string;
  authorAvatar?: string;
};

/** Load feed from API. Replaces local feed (empty when offline / no stories). */
export async function bootstrapStories(force = false): Promise<void> {
  if (loading) return;
  if (booted && !force) return;
  loading = true;
  lastError = null;
  emit();
  try {
    const list = await listStories();
    feed = (list ?? []).map(mapStoryDTO);
    booted = true;
  } catch (e) {
    lastError = e instanceof Error ? e.message : 'stories_load_failed';
    // Keep previous feed if we already had data; otherwise stay empty.
    booted = true;
  } finally {
    loading = false;
    emit();
  }
}

/** Force refresh (pull-to-refresh / after publish). */
export async function refreshStories(): Promise<void> {
  booted = false;
  await bootstrapStories(true);
}

export function useStories(): Story[] {
  return useSyncExternalStore(subscribe, () => feed);
}

export function useStoriesLoading(): boolean {
  return useSyncExternalStore(subscribe, () => loading);
}

export function useStoriesError(): string | null {
  return useSyncExternalStore(subscribe, () => lastError);
}

export function getStoriesLocal(): Story[] {
  return feed;
}

export function getStoryLocal(id: string): Story | undefined {
  return feed.find((s) => s.id === id);
}

/** Fetch one story if missing from feed (deep link / viewer). */
export async function ensureStory(id: string): Promise<Story | undefined> {
  const local = getStoryLocal(id);
  if (local) return local;
  if (!/^[0-9a-f-]{36}$/i.test(id)) return undefined;
  try {
    const dto = await getStory(id);
    const s = mapStoryDTO(dto);
    feed = [s, ...feed.filter((x) => x.id !== s.id)];
    emit();
    return s;
  } catch {
    return undefined;
  }
}

export function prependStoryFromDTO(dto: StoryDTO) {
  const s = mapStoryDTO(dto);
  // Drop matching pending placeholders for the same author.
  feed = [
    s,
    ...feed.filter(
      (x) =>
        x.id !== s.id &&
        !(x.isOwn && x.uploadStatus && x.id.startsWith('pending_')),
    ),
  ];
  emit();
}

export function markStoryViewedLocal(id: string) {
  feed = feed.map((s) => (s.id === id ? { ...s, isViewed: true } : s));
  emit();
}

function patchStoryLocal(id: string, patch: Partial<Story>) {
  feed = feed.map((s) => (s.id === id ? { ...s, ...patch } : s));
  emit();
}

/**
 * Replace your reactions on a story.
 *
 * The feed moves first so the chip answers the tap, then the server's own
 * counts land on top: somebody else may have reacted in between, and their
 * number is the true one.
 *
 * A failure puts the old set back. Leaving a chip lit that the server never
 * accepted is worse than the tap appearing not to register — the count would
 * be wrong until the next refresh, with nothing to say so.
 */
export async function setStoryReactions(id: string, emojis: string[]): Promise<void> {
  const story = getStoryLocal(id);
  if (!story) return;
  const previousMine = story.myReactions ?? [];
  const previousCounts = story.reactions ?? [];

  patchStoryLocal(id, {
    reactions: applyMyReactions(previousCounts, previousMine, emojis),
    myReactions: emojis,
  });

  // A story still uploading has no server id to react to yet.
  if (!/^[0-9a-f-]{36}$/i.test(id)) return;

  try {
    const dto = await reactStory(id, emojis);
    patchStoryLocal(id, {
      reactions: dto.reactions ?? [],
      myReactions: dto.my_reactions ?? [],
    });
  } catch {
    patchStoryLocal(id, { reactions: previousCounts, myReactions: previousMine });
    showToast(t('stories.react_failed'), 'error', 2600);
  }
}

export function removeStoryLocal(id: string) {
  feed = feed.filter((s) => s.id !== id);
  failedJobs.delete(id);
  emit();
}

export function storiesBooted() {
  return booted;
}

export function useHasUploadingStory(): boolean {
  return useSyncExternalStore(
    subscribe,
    () => feed.some((s) => s.isOwn && s.uploadStatus === 'uploading'),
  );
}

/**
 * Queue a story publish in the background (WhatsApp-style):
 * 1. Optimistic card appears immediately as "uploading"
 * 2. Upload media + POST /stories off the UI thread of the composer
 * 3. Toast reports progress / success / failure
 * Caller should navigate back right after invoking this.
 */
export function queueStoryPublish(input: StoryPublishInput): string {
  const localId = `pending_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`;
  const coverUri =
    input.localMediaUri && (input.kind === 'image' || input.kind === 'video')
      ? input.localMediaUri
      : '';

  const optimistic: Story = {
    id: localId,
    user: input.isAnonymous ? 'Anonymous' : input.authorName || 'You',
    username: input.authorUsername || '',
    avatarUri: input.authorAvatar || '',
    coverUri,
    kind: input.kind,
    caption: input.caption,
    postedAt: 'now',
    expiresIn: '24h left',
    durationSec: input.durationSec ?? 5,
    accent: input.accent || '#4F46E5',
    viewers: 0,
    replies: 0,
    isViewed: false,
    isOwn: true,
    visibility: input.visibility,
    isAnonymous: input.isAnonymous,
    allowComments: true,
    uploadStatus: 'uploading',
    audioSec: input.kind === 'audio' ? Math.round((input.audioDurationMs ?? 0) / 1000) : undefined,
  };

  feed = [optimistic, ...feed.filter((x) => x.id !== localId)];
  emit();
  showToast(t('stories.sending'), 'info', 0);

  void runPublish(localId, input);
  return localId;
}

/** Retry a failed background publish. */
export function retryStoryPublish(localId: string): boolean {
  const job = failedJobs.get(localId);
  if (!job) return false;
  failedJobs.delete(localId);
  feed = feed.map((s) =>
    s.id === localId ? { ...s, uploadStatus: 'uploading' as const } : s,
  );
  emit();
  showToast(t('stories.sending'), 'info', 0);
  void runPublish(localId, job);
  return true;
}

async function runPublish(localId: string, input: StoryPublishInput): Promise<void> {
  try {
    let mediaUrl: string | undefined;
    if (
      input.localMediaUri &&
      (input.kind === 'image' || input.kind === 'video' || input.kind === 'audio')
    ) {
      const up = await uploadMedia({
        uri: input.localMediaUri,
        name:
          input.kind === 'audio'
            ? `story-audio-${Date.now()}.m4a`
            : undefined,
        mimeType:
          input.mediaMimeType ||
          (input.kind === 'video'
            ? 'video/mp4'
            : input.kind === 'audio'
              ? 'audio/mp4'
              : 'image/jpeg'),
        durationMs: input.audioDurationMs,
      });
      mediaUrl = up.url;
    }

    const dto = await createStory({
      kind: input.kind,
      caption: input.caption,
      media_url: mediaUrl,
      accent: input.accent,
      visibility: input.visibility,
      is_anonymous: input.isAnonymous,
      duration_sec: input.durationSec,
      ttl_hours: input.ttlHours,
      allow_comments: input.allowComments,
      allow_anonymous_replies: input.allowAnonymousReplies,
    });

    const mapped = mapStoryDTO(dto);
    // Prefer local preview until remote media is ready; keep server cover when present.
    if (!mapped.coverUri && input.localMediaUri && (input.kind === 'image' || input.kind === 'video')) {
      mapped.coverUri = input.localMediaUri;
    } else if (mapped.coverUri) {
      mapped.coverUri = mediaFileURL(mapped.coverUri);
    }

    feed = [mapped, ...feed.filter((x) => x.id !== localId && x.id !== mapped.id)];
    failedJobs.delete(localId);
    emit();
    showToast(t('stories.posted'), 'success', 2600);
  } catch (e) {
    const detail =
      e && typeof e === 'object' && 'message' in e
        ? String((e as { message?: string }).message)
        : '';
    failedJobs.set(localId, input);
    feed = feed.map((s) =>
      s.id === localId ? { ...s, uploadStatus: 'failed' as const } : s,
    );
    emit();
    showToast(
      detail ? `${t('stories.post_failed')}: ${detail}` : t('stories.post_failed'),
      'error',
      4200,
    );
  }
}

/**
 * Drop everything on sign-out.
 *
 * The feed is a module-level array, so it outlived the account that fetched
 * it: signing in as someone else showed the previous user's stories, and
 * `isOwn` came back true on every one of them because the flag was computed
 * for whoever was signed in when they were fetched.
 */
export function resetStoryStore(): void {
  feed = [];
  booted = false;
  loading = false;
  lastError = null;
  failedJobs.clear();
  emit();
}
