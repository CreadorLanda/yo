import { useSyncExternalStore } from 'react';

import {
  clearChatHistory as apiClearHistory,
  deleteChat as apiDeleteChat,
  listChats,
  updateChatSettings as apiUpdateSettings,
  type ChatDTO,
  type ChatSettings,
} from './api/messages';

/**
 * Chat list store.
 *
 * The list used to live in component state, which meant it was fetched
 * once on mount and then went stale: sending a message and navigating
 * back left the old preview and unread count on screen. Holding it here
 * lets the screen re-render from realtime events and lets chat-info
 * mutate a chat without either of them knowing about the other.
 *
 * Server order (pinned first, then last activity) is authoritative — we
 * never re-sort locally, so the client can't disagree with the backend.
 */

let chats: ChatDTO[] = [];
let archived: ChatDTO[] = [];
let loaded = false;
let inFlight: Promise<void> | null = null;

const listeners = new Set<() => void>();

function emit() {
  // Fresh identities so useSyncExternalStore sees a change.
  chats = [...chats];
  listeners.forEach((l) => l());
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/**
 * Fetch the list. Concurrent callers share one request — the screen
 * refreshes on focus and the socket can reconnect at the same moment.
 */
export async function refreshChats(opts: { archived?: boolean } = {}): Promise<void> {
  if (opts.archived) {
    try {
      archived = await listChats({ archived: true });
      emit();
    } catch {
      /* offline — keep what we have */
    }
    return;
  }
  if (inFlight) return inFlight;
  inFlight = (async () => {
    try {
      chats = await listChats();
      loaded = true;
      emit();
    } catch {
      // Leave the previous list in place; an empty list would look like
      // "you have no chats" when it is really "the network blipped".
      loaded = true;
    } finally {
      inFlight = null;
    }
  })();
  return inFlight;
}

/**
 * Apply a realtime event. Anything that changes ordering or unread state
 * triggers a refetch rather than a local guess, so the server stays the
 * single source of truth for order.
 */
export function applyRealtimeEvent(type: string): void {
  switch (type) {
    case 'message.new':
    case 'message.deleted':
    case 'message.edited':
    case 'receipt.read':
      void refreshChats();
      break;
    default:
      break;
  }
}

/** Optimistically clear a chat's unread badge (called when opening it). */
export function markChatRead(chatId: string): void {
  const i = chats.findIndex((c) => c.id === chatId);
  if (i === -1 || chats[i].unread_count === 0) return;
  chats[i] = { ...chats[i], unread_count: 0 };
  emit();
}

export async function setChatSettings(chatId: string, settings: ChatSettings): Promise<void> {
  const before = chats;
  // Optimistic: the toggle should feel instant.
  const now = new Date().toISOString();
  chats = chats.map((c) =>
    c.id === chatId
      ? {
          ...c,
          pinned_at: settings.pinned === undefined ? c.pinned_at : settings.pinned ? now : undefined,
          muted_until:
            settings.muted === undefined ? c.muted_until : settings.muted ? now : undefined,
          archived_at:
            settings.archived === undefined ? c.archived_at : settings.archived ? now : undefined,
        }
      : c,
  );
  emit();
  try {
    await apiUpdateSettings(chatId, settings);
    // Pin and archive both reorder or remove rows — take the server's word.
    if (settings.pinned !== undefined || settings.archived !== undefined) {
      await refreshChats();
    }
    // Archiving moves a row between two lists, so refreshing one of them
    // leaves the other stale: the chat vanished from the main list while the
    // archived count stayed at zero, and the entry row that count gates never
    // appeared. Whoever archives has nowhere to go until something else
    // happens to refetch.
    if (settings.archived !== undefined) {
      await refreshChats({ archived: true });
    }
  } catch {
    chats = before;
    emit();
    throw new Error('chat_settings_failed');
  }
}

export async function clearChat(chatId: string): Promise<void> {
  await apiClearHistory(chatId);
  await refreshChats();
}

export async function removeChat(chatId: string): Promise<void> {
  const before = chats;
  chats = chats.filter((c) => c.id !== chatId);
  emit();
  try {
    await apiDeleteChat(chatId);
  } catch {
    chats = before;
    emit();
    throw new Error('chat_delete_failed');
  }
}

/**
 * A synchronous, cache-only lookup — no fetch, no loading state.
 *
 * For code that runs outside a component (the outbox drain, in particular):
 * it needs a chat's peer/group identity to encrypt a queued message, but it
 * runs on its own schedule, not React's, so a hook is the wrong shape here.
 * Returns undefined before the first successful `refreshChats()` — callers
 * that can't proceed without it should treat that as "try again later", not
 * fall back to fetching, or every drain tick would cost a request.
 */
export function getCachedChat(chatId: string): ChatDTO | undefined {
  return chats.find((c) => c.id === chatId);
}

export function useChats(): { chats: ChatDTO[]; loaded: boolean } {
  const list = useSyncExternalStore(
    subscribe,
    () => chats,
    () => chats,
  );
  return { chats: list, loaded };
}

export function useArchivedChats(): ChatDTO[] {
  return useSyncExternalStore(
    subscribe,
    () => archived,
    () => archived,
  );
}

/** Test/logout hook — drops everything so the next user starts clean. */
export function resetChatStore(): void {
  chats = [];
  archived = [];
  loaded = false;
  inFlight = null;
  emit();
}
