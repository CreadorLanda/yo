import { AppState } from 'react-native';

import { sendMessage as apiSendMessage, type MessageDTO } from '@/data/api/messages';
import { getGroup } from '@/data/api/groups';
import { getCachedChat } from '@/data/chat-store';
import {
  E2EEUnavailable,
  encryptForGroup,
  encryptForPeerOrFail,
  ensureKeysPublished,
  groupEpoch,
} from '@/data/crypto';
import {
  insertPendingMessage,
  listChatsWithPendingSends,
  listPendingSends,
  markSendGivenUp,
  markSendSucceeded,
  recordSendAttemptFailed,
  resetFailedSend,
  type PendingSend,
} from '@/data/db/messages';
import { hasExhaustedRetries } from '@/data/outbox-policy';

export { hasExhaustedRetries, MAX_SEND_ATTEMPTS } from '@/data/outbox-policy';

/**
 * The offline outbox for chat messages.
 *
 * The chat screen used to hold a queued send only in React state: write a
 * message with no connection, close the app, and it was gone — never
 * failed, never pending, just never written anywhere durable. Every send now
 * goes through `queueTextMessage`, which persists first and lets the network
 * happen after, on this module's own schedule rather than the component's —
 * a queued message has to keep trying after the screen that sent it unmounts.
 *
 * Encryption happens here, at the moment of actual send, not at queue time:
 * sealing early would spend a Double Ratchet step on a message that might
 * never go out, and a retry would then have to spend another one just to
 * try again.
 */

/** Delay before the next automatic retry after a failed attempt. */
const RETRY_DELAY_MS = 4000;

/** What a subscriber needs to reconcile one optimistic bubble — the id it
 * was rendered under, and either the confirmed message or the new status. */
export type OutboxEvent =
  | { messageId: string; outcome: 'sent'; dto: MessageDTO }
  | { messageId: string; outcome: 'retry' | 'gave_up' };

const draining = new Set<string>();
const retryTimers = new Map<string, ReturnType<typeof setTimeout>>();
const listeners = new Map<string, Set<(event: OutboxEvent) => void>>();

/** Notify a chat's subscribers that its queue changed — a send landed, or
 * failed, or gave up. */
function emit(chatId: string, event: OutboxEvent) {
  listeners.get(chatId)?.forEach((l) => l(event));
}

/**
 * Subscribe to a chat's outbox. Fires after every send attempt for that
 * chat resolves, so the screen can reconcile its optimistic bubble without
 * polling or re-reading the whole cache.
 */
export function subscribeOutbox(
  chatId: string,
  listener: (event: OutboxEvent) => void,
): () => void {
  let set = listeners.get(chatId);
  if (!set) {
    set = new Set();
    listeners.set(chatId, set);
  }
  set.add(listener);
  return () => {
    set!.delete(listener);
    if (set!.size === 0) listeners.delete(chatId);
  };
}

/**
 * Queue a text message for sending. Returns immediately — the optimistic
 * bubble the caller already rendered is the only feedback until the outbox
 * reports back through `subscribeOutbox`.
 */
export function queueTextMessage(input: {
  id: string;
  chatId: string;
  senderId: string;
  text: string;
  replyToId?: number;
}): void {
  void insertPendingMessage({
    id: input.id,
    chatId: input.chatId,
    senderId: input.senderId,
    text: input.text,
    replyToId: input.replyToId != null ? String(input.replyToId) : null,
    createdAt: new Date().toISOString(),
  }).then(() => {
    void drainOutbox(input.chatId);
  });
}

/** Resolve a chat's identity from the in-memory chat list — no fetch, so a
 * cold drain while offline fails fast instead of stalling on a request that
 * cannot succeed anyway. */
async function encryptForChat(chatId: string, text: string): Promise<string> {
  const chat = getCachedChat(chatId);
  if (!chat) throw new E2EEUnavailable('peer_unknown');

  await ensureKeysPublished();

  if (chat.type === 'group') {
    const members = ((await getGroup(chatId)).members ?? []).map((m) => ({
      user_id: m.user_id,
      username: m.username,
    }));
    if (members.length === 0) throw new E2EEUnavailable('peer_unknown');
    const payload = await encryptForGroup(chatId, text, members, await groupEpoch(chatId));
    return payload;
  }

  if (!chat.peer_user_id) throw new E2EEUnavailable('peer_unknown');
  const payload = await encryptForPeerOrFail(chat.peer_user_id, text, {
    peerUsername: chat.peer_username,
  });
  return payload;
}

function scheduleRetry(chatId: string) {
  if (retryTimers.has(chatId)) return;
  const timer = setTimeout(() => {
    retryTimers.delete(chatId);
    void drainOutbox(chatId);
  }, RETRY_DELAY_MS);
  retryTimers.set(chatId, timer);
}

async function attemptSend(next: PendingSend): Promise<OutboxEvent> {
  let payload: string;
  try {
    payload = await encryptForChat(next.chatId, next.text);
  } catch (err) {
    return recordFailure(next, err);
  }
  try {
    const replyTo = next.replyToId != null ? Number(next.replyToId) : undefined;
    const dto = await apiSendMessage(next.chatId, payload, 'text', replyTo);
    await markSendSucceeded(next.id, dto);
    return { messageId: next.id, outcome: 'sent', dto };
  } catch (err) {
    return recordFailure(next, err);
  }
}

async function recordFailure(next: PendingSend, err: unknown): Promise<OutboxEvent> {
  const attempts = await recordSendAttemptFailed(next.id, String(err));
  if (hasExhaustedRetries(attempts)) {
    await markSendGivenUp(next.id);
    return { messageId: next.id, outcome: 'gave_up' };
  }
  return { messageId: next.id, outcome: 'retry' };
}

/**
 * Drain one chat's queue, oldest message first. Ordering is the point: two
 * messages sent offline have to arrive in the order they were written, so
 * the next one never starts until the current one either lands or gives up.
 *
 * A concurrent call for the same chat is a no-op — the loop it would join
 * is already running.
 */
export async function drainOutbox(chatId: string): Promise<void> {
  if (draining.has(chatId)) return;
  draining.add(chatId);
  try {
    for (;;) {
      const [next] = await listPendingSends(chatId);
      if (!next) break;
      if (next.status === 'failed') break; // waiting on a manual retry

      const event = await attemptSend(next);
      emit(chatId, event);
      if (event.outcome === 'sent') continue;
      if (event.outcome === 'retry') scheduleRetry(chatId);
      break;
    }
  } finally {
    draining.delete(chatId);
  }
}

/** Re-arm a message that gave up and re-enter the automatic queue. */
export function retrySend(chatId: string, messageId: string): void {
  void resetFailedSend(messageId).then(() => {
    void drainOutbox(chatId);
  });
}

let bootstrapped = false;

/**
 * Resume every chat that still has queued sends, and again whenever the app
 * comes back to the foreground. Call once per session, after login — a
 * queued message is exactly the "closed the app" case this exists for, so
 * app launch has to be a trigger, not just reopening the one chat.
 */
export function ensureOutboxRunning(): void {
  if (bootstrapped) return;
  bootstrapped = true;

  const drainAll = () => {
    void listChatsWithPendingSends().then((ids) => {
      for (const id of ids) void drainOutbox(id);
    });
  };

  drainAll();
  AppState.addEventListener('change', (state) => {
    if (state === 'active') drainAll();
  });
}
