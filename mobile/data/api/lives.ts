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
  /** Who may watch. */
  audience?: LiveAudience;
  /** Started in a direct chat: both people host it. */
  joint?: boolean;
  comments_enabled?: boolean;
  hearts?: number;
};

/**
 * Who may watch, chosen when going live. `place` is the members of the chat,
 * group or channel it starts in; a live from Stories has no place.
 */
export type LiveAudience = 'place' | 'contacts' | 'selected' | 'public';

/** The most someone is in a live; decides which tools they see. */
export type LiveRole = 'host' | 'cohost' | 'moderator' | 'guest' | 'viewer';

export type StageState = 'invited' | 'requested' | 'on';

export type LiveMember = {
  user_id: string;
  name: string;
  cohost: boolean;
  cohost_answer?: 'pending' | 'accepted' | 'declined';
  moderator: boolean;
  stage?: StageState;
};

export type LiveComment = {
  id: number;
  live_id: string;
  user_id: string;
  name: string;
  body: string;
  created_at: string;
};

export type LiveViewer = { user_id: string; name: string; moderator: boolean; stage?: StageState };

export type LiveStats = {
  viewers: number;
  peak_viewers: number;
  unique_viewers: number;
  hearts: number;
  comments: number;
  duration_seconds: number;
};

export type LiveDetails = {
  live: Live;
  members: LiveMember[];
  role: LiveRole;
  moderator: boolean;
  stage?: StageState;
  comments: LiveComment[];
};

export type LiveGrant = {
  live: Live;
  url: string;
  room: string;
  token: string;
  identity: string;
  /** Which side of the glass. The SFU enforces it; this picks the screen. */
  host: boolean;
  role?: LiveRole;
  moderator?: boolean;
};

/** Start broadcasting. Exactly one of channelId / chatId. */
export type StartLiveInput = {
  channelId?: string;
  chatId?: string;
  title?: string;
  audience?: LiveAudience;
  /** The guest list, for a `selected` audience. */
  viewerIds?: string[];
};

/** Start broadcasting: from a chat, group or channel, or from Stories with neither. */
export function startLive(input: StartLiveInput) {
  return api.post<LiveGrant>('/api/lives', {
    channel_id: input.channelId,
    chat_id: input.chatId,
    title: input.title ?? '',
    audience: input.audience,
    viewer_ids: input.viewerIds,
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

/** Keep the server-side viewer lease alive while the SFU room is open. */
export function heartbeatLive(liveId: string) {
  return api.post<void>(`/api/lives/${liveId}/heartbeat`, {});
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
export async function startOrJoinLive(input: StartLiveInput): Promise<LiveGrant> {
  try {
    return await startLive(input);
  } catch (err) {
    if (!isAlreadyLive(err)) throw err;
    const running = findRunningLive(await runningLives(), input);
    if (!running) throw err;
    return joinLive(running.id);
  }
}

// ── tools inside a live ─────────────────────────────────────────────────────

export const liveDetails = (id: string) => api.get<LiveDetails>(`/api/lives/${id}`);
export const liveStats = (id: string) => api.get<LiveStats>(`/api/lives/${id}/stats`);
export const liveAudienceList = (id: string) => api.get<LiveViewer[]>(`/api/lives/${id}/audience`);

/** Answer what is waiting for you: a joint-live invitation or a call to the stage. */
export const respondLive = (id: string, accept: boolean) =>
  api.post<void>(`/api/lives/${id}/respond`, { accept });

export const inviteToLive = (id: string, userIds: string[]) =>
  api.post<void>(`/api/lives/${id}/invite`, { user_ids: userIds });

export const setLiveComments = (id: string, enabled: boolean) =>
  api.patch<void>(`/api/lives/${id}/settings`, { comments_enabled: enabled });

/** Hearts are counted in batches; the animation travels the data channel. */
export const sendLiveHearts = (id: string, n: number) =>
  api.post<void>(`/api/lives/${id}/hearts`, { n });

export const liveComments = (id: string) => api.get<LiveComment[]>(`/api/lives/${id}/comments`);
export const postLiveComment = (id: string, body: string) =>
  api.post<LiveComment>(`/api/lives/${id}/comments`, { body });
export const deleteLiveComment = (id: string, commentId: number) =>
  api.del<void>(`/api/lives/${id}/comments/${commentId}`);

export const requestStage = (id: string) => api.post<void>(`/api/lives/${id}/stage/request`, {});
export const leaveStage = (id: string) => api.post<void>(`/api/lives/${id}/stage/leave`, {});
export const inviteToStage = (id: string, userId: string) =>
  api.post<void>(`/api/lives/${id}/stage/${userId}`, {});
export const removeFromStage = (id: string, userId: string) =>
  api.del<void>(`/api/lives/${id}/stage/${userId}`);

export const setLiveModerator = (id: string, userId: string, on: boolean) =>
  on
    ? api.put<void>(`/api/lives/${id}/moderators/${userId}`, {})
    : api.del<void>(`/api/lives/${id}/moderators/${userId}`);

export const liveBans = (id: string) =>
  api.get<{ user_id: string; name: string }[]>(`/api/lives/${id}/bans`);
export const banFromLive = (id: string, userId: string) =>
  api.put<void>(`/api/lives/${id}/bans/${userId}`, {});
export const unbanFromLive = (id: string, userId: string) =>
  api.del<void>(`/api/lives/${id}/bans/${userId}`);
