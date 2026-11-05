import { useEffect, useState, useSyncExternalStore } from 'react';

import { hangupCall } from '@/data/api/calls';

/**
 * The call in progress, if any.
 *
 * It used to live inside the call screen, so leaving the screen was leaving the
 * call: the room closed on unmount and the server was told it had ended. A call
 * outlives its screen now. This is what it is; the host in the root layout runs
 * it, and the call screen and the green bar are two views of it.
 */

export type CallMode = 'voice' | 'video';

/** The part of a LiveKit room this module needs, so it can load without one. */
type Disconnectable = { disconnect(): Promise<unknown> };

export type ActiveCall<Room extends Disconnectable = Disconnectable> = {
  chatId: string;
  mode: CallMode;
  /** Answering rather than placing, so the other phones are not rung. */
  incoming: boolean;
  /** Whether the call screen is showing. The bar shows when it is not. */
  onScreen: boolean;
  room: Room | null;
  /** The media key, or null when the SFU can read the streams. */
  e2eeKey: string | null;
  isGroup: boolean;
  peerName: string;
  /** When someone else joined. Joining the room alone is not being connected. */
  connectedAt: number | null;
  speaker: boolean;
  failure: string | null;
};

let current: ActiveCall | null = null;
const listeners = new Set<() => void>();

function emit() {
  listeners.forEach((l) => l());
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function getActiveCall(): ActiveCall | null {
  return current;
}

export function useActiveCall(): ActiveCall | null {
  return useSyncExternalStore(subscribe, getActiveCall, getActiveCall);
}

/**
 * Start a call, or return to the one already running in this chat. A call to
 * another chat replaces it: there is one microphone, and two rooms would both
 * be listening to it.
 */
export function beginCall(input: { chatId: string; mode: CallMode; incoming: boolean }): void {
  if (current?.chatId === input.chatId) return;
  if (current) endCall();
  current = {
    ...input,
    onScreen: true,
    room: null,
    e2eeKey: null,
    isGroup: false,
    peerName: '',
    connectedAt: null,
    speaker: input.mode === 'video',
    failure: null,
  };
  emit();
}

/** Update a running call. A late answer for a call that ended is dropped. */
export function patchCall(chatId: string, patch: Partial<ActiveCall>): void {
  if (current?.chatId !== chatId) return;
  current = { ...current, ...patch };
  emit();
}

/**
 * Hang up, from anywhere.
 *
 * The server is told first and not waited on: hanging up must not depend on the
 * network, and it treats a repeat or a miss as a no-op. Its sweep is still there
 * for the phone that dies mid-call.
 */
export function endCall(): void {
  if (!current) return;
  const { chatId, room } = current;
  current = null;
  emit();
  void hangupCall(chatId).catch(() => {});
  void room?.disconnect().catch(() => {});
}

/**
 * What to do with the camera as someone leaves or returns to a call. Nobody
 * sends their camera to a person while looking at another screen or another
 * app, and only a camera this turned off comes back on by itself: one the
 * person turned off stays off.
 */
export function cameraStep(input: {
  away: boolean;
  enabled: boolean;
  pausedByUs: boolean;
}): 'pause' | 'resume' | null {
  if (input.away && input.enabled) return 'pause';
  if (!input.away && input.pausedByUs) return 'resume';
  return null;
}

/** MM:SS, or H:MM:SS past the hour. */
export function formatCallDuration(totalSeconds: number): string {
  const h = Math.floor(totalSeconds / 3600);
  const m = Math.floor((totalSeconds % 3600) / 60);
  const s = totalSeconds % 60;
  const mm = String(m).padStart(2, '0');
  const ss = String(s).padStart(2, '0');
  return h > 0 ? `${h}:${mm}:${ss}` : `${mm}:${ss}`;
}

/**
 * Seconds since the call connected, from the wall clock. An interval that
 * misses beats in the background would drift from the phone's own timer.
 */
export function useCallSeconds(connectedAt: number | null): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!connectedAt) return;
    setNow(Date.now());
    const tick = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(tick);
  }, [connectedAt]);
  return connectedAt ? Math.max(0, Math.floor((now - connectedAt) / 1000)) : 0;
}
