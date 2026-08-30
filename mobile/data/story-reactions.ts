/**
 * Story reactions — the emoji set and the arithmetic around it.
 *
 * Kept out of the viewer screen so it can be tested without rendering a
 * story: the ordering and the optimistic counts are where the bugs live, not
 * in the chips.
 */

export type StoryReactionCount = { emoji: string; count: number };

/**
 * The emoji a reaction may be, mirroring the server's closed set — anything
 * else comes back `400 invalid_emoji`.
 *
 * A copy rather than a fetch so the bar draws on the first frame and works
 * offline. `GET /api/stories/reactions` is the server's own copy; the test
 * below is what keeps this one from drifting silently.
 */
export const STANDARD_REACTIONS = [
  '❤️',
  '😂',
  '😮',
  '😢',
  '😡',
  '👍',
  '👎',
  '🔥',
  '🎉',
  '😍',
  '👏',
] as const;

export const EXTENDED_REACTIONS = [
  '🙌',
  '💪',
  '🙏',
  '😇',
  '❤️‍🔥',
  '💯',
  '⭐',
  '🌟',
  '✨',
  '🆕',
  '😁',
  '😎',
  '🥳',
] as const;

export const ALL_REACTIONS: readonly string[] = [
  ...STANDARD_REACTIONS,
  ...EXTENDED_REACTIONS,
];

/**
 * Add an emoji to the reader's set, or take it back out if it is already
 * there.
 *
 * Order is the order they were picked, and a re-pick goes on the end — the
 * server stores the set, not the sequence, so this only has to be stable
 * enough that chips do not shuffle while someone is tapping.
 */
export function toggleReaction(current: readonly string[], emoji: string): string[] {
  return current.includes(emoji)
    ? current.filter((e) => e !== emoji)
    : [...current, emoji];
}

/**
 * The counts as they will read once the server has taken `next`, so the bar
 * can answer a tap now instead of a round trip later.
 *
 * Only the reader's own contribution moves: everyone else's is already in
 * `counts` and none of it is this device's to change.
 */
export function applyMyReactions(
  counts: readonly StoryReactionCount[],
  previous: readonly string[],
  next: readonly string[],
): StoryReactionCount[] {
  const totals = new Map<string, number>();
  for (const { emoji, count } of counts) totals.set(emoji, count);

  for (const emoji of previous) {
    if (!next.includes(emoji)) {
      totals.set(emoji, (totals.get(emoji) ?? 0) - 1);
    }
  }
  for (const emoji of next) {
    if (!previous.includes(emoji)) {
      totals.set(emoji, (totals.get(emoji) ?? 0) + 1);
    }
  }

  const out: StoryReactionCount[] = [];
  for (const [emoji, count] of totals) {
    // A count can reach zero but never go below it, and an emoji nobody
    // holds is not a reaction on the story any more.
    if (count > 0) out.push({ emoji, count });
  }
  return out;
}

/**
 * Which emoji the bar shows without opening the full set.
 *
 * The standard row always, plus any extended emoji that already matters
 * here — one with a count on this story, or one the reader picked. A 🥳 that
 * four people left should not be hidden behind a "more" button while the
 * standard row shows eleven zeroes.
 *
 * Catalogue order, not busiest-first: the row is a set of buttons, and
 * buttons that reorder themselves under the thumb get mis-tapped.
 */
export function reactionBarEmojis(
  counts: readonly StoryReactionCount[],
  mine: readonly string[],
): string[] {
  const promoted = new Set<string>();
  for (const { emoji, count } of counts) {
    if (count > 0) promoted.add(emoji);
  }
  for (const emoji of mine) promoted.add(emoji);

  return [
    ...STANDARD_REACTIONS,
    ...EXTENDED_REACTIONS.filter((e) => promoted.has(e)),
  ];
}

/** How many of a given emoji are on the story. Zero when none. */
export function countOf(counts: readonly StoryReactionCount[], emoji: string): number {
  return counts.find((c) => c.emoji === emoji)?.count ?? 0;
}
