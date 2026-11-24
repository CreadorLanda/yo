import * as Notifications from 'expo-notifications';

import { decryptMessageContent } from '@/data/message-map';
import { bootstrapAuth, getCurrentUser } from '@/data/auth-store';
import { bootstrapChatPrefs, getChatPrefs } from '@/data/chat-prefs';
import { canNotifyForChat } from '@/data/chat-lock-policy';
import { isRevealed } from '@/data/chat-lock';
import { t } from '@/i18n';

/**
 * Build a message notification on the device.
 *
 * The server sends these as data only, with no text, because it has none to
 * send: the message is end-to-end encrypted and it cannot read it. It used to
 * put `msg.Content` in the notification body under a comment claiming the
 * content was already decrypted — so what people saw was the `soc1.` envelope.
 *
 * The key is here, so the notification is built here.
 */

/** What the server puts in the data payload of a message push. */
export type MessagePushData = {
  type?: string;
  chat_id?: string;
  message_id?: string;
  sender_id?: string;
  sender_name?: string;
  sender_avatar?: string;
  content?: string;
  encrypted?: string;
};

/**
 * The chat currently on screen, if any.
 *
 * The server now pushes even to someone holding a websocket — being connected
 * means the app is running, not that this conversation is open, and someone
 * reading a different thread was missing the message that mattered. Only the
 * client knows which chat is in front of the reader, so only the client can
 * decide to stay quiet.
 */
let openChatId: string | null = null;

export function setOpenChat(chatId: string | null): void {
  openChatId = chatId;
}

/**
 * Turn a data-only message push into a notification someone can read.
 *
 * Returns false when nothing was shown, so a caller can tell "handled" from
 * "not mine to handle".
 */
export async function presentMessageNotification(data: MessagePushData): Promise<boolean> {
  if (data?.type !== 'message.new' || !data.chat_id) return false;
  const me = (getCurrentUser() ?? await bootstrapAuth())?.id;
  if (!me) return false;

  // Read device-local lock settings before decrypting or scheduling a push.
  // If secure storage cannot be read, stay silent rather than risk exposing a
  // locked conversation through the sender name or message body.
  if (!(await bootstrapChatPrefs())) return false;
  if (!canNotifyForChat(getChatPrefs(data.chat_id).locked, isRevealed(data.chat_id))) return false;

  // Never notify about the conversation the reader is looking at.
  if (openChatId && openChatId === data.chat_id) return false;

  // Nor about your own message, which arrives on your other devices.
  if (data.sender_id === me) return false;

  let body = data.content ?? '';
  if (data.encrypted === '1' && data.content) {
    try {
      body = await decryptMessageContent(
        {
          id: Number(data.message_id ?? 0),
          chat_id: data.chat_id,
          sender_id: data.sender_id ?? '',
          content: data.content,
          message_type: 'text',
          created_at: new Date().toISOString(),
        } as never,
        me ?? null,
        data.sender_id ?? null,
      );
    } catch {
      // A message we cannot open is still worth announcing — silence would
      // hide it entirely — but it must not show the envelope.
      body = t('push.new_message');
    }
  }

  // A media message arrives as JSON with a path inside. Announcing that raw
  // would be the same mistake in a different shape.
  if (body.trim().startsWith('{')) body = t('push.sent_attachment');
  if (!body.trim()) body = t('push.new_message');

  await Notifications.scheduleNotificationAsync({
    content: {
      title: data.sender_name || t('call.someone'),
      body: body.length > 140 ? `${body.slice(0, 137)}…` : body,
      data: { type: 'message.new', chat_id: data.chat_id, message_id: data.message_id },
      categoryIdentifier: 'yo.message',
    },
    trigger: null,
  });
  return true;
}
