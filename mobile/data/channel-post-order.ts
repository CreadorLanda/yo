import type { ChannelPost } from './mock';

/** Stable across devices even when two events share the same DB timestamp. */
export function comparePostsNewestFirst(a: ChannelPost, b: ChannelPost): number {
  const aTime = a.createdAt ? Date.parse(a.createdAt) : Number.NaN;
  const bTime = b.createdAt ? Date.parse(b.createdAt) : Number.NaN;
  if (Number.isFinite(aTime) && Number.isFinite(bTime) && aTime !== bTime) {
    return bTime - aTime;
  }
  return b.id.localeCompare(a.id);
}
