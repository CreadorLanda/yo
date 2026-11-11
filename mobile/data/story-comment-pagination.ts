export const STORY_COMMENT_BATCH_SIZE = 5;

export function visibleCommentCount(total: number, current: number): number {
  return Math.min(Math.max(0, total), Math.max(STORY_COMMENT_BATCH_SIZE, current));
}

export function nextVisibleCommentCount(total: number, current: number): number {
  return Math.min(total, visibleCommentCount(total, current) + STORY_COMMENT_BATCH_SIZE);
}

export function visibleCommentBatch<T>(items: readonly T[], count: number): T[] {
  return items.slice(0, visibleCommentCount(items.length, count));
}
