import * as Location from 'expo-location';
import * as SecureStore from 'expo-secure-store';
import * as TaskManager from 'expo-task-manager';
import { useSyncExternalStore } from 'react';

import { ApiError } from '@/data/api/client';
import { editMessage, sendMessage, type MessageDTO } from '@/data/api/messages';
import { hydrateChats } from '@/data/chat-store';
import { encryptForChat } from '@/data/outbox';
import {
  formatCoords,
  shouldPublish,
  type LatLng,
} from '@/data/location-share';
import type { MessageAttachment } from '@/data/mock';
import { t } from '@/i18n';

/**
 * Live location: a message that keeps being corrected.
 *
 * The share is one `location` message, sent encrypted like any other. Each
 * update is an encrypted edit of that same message, so the server never holds
 * a coordinate in the clear and the thread never fills with positions. The end
 * is carried in the message itself (`expiresAt`), so a phone that dies mid-share
 * is still read as ended by everyone who looks, without anything having to
 * report it.
 *
 * Android keeps the updates coming with a foreground service, which is also the
 * notification that tells the person they are sharing. Because it is started
 * while the app is on screen, background location permission is not needed.
 */

const TASK = 'zwo-live-location';
const KEY = 'live.shares';
const FIX_TIMEOUT_MS = 10_000;

type Position = LatLng & { accuracy?: number };

export type LiveShare = {
  chatId: string;
  messageId: number;
  /** Epoch ms, or null when it runs until the person stops it. */
  expiresAt: number | null;
  startedAt: number;
};

type Tracked = LiveShare & {
  last: { at: number; point: Position } | null;
  timer: ReturnType<typeof setTimeout> | null;
  busy: boolean;
};

export type StartError = 'permission' | 'services' | 'unavailable';

export class LiveLocationError extends Error {
  constructor(readonly reason: StartError) {
    super(reason);
  }
}

const shares = new Map<string, Tracked>();
let snapshot: Record<string, LiveShare> = {};
const listeners = new Set<() => void>();

function emit() {
  snapshot = Object.fromEntries(
    [...shares].map(([chatId, s]) => [
      chatId,
      { chatId: s.chatId, messageId: s.messageId, expiresAt: s.expiresAt, startedAt: s.startedAt },
    ]),
  );
  listeners.forEach((l) => l());
}

function subscribe(l: () => void) {
  listeners.add(l);
  return () => listeners.delete(l);
}

export function getLiveShare(chatId: string): LiveShare | undefined {
  return snapshot[chatId];
}

export function useLiveShares(): Record<string, LiveShare> {
  return useSyncExternalStore(subscribe, () => snapshot, () => snapshot);
}

function body(
  position: Position,
  share: { live: boolean; expiresAt: number | null },
  now = Date.now(),
): MessageAttachment {
  return {
    kind: 'location',
    place: t(share.live ? 'chat.live_location' : 'chat.loc_current'),
    address: formatCoords(position),
    lat: position.lat,
    lng: position.lng,
    accuracy: position.accuracy,
    live: share.live,
    expiresAt: share.expiresAt ? new Date(share.expiresAt).toISOString() : undefined,
    updatedAt: new Date(now).toISOString(),
  };
}

async function persist() {
  try {
    const list = [...shares.values()].map(({ chatId, messageId, expiresAt, startedAt }) => ({
      chatId,
      messageId,
      expiresAt,
      startedAt,
    }));
    if (list.length === 0) await SecureStore.deleteItemAsync(KEY);
    else await SecureStore.setItemAsync(KEY, JSON.stringify(list));
  } catch {
    // Losing the list costs a share that is not resumed after a restart.
  }
}

async function haltUpdatesIfIdle() {
  if (shares.size > 0) return;
  try {
    if (await Location.hasStartedLocationUpdatesAsync(TASK)) {
      await Location.stopLocationUpdatesAsync(TASK);
    }
  } catch {
    // Nothing was running.
  }
}

async function beginUpdates() {
  if (await Location.hasStartedLocationUpdatesAsync(TASK).catch(() => false)) return;
  await Location.startLocationUpdatesAsync(TASK, {
    accuracy: Location.Accuracy.Balanced,
    timeInterval: 5_000,
    distanceInterval: 5,
    pausesUpdatesAutomatically: false,
    showsBackgroundLocationIndicator: true,
    foregroundService: {
      notificationTitle: t('location.sharing_title'),
      notificationBody: t('location.sharing_body'),
      notificationColor: '#5B3DF5',
      killServiceOnDestroy: true,
    },
  });
}

/** Send a correction for one share. Returns false when the share is over. */
async function publish(share: Tracked, position: Position, live: boolean): Promise<boolean> {
  try {
    // The task can run before any screen has loaded the chat list, and the chat's
    // keys are looked up from it.
    await hydrateChats();
    const text = JSON.stringify(body(position, { live, expiresAt: share.expiresAt }));
    await editMessage(share.chatId, share.messageId, await encryptForChat(share.chatId, text));
    return true;
  } catch (err) {
    // The message is gone (deleted, or the chat was): nothing left to update.
    if (err instanceof ApiError && (err.status === 404 || err.status === 403)) return false;
    // Offline or a hiccup: the next fix tries again.
    return true;
  }
}

