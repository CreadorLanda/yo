import { useSyncExternalStore } from 'react';

import type {
  Live,
  LiveComment,
  LiveDetails,
  LiveMember,
  StageState,
} from '@/data/api/lives';

/**
 * What is happening inside the live this phone has open, and the invitations
 * waiting for it.
 *
 * Fed by the same websocket handlers as the running-lives list (see
 * `handleLiveEvent`), because a comment or a call to the stage arrives while
 * the live screen is on top and nothing else is listening. The reducer is
 * pure so the rules (who a stage change is about, which comments survive)
 * can be tested without a socket.
 */

export type RoomState = {
  liveId: string | null;
  comments: LiveComment[];
  members: LiveMember[];
  commentsEnabled: boolean;
  /** This person's own place on the stage. */
  myStage?: StageState;
  /** Who called this person to the stage, while the invitation stands. */
  stageInviteBy?: string;
  banned: boolean;
  ended: boolean;
};

/** How many comments a phone keeps. The screen shows far fewer. */
export const MAX_COMMENTS = 100;

export const EMPTY_ROOM: RoomState = {
  liveId: null,
  comments: [],
  members: [],
  commentsEnabled: true,
  banned: false,
  ended: false,
};

export function roomFromDetails(d: LiveDetails): RoomState {
  return {
    liveId: d.live.id,
    comments: d.comments,
    members: d.members,
    commentsEnabled: d.live.comments_enabled !== false,
    myStage: d.stage,
    banned: false,
    ended: !!d.live.ended_at,
  };
}

function upsertMember(members: LiveMember[], id: string, patch: Partial<LiveMember>): LiveMember[] {
  const found = members.find((m) => m.user_id === id);
  if (found) return members.map((m) => (m.user_id === id ? { ...m, ...patch } : m));
  return [...members, { user_id: id, name: '', cohost: false, moderator: false, ...patch }];
}

/**
 * Apply one realtime event to the room. Events for another live, or for no
 * live open, leave the state as it was.
 */
export function reduceRoom(state: RoomState, me: string | undefined, type: string, payload: unknown): RoomState {
  const p = (payload ?? {}) as Record<string, unknown>;
  if (!state.liveId || p.live_id !== state.liveId) return state;

  switch (type) {
    case 'live.comment': {
      const c = p.comment as LiveComment | undefined;
      if (!c || state.comments.some((x) => x.id === c.id)) return state;
      return { ...state, comments: [...state.comments, c].slice(-MAX_COMMENTS) };
    }
    case 'live.comment_deleted':
      return { ...state, comments: state.comments.filter((c) => c.id !== p.id) };
    case 'live.settings':
      return typeof p.comments_enabled === 'boolean'
        ? { ...state, commentsEnabled: p.comments_enabled }
        : state;
    case 'live.stage': {
      const id = p.user_id as string | undefined;
      if (!id) return state;
      const stage = (p.stage as StageState | null) ?? undefined;
      const patch: Partial<LiveMember> = { stage };
      if (typeof p.name === 'string' && p.name) patch.name = p.name;
      const next = { ...state, members: upsertMember(state.members, id, patch) };
      if (id === me) {
        next.myStage = stage;
        if (stage !== 'invited') next.stageInviteBy = undefined;
      }
      return next;
    }
    case 'live.stage_invite':
      return { ...state, myStage: 'invited', stageInviteBy: (p.by as string) || '' };
    case 'live.member': {
      const id = p.user_id as string | undefined;
      if (!id) return state;
      if (p.banned === true) {
        return {
          ...state,
          members: state.members.filter((m) => m.user_id !== id),
          banned: state.banned || id === me,
        };
      }
      const patch: Partial<LiveMember> = {};
      if (typeof p.moderator === 'boolean') patch.moderator = p.moderator;
      if (typeof p.cohost_answer === 'string') {
        patch.cohost_answer = p.cohost_answer as LiveMember['cohost_answer'];
      }
      return { ...state, members: upsertMember(state.members, id, patch) };
    }
    case 'live.banned':
      return { ...state, banned: true };
    case 'live.ended':
      return { ...state, ended: true };
  }
  return state;
}

// ── the open room ───────────────────────────────────────────────────────────

let room: RoomState = EMPTY_ROOM;
const roomListeners = new Set<() => void>();

function emitRoom() {
  roomListeners.forEach((l) => l());
}

export function openRoom(d: LiveDetails): void {
  room = roomFromDetails(d);
  emitRoom();
}

export function closeRoom(): void {
  room = EMPTY_ROOM;
  emitRoom();
}

export function getRoom(): RoomState {
  return room;
}

/** A comment this phone just sent, shown before the echo comes back. */
export function addOwnComment(c: LiveComment): void {
  room = reduceRoom(room, undefined, 'live.comment', { live_id: c.live_id, comment: c });
  emitRoom();
}

export function patchRoom(patch: Partial<RoomState>): void {
  room = { ...room, ...patch };
  emitRoom();
}

export function useLiveRoom(): RoomState {
  return useSyncExternalStore(
    (l) => {
      roomListeners.add(l);
      return () => roomListeners.delete(l);
    },
    () => room,
    () => room,
  );
}

// ── invitations ─────────────────────────────────────────────────────────────

/**
 * Someone asking this person in: to host a joint live (rings like a call) or
 * to watch one (a lighter nudge).
 */
export type LiveInvite = { kind: 'cohost' | 'watch'; live: Live; by?: string };

let invite: LiveInvite | null = null;
const inviteListeners = new Set<() => void>();

function emitInvite() {
  inviteListeners.forEach((l) => l());
}

export function dismissLiveInvite(): void {
  invite = null;
  emitInvite();
}

export function useLiveInvite(): LiveInvite | null {
  return useSyncExternalStore(
    (l) => {
      inviteListeners.add(l);
      return () => inviteListeners.delete(l);
    },
    () => invite,
    () => invite,
  );
}

/**
 * Route a realtime event into the room or the invitations. Returns true when
 * it was one of theirs. `live.ended` is applied and reported as not handled,
 * so the running-lives list still drops the live.
 */
export function handleLiveRoomEvent(me: string | undefined, type: string, payload: unknown): boolean {
  const p = (payload ?? {}) as Record<string, unknown>;

  if (type === 'live.cohost_invite' || type === 'live.invite') {
    const live = p.live as Live | undefined;
    // Already inside that live: there is nothing to invite them to.
    if (live?.id && room.liveId !== live.id) {
      invite = {
        kind: type === 'live.cohost_invite' ? 'cohost' : 'watch',
        live,
        by: typeof p.by === 'string' ? p.by : undefined,
      };
      emitInvite();
    }
    return true;
  }

  if (type === 'live.ended') {
    if (invite && invite.live.id === p.live_id) dismissLiveInvite();
    const next = reduceRoom(room, me, type, payload);
    if (next !== room) {
      room = next;
      emitRoom();
    }
    return false;
  }

  if (
    type === 'live.comment' ||
    type === 'live.comment_deleted' ||
    type === 'live.settings' ||
    type === 'live.stage' ||
    type === 'live.stage_invite' ||
    type === 'live.member' ||
    type === 'live.banned'
  ) {
    const next = reduceRoom(room, me, type, payload);
    if (next !== room) {
      room = next;
      emitRoom();
    }
    return true;
  }
  return false;
}
