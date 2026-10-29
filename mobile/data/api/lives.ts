import { findRunningLive, isAlreadyLive } from '@/data/live-resume';

import { api } from './client';

/**
 * Live broadcasts.
 *
 * A live is not a call. In a call everyone publishes to everyone; in a
 * broadcast one person publishes to an audience that cannot publish back. The
 * difference is enforced in the token the SFU checks — a viewer's token
 * carries `CanPublish: false`, so an audience member cannot appear in someone
 * else's broadcast by patching the app.
 *
 * Not end-to-end encrypted, and deliberately so. A call derives its media key
 * from the session between two people; an audience of strangers has no such
 * session, and inventing a key the server hands out would be encryption in
 * name only. The streams are encrypted to the SFU and the SFU can read them.
 * The screen says so — the app promises E2EE everywhere else and a quiet
 * exception would be a lie.
 */

export type Live = {
  id: string;
  /** Exactly one of these — where it lives and who its audience is. */
  channel_id?: string;
  chat_id?: string;
  host_id: string;
  host_name: string;
  title: string;
  started_at: string;
  ended_at?: string;
  /** Watching right now, host excluded. Counted from rows, not guessed. */
  viewers: number;
  /** The most it ever had. What is left once the live count goes to zero. */
  peak_viewers: number;
};

export type LiveGrant = {
  live: Live;
  url: string;
  room: string;
  token: string;
  identity: string;
  /** Which side of the glass. The SFU enforces it; this picks the screen. */
  host: boolean;
};

/** Start broadcasting. Exactly one of channelId / chatId. */
export function startLive(input: {
  channelId?: string;
  chatId?: string;
  title?: string;
}) {
  return api.post<LiveGrant>('/api/lives', {
    channel_id: input.channelId,
    chat_id: input.chatId,
    title: input.title ?? '',
  });
}

/** Join as audience. The host rejoining their own gets broadcaster rights. */
export function joinLive(liveId: string) {
  return api.post<LiveGrant>(`/api/lives/${liveId}/join`, {});
}

/**
 * Stop watching.
 *
 * Sent on the way out and never awaited. Without it the viewer count only
 * grows — the same fault that left every call running for four hours.
 */
export function leaveLive(liveId: string) {
  return api.post<void>(`/api/lives/${liveId}/leave`, {});
}

/** End the broadcast. Only the host may. */
export function endLive(liveId: string) {
  return api.post<void>(`/api/lives/${liveId}/end`, {});
}

/** What is on air right now that this user is allowed to watch. */
export function runningLives() {
  return api.get<Live[]>('/api/lives');
}

/**
 * Go live, or step into the one that is already running there.
 *
 * Pressing "go live" where a broadcast is open used to end in "someone is
 * already live here" with no way in. Most often that broadcast is the
 * person's own: the app closed or crashed mid-live and the row stays open
 * until the sweeper ends it. Joining is right in both cases: the server hands
 * the host back the broadcaster's token and anyone else the audience's.
 */
export async function startOrJoinLive(input: {
  channelId?: string;
  chatId?: string;
  title?: string;
}): Promise<LiveGrant> {
  try {
    return await startLive(input);
  } catch (err) {
    if (!isAlreadyLive(err)) throw err;
    const running = findRunningLive(await runningLives(), input);
    if (!running) throw err;
    return joinLive(running.id);
  }
}
