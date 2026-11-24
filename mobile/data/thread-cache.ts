import type { Message } from '@/data/mock';

/**
 * The last thread of recent chats, in memory.
 *
 * Reading the database is asynchronous, so a chat opened from disk alone
 * always draws one empty frame and then draws again. This is what lets the
 * first render already have the messages. Disk is still the record: this holds
 * nothing that is not there, and the network reconciles it the same way.
 */

export type ReactionEntry = { emoji: string; count: number; mine: boolean };

export type CachedThread = { messages: Message[]; reactions: Record<string, ReactionEntry[]> };

const MAX_THREADS = 30;
const MAX_MESSAGES = 50;

const threads = new Map<string, CachedThread>();
const prefetched = new Set<string>();

export function peekThread(chatId: string | undefined): CachedThread | undefined {
  return chatId ? threads.get(chatId) : undefined;
}

/**
 * Keep what the server knows about. A pending bubble is left out: the outbox
 * owns it, and it would come back as a duplicate once it has been sent.
 */
export function rememberThread(
  chatId: string,
  messages: Message[],
  reactions: Record<string, ReactionEntry[]>,
): void {
  const delivered = messages.filter((m) => /^\d+$/.test(m.id)).slice(-MAX_MESSAGES);
  threads.delete(chatId);
  if (delivered.length === 0) return;
  threads.set(chatId, { messages: delivered, reactions });
  if (threads.size > MAX_THREADS) {
    const oldest = threads.keys().next().value;
    if (oldest !== undefined) threads.delete(oldest);
  }
}

/** True the first time a chat is asked for, so an empty one is read only once. */
export function claimPrefetch(chatId: string): boolean {
  if (threads.has(chatId) || prefetched.has(chatId)) return false;
  prefetched.add(chatId);
  return true;
}

export function forgetThread(chatId: string): void {
  threads.delete(chatId);
  prefetched.delete(chatId);
}

export function resetThreads(): void {
  threads.clear();
  prefetched.clear();
}
