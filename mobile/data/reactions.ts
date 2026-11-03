import { EMOJI_CATALOGUE, type EmojiOption } from './emoji-catalogue';

export const MAX_REACTIONS_PER_ITEM = 2;

export function searchEmojiCatalogue(query: string): readonly EmojiOption[] {
  const q = query.trim().toLocaleLowerCase();
  if (!q) return EMOJI_CATALOGUE;
  return EMOJI_CATALOGUE.filter((item) =>
    `${item.emoji} ${item.name} ${item.group} ${item.subgroup}`.toLocaleLowerCase().includes(q),
  );
}

export function toggleReactionSet(current: readonly string[], emoji: string): string[] | null {
  if (current.includes(emoji)) return current.filter((item) => item !== emoji);
  if (current.length >= MAX_REACTIONS_PER_ITEM) return null;
  return [...current, emoji];
}
