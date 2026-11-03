import { useSyncExternalStore } from 'react';

import { runningLives, type Live } from '@/data/api/lives';
import { getCurrentUser } from '@/data/auth-store';
import { closeRoom, dismissLiveInvite, handleLiveRoomEvent } from '@/data/live-room';

/**
 * What is on air, and how many people are watching.
 *
 * A store rather than screen state for the same reason as incoming calls: a
 * broadcast starts while any screen is on top, or none, and the websocket
 * handlers that already exist can feed it without knowing who is listening.
 *
 * The viewer count is the server's, never the client's. `liveViewers` used to
 * be a number the composer wrote onto its own optimistic post — it reached no
 * server, survived exactly one round-trip, and was never anything but a
 * decoration. This one is counted from rows and pushed when it changes.
 */

let running: Live[] = [];
const viewers = new Map<string, number>();
const listeners = new Set<() => void>();

function emit() {
  listeners.forEach((l) => l());
}

function subscribe(l: () => void): () => void {
  listeners.add(l);
  return () => listeners.delete(l);
}

export function getRunningLives(): Live[] {
  return running;
}

export function setRunningLives(list: Live[]): void {
  running = list;
  for (const l of list) viewers.set(l.id, l.viewers);
  emit();
}

/** The broadcasts this user can watch right now. */
export function useRunningLives(): Live[] {
  return useSyncExternalStore(subscribe, getRunningLives, () => running);
}

/**
 * The audience size for one broadcast.
 *
 * `fallback` is what the join response said, used until the first update
 * arrives — otherwise the number flashes 0 for as long as the round trip takes,
 * on the screen of the person watching it hardest.
 */
export function useLiveViewers(liveId: string, fallback = 0): number {
  return useSyncExternalStore(
    subscribe,
    () => viewers.get(liveId) ?? fallback,
    () => fallback,
  );
}

/**
 * Ask the server what is on air.
 *
 * The websocket carries changes, not the current state: someone who opens the
 * app after a broadcast started never saw the event. Called on the screens
 * that show a live, and cheap enough to call again.
 */
export async function refreshRunningLives(): Promise<void> {
  try {
    setRunningLives(await runningLives());
  } catch {
    // A broadcast list that fails to load is not worth a dialog. The screen
    // shows what it had, which is nothing, and that is the honest answer.
  }
}

/** The broadcast on air for a channel or chat, if any. */
export function liveFor(where: { channelId?: string; chatId?: string }): Live | undefined {
  return running.find((l) =>
    where.channelId ? l.channel_id === where.channelId : l.chat_id === where.chatId,
  );
}

/** Drop everything — called on logout so nothing outlives the account. */
export function resetLives(): void {
  running = [];
  viewers.clear();
  closeRoom();
  dismissLiveInvite();
  emit();
}

/**
 * Feed the store from a realtime event.
 *
 * Returns true when the event was ours, so a handler can tell "handled" from
 * "not mine" — the same contract as handleCallEvent.
 */
export function handleLiveEvent(type: string, payload: unknown): boolean {
  const p = payload as Record<string, unknown> | null | undefined;

  // What happens inside a live, and invitations into one, belong to the room.
  if (handleLiveRoomEvent(getCurrentUser()?.id, type, payload)) return true;

  if (type === 'live.started') {
    const live = p?.live as Live | undefined;
    if (!live?.id) return true;
    // Replace rather than append: the same broadcast can be announced twice —
    // a reconnect replays, and two websocket listeners both see it.
    running = [live, ...running.filter((l) => l.id !== live.id)];
    viewers.set(live.id, live.viewers);
    emit();
    return true;
  }

  if (type === 'live.ended') {
    const id = p?.live_id;
    if (typeof id !== 'string') return true;
    running = running.filter((l) => l.id !== id);
    viewers.delete(id);
    emit();
    return true;
  }

  if (type === 'live.viewers') {
    const id = p?.live_id;
    const n = p?.viewers;
    if (typeof id !== 'string' || typeof n !== 'number') return true;
    viewers.set(id, n);
    running = running.map((l) => (l.id === id ? { ...l, viewers: n } : l));
    emit();
    return true;
  }

  return false;
}
