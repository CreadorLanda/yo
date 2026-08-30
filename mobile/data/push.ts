import * as Device from 'expo-device';
import { router } from 'expo-router';
import * as Notifications from 'expo-notifications';
import * as TaskManager from 'expo-task-manager';
import { Platform } from 'react-native';

import { markRead } from '@/data/api/messages';
import {
  presentMessageNotification,
  type MessagePushData,
} from '@/data/notification-builder';
import { sendQuickReply } from '@/data/quick-reply';
import { t } from '@/i18n';
import {
  registerPushDevice,
  unregisterPushDevice,
  type NotifPlatform,
} from '@/data/api/notifications';

/**
 * Foreground presentation — show banner/sound when the app is open.
 * Must run once at module load (before any notification is received).
 */
Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowBanner: true,
    shouldShowList: true,
    shouldPlaySound: true,
    shouldSetBadge: true,
  }),
});

function platformForDevice(): NotifPlatform {
  if (Platform.OS === 'ios') return 'ios';
  if (Platform.OS === 'android') return 'android';
  if (Platform.OS === 'web') return 'web';
  return 'unknown';
}

/**
 * Ensure the Android default channel exists (required for Android 8+).
 */
async function ensureAndroidChannel(): Promise<void> {
  if (Platform.OS !== 'android') return;
  await Notifications.setNotificationChannelAsync('default', {
    name: 'Default',
    importance: Notifications.AndroidImportance.HIGH,
    vibrationPattern: [0, 250, 250, 250],
    lightColor: '#25D366',
  });
}

/**
 * Request permission and return an Expo push token when available.
 * Falls back to null on web / simulators without push support.
 */
export async function getDevicePushToken(): Promise<string | null> {
  if (Platform.OS === 'web') return null;
  // Physical device is required for real push on iOS; Android emulators can
  // still return Expo tokens in some setups — we try either way.
  if (!Device.isDevice && Platform.OS === 'ios') {
    return null;
  }

  await ensureAndroidChannel();

  const current = await Notifications.getPermissionsAsync();
  let status = current.status;
  if (status !== 'granted') {
    const requested = await Notifications.requestPermissionsAsync();
    status = requested.status;
  }
  if (status !== 'granted') {
    return null;
  }

  try {
    // The device's own FCM registration token, not an Expo one.
    //
    // An Expo token is delivered by Expo's servers, which means every
    // notification this app sends passes through a third party. The native
    // token goes straight from our server to Google, and the server already
    // routes by token shape — it has both senders and picks by prefix.
    //
    // Requires google-services.json in the build; without it Android has no
    // project to register against and this throws rather than returning a
    // token that would be silently refused later.
    const token = await Notifications.getDevicePushTokenAsync();
    return typeof token.data === 'string' ? token.data : null;
  } catch {
    // No Google Play services, or a build without the Firebase config.
    // Reported as "no token" rather than thrown: a device that cannot
    // receive push must still be able to use the app.
    return null;
  }
}

/**
 * Obtain a push token and register it with the Socialize API.
 * Safe to call multiple times (upsert on the server).
 */
export async function registerPushWithServer(): Promise<string | null> {
  const token = await getDevicePushToken();
  if (!token) return null;
  await registerPushDevice(token, platformForDevice());
  return token;
}

/**
 * Drop this device's push token on sign-out.
 *
 * Without it the server keeps a token for a device where nobody is signed
 * in, and the next person to use that phone gets notifications for an
 * account that is not theirs.
 */
export async function unregisterPushWithServer(): Promise<void> {
  try {
    // The server identifies the device from the session, not from a token we
    // hand it: it deletes the row for this user_id + device_id pair.
    //
    // Bounded, because this runs before the session is torn down and a
    // request with no deadline would leave someone stuck on a screen they
    // asked to leave. Three seconds is long enough for a real network and
    // short enough not to be felt.
    await Promise.race([
      unregisterPushDevice(),
      new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), 3000)),
    ]);
  } catch {
    // Offline, revoked, slow — sign-out continues regardless. The cost of
    // failing here is a stale token, which the server drops on its first
    // `Unregistered` response from FCM anyway.
  }
}

/** Category the server tags message pushes with, so the reply box appears. */
export const MESSAGE_CATEGORY = 'yo.message';

/**
 * Declare the reply action on message notifications.
 *
 * A category is what turns a notification into something you can act on
 * without opening the app. Registered once at startup — the OS keeps it, and
 * the server only has to name it in the payload.
 */
