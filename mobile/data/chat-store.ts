import { useRef, useSyncExternalStore } from 'react';

import {
  clearChatHistory as apiClearHistory,
  deleteChat as apiDeleteChat,
  listChats,
  updateChatSettings as apiUpdateSettings,
  updateChatPrivacy as apiUpdatePrivacy,
  type ChatDTO,
  type ChatSettings,
  type ChatPrivacySettings,
} from './api/messages';
import {
  loadCachedChats,
  saveCachedChats,
  saveCachedPreview,
  type CachedPreview,
} from './db/chats';
import { clearCachedChat } from './db/messages';
import { forgetThread } from './thread-cache';

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
 *
 * The last list is also kept on disk. It is shown the moment the app starts
 * and the network replaces it when it answers, so a cold start or a dead
 * connection still has every chat, and the outbox can still resolve a peer.
 */

let chats: ChatDTO[] = [];
let archived: ChatDTO[] = [];
let loaded = false;
let inFlight: Promise<void> | null = null;

let previews = new Map<string, CachedPreview>();
let hydration: Promise<void> | null = null;
/** Which list the network has already answered for; disk must not overwrite it. */
let fetched = { active: false, archived: false };
/** Bumped on logout, so a late answer cannot refill a list for the next account. */
let session = 0;

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

/** Fill the lists from disk, once. Runs by itself on the first refresh. */
export function hydrateChats(): Promise<void> {
  if (hydration) return hydration;
  const started = session;
  hydration = (async () => {
    try {
      const cached = await loadCachedChats();
      if (started !== session) return;
      if (!fetched.active) chats = cached.active;
      if (!fetched.archived) archived = cached.archived;
      previews = cached.previews;
      if (chats.length > 0) loaded = true;
      emit();
    } catch {
      // No database, as on web: the network fills the list instead.
    }
  })();
  return hydration;
}

function persist(list: ChatDTO[], isArchived: boolean) {
  saveCachedChats(list, isArchived).catch(() => {});
}

/**
 * Fetch the list. Concurrent callers share one request — the screen
 * refreshes on focus and the socket can reconnect at the same moment.
 */
export async function refreshChats(opts: { archived?: boolean } = {}): Promise<void> {
  void hydrateChats();
  const started = session;
  if (opts.archived) {
    try {
      const list = await listChats({ archived: true });
      if (started !== session) return;
      archived = list;
      fetched.archived = true;
      persist(list, true);
      emit();
    } catch {
      /* offline — keep what we have */
    }
    return;
  }
  if (inFlight) return inFlight;
  inFlight = (async () => {
    try {
      const list = await listChats();
      if (started !== session) return;
      chats = list;
      fetched.active = true;
      loaded = true;
      persist(list, false);
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
  if (i !== -1 && chats[i].unread_count !== 0) {
    chats[i] = { ...chats[i], unread_count: 0 };
    emit();
  }
  const j = archived.findIndex((c) => c.id === chatId);
  if (j !== -1 && archived[j].unread_count !== 0) {
    archived[j] = { ...archived[j], unread_count: 0 };
    // ensure emit updates identity
    archived = [...archived];
    emit();
  }
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

export async function setChatPrivacy(chatId: string, settings: ChatPrivacySettings): Promise<void> {
  const before = chats;
  chats = chats.map((c) =>
    c.id === chatId ? { ...c, privacy: { ...c.privacy, ...settings } } : c,
  );
  emit();
  try {
    const updated = await apiUpdatePrivacy(chatId, settings);
    chats = chats.map((c) => (c.id === chatId ? updated : c));
    emit();
  } catch {
    chats = before;
    emit();
    throw new Error('chat_privacy_failed');
  }
}

export async function clearChat(chatId: string): Promise<void> {
  await apiClearHistory(chatId);
  forgetThread(chatId);
  await clearCachedChat(chatId).catch(() => {});
  await refreshChats();
}

export async function removeChat(chatId: string): Promise<void> {
  const before = chats;
  chats = chats.filter((c) => c.id !== chatId);
  emit();
  try {
    await apiDeleteChat(chatId);
    forgetThread(chatId);
    await clearCachedChat(chatId).catch(() => {});
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
  return chats.find((c) => c.id === chatId) ?? archived.find((c) => c.id === chatId);
}

/** The decrypted preview for this ciphertext, if it has been opened before. */
export function getCachedPreview(chatId: string, source: string): string | undefined {
  const known = previews.get(chatId);
  return known?.source === source ? known.text : undefined;
}

export function rememberPreview(chatId: string, source: string, text: string): void {
  previews.set(chatId, { source, text });
  saveCachedPreview(chatId, source, text).catch(() => {});
}

/** Make a newly opened chat available before the next list refresh. */
export function upsertChat(chat: ChatDTO): void {
  const index = chats.findIndex((c) => c.id === chat.id);
  if (index === -1) {
    chats = [chat, ...chats];
  } else {
    chats[index] = chat;
  }
  if (!chat.archived_at) {
    archived = archived.filter((c) => c.id !== chat.id);
  }
  emit();
}

export function useChats(): { chats: ChatDTO[]; loaded: boolean } {
  const list = useSyncExternalStore(
    subscribe,
    () => chats,
    () => chats,
  );
  return { chats: list, loaded };
}

/**
 * One chat, from either list. Keeps the same object until something in it
 * changes, because a refresh hands back new objects for every chat, and a screen
 * showing one of them should not redraw for the others.
 */
export function useChat(chatId: string | undefined): ChatDTO | null {
  const last = useRef<ChatDTO | null>(null);
  const read = () => {
    const next = (chatId ? getCachedChat(chatId) : undefined) ?? null;
    if (next === last.current) return next;
    if (next && last.current && JSON.stringify(next) === JSON.stringify(last.current)) {
      return last.current;
    }
    last.current = next;
    return next;
  };
  return useSyncExternalStore(subscribe, read, read);
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
  previews = new Map();
  hydration = null;
  fetched = { active: false, archived: false };
  session += 1;
  emit();
}
