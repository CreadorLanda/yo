import { listChatBots } from '@/data/api/bots';
import { botsWithoutFullRead, type RoutableBot } from '@/data/bot-routing';

/**
 * The bots in each chat, cached briefly. Kept apart from bot-delivery so the
 * group crypto can ask who to leave out of a sender key without importing
 * the crypto that imports it.
 */

const TTL_MS = 30_000;
const cache = new Map<string, { at: number; bots: RoutableBot[] }>();

/** The bots in a chat. A failed fetch is an empty list: no copy is sent. */
export async function chatBots(chatId: string): Promise<RoutableBot[]> {
  const hit = cache.get(chatId);
  if (hit && Date.now() - hit.at < TTL_MS) return hit.bots;
  try {
    const list = await listChatBots(chatId);
    const bots = (list ?? []).map((i) => ({ id: i.bot.id, username: i.bot.username, scopes: i.scopes }));
    cache.set(chatId, { at: Date.now(), bots });
    return bots;
  } catch {
    return hit?.bots ?? [];
  }
}

/** Forget a chat's bots, e.g. when its membership changed. */
export function invalidateChatBots(chatId?: string): void {
  if (chatId) cache.delete(chatId);
  else cache.clear();
}

/**
 * Bot members that must not receive this group's sender key. The server
 * drops such keys anyway; leaving them out here saves sealing them.
 */
export async function excludedFromGroupKey(chatId: string): Promise<Set<string>> {
  return botsWithoutFullRead(await chatBots(chatId));
}