export async function registerNotificationActions(): Promise<void> {
  try {
    await Notifications.setNotificationCategoryAsync(MESSAGE_CATEGORY, [
      {
        identifier: 'reply',
        buttonTitle: t('push.reply'),
        textInput: {
          submitButtonTitle: t('push.send'),
          placeholder: t('push.reply_placeholder'),
        },
        options: { opensAppToForeground: false },
      },
      {
        identifier: 'mark_read',
        buttonTitle: t('push.mark_read'),
        options: { opensAppToForeground: false },
      },
    ]);
  } catch (err) {
    // Older Android versions and some launchers ignore categories. The
    // notification still arrives; it just cannot be replied to inline.
    console.warn('[push] notification actions unavailable:', err);
  }
}

/**
 * Handle a reply typed straight into the notification.
 *
 * Returns an unsubscribe function. The reply goes through the same encrypted
 * send path as the composer — see data/quick-reply. Replying from the lock
 * screen must not be a way around the encryption.
 */
export function listenForNotificationReplies(): () => void {
  const sub = Notifications.addNotificationResponseReceivedListener((response) => {
    const data = response.notification.request.content.data as
      | { chat_id?: string; message_id?: string; type?: string; mode?: string }
      | undefined;
    const chatId = data?.chat_id;
    if (!chatId) return;

    if (response.actionIdentifier === 'reply') {
      const text = (response as { userText?: string }).userText ?? '';
      if (!text.trim()) return;
      void sendQuickReply(chatId, text).catch((err) => {
        // Reaching here now means the reply was never even queued — no
        // session, or the local database would not open. A send that merely
        // fails is the outbox's problem, and it keeps the message.
        console.warn('[push] quick reply not queued:', err);
      });
      return;
    }

    // Tapping an incoming-call notification answers it. `incoming` is what
    // stops the answering phone asking the server to ring everyone again.
    if (data?.type === 'call.incoming') {
      const mode = (data as { mode?: string }).mode === 'video' ? 'video' : 'voice';
      router.push(`/call/${chatId}?mode=${mode}&incoming=1`);
      return;
    }

    if (response.actionIdentifier === 'mark_read') {
      // The id the notification was raised for. Without it there is nothing
      // to mark: the read receipt names a message, not a chat.
      const messageId = Number(data?.message_id);
      if (Number.isFinite(messageId) && messageId > 0) {
        void markRead(chatId, messageId).catch(() => {});
      }
    }
  });
  return () => sub.remove();
}


/**
 * A notification you get for signing up.
 *
 * Its real job is diagnostic. Push has three independent halves — a token
 * registered on the server, a credential the server can send with, and a
 * build that carries google-services.json — and when it is silent there is no
 * way to tell which half is missing. This fires on the one occasion the app
 * knows all three were just exercised, so a phone that stays quiet says
 * something specific.
 *
 * Local, not a round trip through FCM: the point is to confirm this device
 * can display a notification at all, before blaming the server.
 */
export async function notifyWelcome(displayName?: string): Promise<void> {
  try {
    await Notifications.scheduleNotificationAsync({
      content: {
        title: t('push.welcome_title'),
        body: displayName
          ? t('push.welcome_body_named', { name: displayName })
          : t('push.welcome_body'),
        data: { type: 'welcome' },
      },
      // Two seconds, not immediate: the account screen is still settling and
      // a notification fired mid-transition is easy to miss.
      trigger: { seconds: 2, type: Notifications.SchedulableTriggerInputTypes.TIME_INTERVAL },
    });
  } catch (err) {
    console.warn('[push] welcome notification failed:', err);
  }
}

/** Background task name — must match what registerTaskAsync is given. */
const MESSAGE_TASK = 'yo.notifications.message';

/**
 * Handle message pushes that arrive while the app is not in front.
 *
 * These are data-only: the server has no text to send, because it cannot read
 * an encrypted message. Without this task the push arrives and nothing is
 * shown at all — which is quieter than showing the ciphertext, and just as
 * useless.
 */
export function registerBackgroundMessageHandler(): void {
  try {
    TaskManager.defineTask(MESSAGE_TASK, async ({ data, error }) => {
      if (error) return;
      const payload = (data as { notification?: { data?: MessagePushData } })?.notification?.data;
      if (payload) await presentMessageNotification(payload);
    });
    void Notifications.registerTaskAsync(MESSAGE_TASK);
  } catch (err) {
    // Older Android versions and some launchers refuse the task. The app still
    // works; messages just arrive silently until it is opened.
    console.warn('[push] background handler unavailable:', err);
  }
}

/**
 * Handle message pushes that arrive while the app is open.
 *
 * The server pushes to connected clients now: being connected means the app is
 * running, not that this conversation is on screen. The builder stays quiet
 * about the chat currently being read.
 */
export function listenForForegroundMessages(): () => void {
  const sub = Notifications.addNotificationReceivedListener((n) => {
    const payload = n.request.content.data as MessagePushData | undefined;
    if (payload?.type === 'message.new') void presentMessageNotification(payload);
  });
  return () => sub.remove();
}
