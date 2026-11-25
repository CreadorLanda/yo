import { listChatBots, listChatCommands } from '@/data/api/bots';
import type { ChatCommand } from '@/data/bot-commands';
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
  if (chatId) {
    cache.delete(chatId);
    commandCache.delete(chatId);
  } else {
    cache.clear();
    commandCache.clear();
  }
}

const commandCache = new Map<string, { at: number; commands: ChatCommand[] }>();

/** The slash commands of a chat's bots (#324), cached like the bots themselves. */
export async function chatCommands(chatId: string): Promise<ChatCommand[]> {
  const hit = commandCache.get(chatId);
  if (hit && Date.now() - hit.at < TTL_MS) return hit.commands;
  try {
    const commands = (await listChatCommands(chatId)) ?? [];
    commandCache.set(chatId, { at: Date.now(), commands });
    return commands;
  } catch {
    return hit?.commands ?? [];
  }
}

/**
 * Bot members that must not receive this group's sender key. The server
 * drops such keys anyway; leaving them out here saves sealing them.
 */
export async function excludedFromGroupKey(chatId: string): Promise<Set<string>> {
  return botsWithoutFullRead(await chatBots(chatId));
}

