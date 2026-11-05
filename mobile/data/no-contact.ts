import { useEffect, useSyncExternalStore } from 'react';

import { getNoContact } from '@/data/api/messages';

/**
 * Chats that are in a no-contact period, and until when.
 *
 * Fed two ways: the websocket event the server sends to both people the moment
 * a report is filed, and a one-off read when a chat opens, because someone who
 * was offline never saw the event. The server is the authority; this only
 * decides what the screen shows (a banner, a disabled composer).
 */

let until = new Map<string, string>();
const listeners = new Set<() => void>();

function emit() {
  until = new Map(until);
  listeners.forEach((l) => l());
}

function subscribe(l: () => void): () => void {
  listeners.add(l);
  return () => listeners.delete(l);
}

function setUntil(chatId: string, value: string | null | undefined) {
  if (value && new Date(value).getTime() > Date.now()) until.set(chatId, value);
  else until.delete(chatId);
  emit();
}

export function getNoContactUntil(chatId: string): string | null {
  const v = until.get(chatId);
  if (!v) return null;
  return new Date(v).getTime() > Date.now() ? v : null;
}

/** Ask the server, for a chat that has just been opened. */
export async function refreshNoContact(chatId: string): Promise<void> {
  try {
    setUntil(chatId, (await getNoContact(chatId)).until);
  } catch {
    // Not knowing is not a reason to block anyone: the server refuses a send
    // inside the period anyway, and the composer then explains why.
  }
}

/** Record a period learnt some other way, for example a refused send. */
export function setNoContact(chatId: string, value: string | null | undefined): void {
  setUntil(chatId, value);
}

/** Route a realtime event. Returns true when it was ours. */
export function handleNoContactEvent(type: string, payload: unknown): boolean {
  if (type !== 'chat.no_contact') return false;
  const p = payload as { chat_id?: string; until?: string } | null | undefined;
  if (typeof p?.chat_id === 'string') setUntil(p.chat_id, p.until);
  return true;
}

export function resetNoContact(): void {
  until = new Map();
  listeners.forEach((l) => l());
}

/**
 * The end of the period for one chat, or null. Re-renders when it starts and
 * the moment it ends, without anyone having to open the screen again.
 */
export function useNoContact(chatId: string | undefined): string | null {
  const value = useSyncExternalStore(
    subscribe,
    () => (chatId ? until.get(chatId) ?? null : null),
    () => null,
  );

  useEffect(() => {
    if (!chatId) return;
    void refreshNoContact(chatId);
  }, [chatId]);

  useEffect(() => {
    if (!chatId || !value) return;
    const ms = new Date(value).getTime() - Date.now();
    if (ms <= 0) {
      setUntil(chatId, null);
      return;
    }
    // setTimeout caps near 24.8 days; a period is a day, but stay safe.
    const timer = setTimeout(() => setUntil(chatId, null), Math.min(ms + 500, 2 ** 31 - 1));
    return () => clearTimeout(timer);
  }, [chatId, value]);

  if (!value) return null;
  return new Date(value).getTime() > Date.now() ? value : null;
}
