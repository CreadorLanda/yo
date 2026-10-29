import * as SecureStore from 'expo-secure-store';
import { useSyncExternalStore } from 'react';

import { deleteThemeImage } from './theme-assets';
import type { WallpaperAnimation } from './theme-model';

/**
 * Device-local, per-chat preferences.
 *
 * These are deliberately NOT server settings — unlike pin / mute / archive
 * (see [chat-store]), a chat lock and media visibility describe this
 * device, not the account. Syncing them would leak which chats a user
 * considers sensitive to every other device and to the server.
 *
 * They used to be plain `useState` in chat-info, which meant every toggle
 * reset the moment you left the screen.
 */

const STORAGE_KEY = 'chat.prefs.v1';

export type ChatPrefs = {
  /** Hide this chat's preview text in the list. */
  locked: boolean;
  /** Show media from this chat in the chat-info gallery. */
  filesVisible: boolean;
  /** Device-local wallpaper override. The chat id also covers group chats. */
  wallpaper?: ChatWallpaper;
};

export type ChatWallpaper = {
  color?: string;
  imageUri?: string;
  dim: number;
  blur: boolean;
  animation: WallpaperAnimation;
};

const DEFAULTS: ChatPrefs = { locked: false, filesVisible: true };

let prefs: Record<string, ChatPrefs> = {};
let booted = false;
const listeners = new Set<() => void>();

function emit() {
  prefs = { ...prefs };
  listeners.forEach((l) => l());
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function normalize(value: unknown): Record<string, ChatPrefs> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  const out: Record<string, ChatPrefs> = {};
  for (const [id, raw] of Object.entries(value)) {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) continue;
    const item = raw as Record<string, unknown>;
    const wallpaper = item.wallpaper;
    const next: ChatPrefs = {
      locked: item.locked === true,
      filesVisible: item.filesVisible !== false,
    };
    if (wallpaper && typeof wallpaper === 'object' && !Array.isArray(wallpaper)) {
      const w = wallpaper as Record<string, unknown>;
      const animation = ['none', 'aurora', 'drift', 'pulse', 'liquid'].includes(String(w.animation))
        ? (w.animation as WallpaperAnimation)
        : 'none';
      next.wallpaper = {
        color: typeof w.color === 'string' ? w.color : undefined,
        imageUri: typeof w.imageUri === 'string' ? w.imageUri : undefined,
        dim: typeof w.dim === 'number' && Number.isFinite(w.dim) ? Math.min(80, Math.max(0, w.dim)) : 35,
        blur: w.blur === true,
        animation,
      };
    }
    out[id] = next;
  }
  return out;
}

/** Load once at startup. Corrupt storage falls back to defaults, never throws. */
export async function bootstrapChatPrefs(): Promise<void> {
  if (booted) return;
  booted = true;
  try {
    const raw = await SecureStore.getItemAsync(STORAGE_KEY);
    if (!raw) return;
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === 'object') {
      prefs = normalize(parsed);
      emit();
    }
  } catch {
    /* unreadable or malformed — start clean rather than block the app */
  }
}

async function persist() {
  try {
    await SecureStore.setItemAsync(STORAGE_KEY, JSON.stringify(prefs));
  } catch {
    /* keep the in-memory value; the toggle still works this session */
  }
}

export function getChatPrefs(chatId: string): ChatPrefs {
  return { ...DEFAULTS, ...(prefs[chatId] ?? {}) };
}

export function setChatPref<K extends keyof ChatPrefs>(
  chatId: string,
  key: K,
  value: ChatPrefs[K],
): void {
  prefs[chatId] = { ...getChatPrefs(chatId), [key]: value };
  emit();
  void persist();
}

export function setChatWallpaper(chatId: string, wallpaper?: ChatWallpaper): void {
  const previous = prefs[chatId]?.wallpaper?.imageUri;
  const next = { ...getChatPrefs(chatId), wallpaper };
  prefs[chatId] = next;
  emit();
  void persist();
  if (previous && previous !== wallpaper?.imageUri && !Object.values(prefs).some((p) => p.wallpaper?.imageUri === previous)) {
    deleteThemeImage(previous);
  }
}

/** Drop a chat's prefs when the chat itself is deleted. */
export function forgetChatPrefs(chatId: string): void {
  if (!prefs[chatId]) return;
  const previous = prefs[chatId].wallpaper?.imageUri;
  delete prefs[chatId];
  emit();
  void persist();
  if (previous && !Object.values(prefs).some((p) => p.wallpaper?.imageUri === previous)) {
    deleteThemeImage(previous);
  }
}

export function listChatWallpaperUris(): string[] {
  return Object.values(prefs)
    .map((entry) => entry.wallpaper?.imageUri)
    .filter((uri): uri is string => !!uri);
}

export function useChatPrefs(chatId: string | undefined): ChatPrefs {
  const all = useSyncExternalStore(
    subscribe,
    () => prefs,
    () => prefs,
  );
  return chatId ? { ...DEFAULTS, ...(all[chatId] ?? {}) } : DEFAULTS;
}

/** Locked chats hide their preview in the list. */
export function useLockedChatIds(): Set<string> {
  const all = useSyncExternalStore(
    subscribe,
    () => prefs,
    () => prefs,
  );
  return new Set(Object.keys(all).filter((id) => all[id]?.locked));
}

/**
 * Drop the in-memory prefs on sign-out.
 *
 * The persisted copy stays: these describe chats, and the same chat can be
 * returned to. Clearing the cache forces a reload so one account never reads
 * the map another account left in memory.
 */
export function resetChatPrefsCache(): void {
  prefs = {};
  booted = false;
  emit();
}