TaskManager.defineTask(TASK, async ({ data, error }) => {
  if (error || !data) return;
  const { locations } = data as { locations?: Location.LocationObject[] };
  const fix = locations?.[locations.length - 1];
  if (!fix) return;
  const point: Position = {
    lat: fix.coords.latitude,
    lng: fix.coords.longitude,
    accuracy: fix.coords.accuracy ?? undefined,
  };
  const now = Date.now();

  for (const share of [...shares.values()]) {
    if (share.expiresAt && now >= share.expiresAt) {
      void stopLiveShare(share.chatId);
      continue;
    }
    if (share.busy || !shouldPublish(share.last, { at: now, point })) continue;
    share.busy = true;
    try {
      const alive = await publish(share, point, true);
      if (!alive) void dropShare(share.chatId);
      else share.last = { at: now, point };
    } finally {
      share.busy = false;
    }
  }
});

function arm(share: Tracked) {
  if (share.timer) clearTimeout(share.timer);
  if (share.expiresAt === null) return;
  // Capped: setTimeout overflows past about 24 days.
  const wait = Math.min(Math.max(0, share.expiresAt - Date.now()), 2 ** 31 - 1);
  share.timer = setTimeout(() => void stopLiveShare(share.chatId), wait);
}

async function dropShare(chatId: string) {
  const share = shares.get(chatId);
  if (!share) return;
  if (share.timer) clearTimeout(share.timer);
  shares.delete(chatId);
  emit();
  await persist();
  await haltUpdatesIfIdle();
}

/**
 * Start sharing a live position in a chat.
 *
 * Returns the message that was sent, so the screen can show it at once rather
 * than wait for it to come back over the socket.
 */
export async function startLiveShare(
  chatId: string,
  durationMs: number | null,
): Promise<{ dto: MessageDTO; attachment: MessageAttachment }> {
  const permission = await Location.requestForegroundPermissionsAsync();
  if (!permission.granted) throw new LiveLocationError('permission');
  if (!(await Location.hasServicesEnabledAsync())) throw new LiveLocationError('services');

  // Without a fix (indoors, a fresh emulator) the call can wait forever, which
  // leaves the button spinning. Give it a few seconds, then settle for the last
  // known position, and only then report that none is available.
  let fix: Location.LocationObject | null = null;
  try {
    fix = await Promise.race([
      Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced }),
      new Promise<null>((resolve) => setTimeout(() => resolve(null), FIX_TIMEOUT_MS)),
    ]);
    fix ??= await Location.getLastKnownPositionAsync();
  } catch {
    fix = await Location.getLastKnownPositionAsync().catch(() => null);
  }
  if (!fix) throw new LiveLocationError('unavailable');
  const point: Position = {
    lat: fix.coords.latitude,
    lng: fix.coords.longitude,
    accuracy: fix.coords.accuracy ?? undefined,
  };

  // One share per chat. A second would only fight the first over the same
  // microphone-sized notification.
  if (shares.has(chatId)) await stopLiveShare(chatId);

  const now = Date.now();
  const expiresAt = durationMs ? now + durationMs : null;
  const attachment = body(point, { live: true, expiresAt }, now);
  const dto = await sendMessage(
    chatId,
    await encryptForChat(chatId, JSON.stringify(attachment)),
    'location',
  );

  const share: Tracked = {
    chatId,
    messageId: dto.id,
    expiresAt,
    startedAt: now,
    last: { at: now, point },
    timer: null,
    busy: false,
  };
  shares.set(chatId, share);
  arm(share);
  emit();
  await persist();
  try {
    await beginUpdates();
  } catch {
    // The first position is already out; the share just will not follow.
  }
  return { dto, attachment };
}

/** Stop sharing. The last position stays in the message, marked as ended. */
export async function stopLiveShare(chatId: string): Promise<void> {
  const share = shares.get(chatId);
  if (!share) return;
  const last = share.last?.point;
  await dropShare(chatId);
  if (last) {
    // Final correction: same place, no longer live. Best effort.
    await publish(share, last, false);
  }
}

export async function stopAllLiveShares(): Promise<void> {
  await Promise.all([...shares.keys()].map((chatId) => stopLiveShare(chatId)));
}

/**
 * Pick up shares that were running when the app was closed.
 *
 * Only while permission is still granted and the share has not run out: a share
 * is never started from a stale record without the person being able to see it.
 */
export async function resumeLiveShares(): Promise<void> {
  try {
    const raw = await SecureStore.getItemAsync(KEY);
    if (!raw) return;
    const saved = JSON.parse(raw) as LiveShare[];
    const permission = await Location.getForegroundPermissionsAsync();
    const now = Date.now();
    for (const s of saved) {
      if (shares.has(s.chatId)) continue;
      if (!permission.granted || (s.expiresAt && s.expiresAt <= now)) continue;
      const share: Tracked = { ...s, last: null, timer: null, busy: false };
      shares.set(s.chatId, share);
      arm(share);
    }
    emit();
    await persist();
    if (shares.size > 0) await beginUpdates();
  } catch {
    // Nothing to resume.
  }
}
