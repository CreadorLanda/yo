import { bootstrapAuth } from '@/data/auth-store';
import { queueTextMessage } from '@/data/outbox';

/**
 * Send a reply typed into a notification, without opening the app.
 *
 * This used to encrypt and POST directly, and a failure was a `console.warn`.
 * That is the wrong shape for where it runs. The reply arrives with the app
 * backgrounded or freshly launched by the OS, which is precisely when the
 * things a direct send needs are least likely to be there: no chat list
 * cached, no keys fetched, possibly no network. When any of that was missing
 * the message was gone — not failed, not pending, gone. The person had
 * watched themselves type it.
 *
 * So it goes through the outbox instead, which was built for exactly this in
 * #113: persisted before anything is attempted, retried in order, given up on
 * only after five tries, and visible in the thread as pending the whole time.
 * A reply that cannot be sent right now is a reply that sends later, which is
 * what somebody typing into a lock screen expects.
 *
 * The encryption is unchanged and still not optional — the outbox seals with
 * the same primitives the composer does, at the moment of actual send. A
 * reply from the lock screen must be exactly as protected as one typed in the
 * conversation, or the notification becomes a way around the encryption.
 */
export async function sendQuickReply(chatId: string, text: string): Promise<void> {
  const body = text.trim();
  if (!body) return;

  // Awaited, not read. On a cold start this runs beside the app's own
  // bootstrap, and `bootstrapAuth` hands both callers the same in-flight
  // promise rather than telling the second one there is no session.
  const user = await bootstrapAuth();
  if (!user) throw new Error('no_session');

  queueTextMessage({
    // Same shape the composer uses, so a queued reply and a queued message
    // are indistinguishable to everything downstream.
    id: `tmp_${Date.now()}`,
    chatId,
    senderId: user.id,
    text: body,
  });
}
