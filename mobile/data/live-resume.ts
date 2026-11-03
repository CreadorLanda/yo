import type { Live } from '@/data/api/lives';

/**
 * Whether a failed "go live" means one is already on air in that place, as
 * opposed to something actually broken. The API answers 409 `already_live`
 * and the client wraps it in an `Error` whose message carries the code.
 */
export function isAlreadyLive(err: unknown): boolean {
  return err instanceof Error && /already_live/.test(err.message);
}

/**
 * The running broadcast in the chat or channel someone tried to start one in.
 *
 * Exactly one place is given, same as `startLive`; a live belongs to exactly
 * one chat or channel, so at most one matches.
 */
export function findRunningLive(
  lives: Live[],
  place: { chatId?: string; channelId?: string },
): Live | undefined {
  return lives.find(
    (l) =>
      !l.ended_at &&
      ((place.chatId !== undefined && l.chat_id === place.chatId) ||
        (place.channelId !== undefined && l.channel_id === place.channelId)),
  );
}
