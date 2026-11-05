import { loadCachedMessages } from '@/data/db/messages';
import { collapseReactions, mapApiMessage } from '@/data/message-map';
import { linkReplies } from '@/data/reply-link';
import { claimPrefetch, rememberThread, type ReactionEntry } from '@/data/thread-cache';

/** Read the chats someone is likely to open next from disk into memory. */
export async function prefetchThreads(chatIds: string[], meId: string): Promise<void> {
  for (const chatId of chatIds) {
    if (!claimPrefetch(chatId)) continue;
    try {
      const cached = await loadCachedMessages(chatId, 50);
      const reactions: Record<string, ReactionEntry[]> = {};
      for (const m of cached) {
        if (m.reactions?.length) reactions[String(m.id)] = collapseReactions(m.reactions, meId);
      }
      rememberThread(chatId, linkReplies(cached.map((m) => mapApiMessage(m, meId))), reactions);
    } catch {
      return; // No database, as on web: the chat reads from the network instead.
    }
  }
}
