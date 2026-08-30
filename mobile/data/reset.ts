import { resetChatPrefsCache } from './chat-prefs';
import { resetChatStore } from './chat-store';
import { resetIncomingCall } from './incoming-call';
import { resetBlocks } from './block-store';
import { resetLives } from './live-store';
import { unregisterPushWithServer } from './push';
import { resetDialogs } from './dialog-store';
import { resetAppLock } from './app-lock';
import { relockAll } from './chat-lock';
import { clearE2EEState } from './crypto';
import { wipeLocalHistory } from './db/messages';
import { resetFilterStore } from './filter-store';
import { resetGroupStore } from './group-store';
import { clearMediaCache } from './media-cache';
import { resetStickerStore } from './sticker-store';
import { resetStoryStore } from './story-store';

/**
 * Everything that has to go when a session ends.
 *
 * Each store keeps its state in module-level variables, which outlive the
 * account that filled them — signing in as someone else inherited the
 * previous user's chats, lists, groups and stories. The story feed made it
 * visible: `isOwn` is decided when a story is fetched, so every one of the
 * previous account's stories came back marked as the new user's own.
 *
 * Collected in one place because the failure is silent and the fix is easy
 * to forget: two of these reset functions already existed and had never been
 * called from anywhere. A new store should be added here at the same time it
 * is written.
 *
 * Nothing here may throw. Logout has to finish even if a piece of it fails,
 * or a user is left signed in to an account they asked to leave.
 */
export async function resetAllStores(): Promise<void> {
  const steps: [string, () => void | Promise<unknown>][] = [
    // First: it needs the session that the rest of this is about to erase.
    ['push token', unregisterPushWithServer],
    ['dialogs', resetDialogs],
    ['incoming call', resetIncomingCall],
    ['lives', resetLives],
    ['blocks', resetBlocks],
    ['chats', resetChatStore],
    ['chat prefs', resetChatPrefsCache],
    ['locks', relockAll],
    ['app-lock', resetAppLock],
    ['filters', resetFilterStore],
    ['groups', resetGroupStore],
    ['stickers', resetStickerStore],
    ['stories', resetStoryStore],
    ['e2ee', clearE2EEState],
    ['local history', wipeLocalHistory],
    ['media cache', clearMediaCache],
  ];

  for (const [name, run] of steps) {
    try {
      await run();
    } catch (err) {
      // Report and carry on: a store that refuses to clear must not keep
      // the rest of the session alive.
      console.warn(`[reset] ${name} failed to clear:`, err);
    }
  }
}
