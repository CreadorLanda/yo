import * as SecureStore from 'expo-secure-store';

import { ACCESS_KEY, api, BASE_URL } from './client';

export type ChatStatus = 'active' | 'pending' | 'blocked';

export interface ChatDTO {
  id: string;
  type: 'direct' | 'group';
  title?: string;
  avatar_url?: string;
  created_by: string;
  status?: ChatStatus;
  created_at: string;
  last_message?: {
    content: string;
    /** Lets the list label non-text messages instead of showing the payload. */
    message_type?: string;
    /** Absent when the sender deleted their account. */
    sender_id?: string;
    created_at: string;
  };
  unread_count: number;
  /** Direct chat peer — used for client-side E2EE. */
  peer_user_id?: string;
  peer_username?: string;
  /**
   * Presence, and only as much as the server decided this viewer may know.
   * Both absent when they may not know at all; `peer_last_seen` absent on
   * its own for someone who has never been seen, which is a different thing.
   */
  peer_online?: boolean;
  peer_last_seen?: string;
  /** Per-user settings. Present only when set; two participants can differ. */
  pinned_at?: string;
  muted_until?: string;
  archived_at?: string;
  /** 0 = off. Each message's clock starts when it is read. */
  disappear_seconds?: number;
}

export interface ChatSettings {
  pinned?: boolean;
  muted?: boolean;
  archived?: boolean;
}

export interface ListChatsParams {
  limit?: number;
  offset?: number;
  archived?: boolean;
}

export interface MessageDTO {
  id: number;
  /** Set when the sender limited how many times it may be opened. */
  view_limit?: number;
  /** Opens the current user has left; only meaningful with view_limit. */
  views_left?: number;
  /**
   * Reactions on this message.
   *
   * Sent with history now. They used to arrive only over the websocket, so
   * every reaction disappeared the moment the chat was reopened — stored on
   * the server, invisible to the reader.
   */
  reactions?: ReactionDTO[];
  chat_id: string;
  /**
   * Absent when the sender deleted their account.
   *
   * The message stays — it belongs to the conversation it was sent to — but
   * there is nobody left to attribute it to. Every comparison against a
   * missing id fails, which is the right answer: nobody is its sender.
   */
  sender_id?: string;
  content: string;
  message_type: string;
  reply_to_id?: number;
  created_at: string;
  edited_at?: string;
  deleted_at?: string;
  sender_name?: string;
  sender_avatar?: string;
  delivered_to?: number;
  read_by?: number;
  /** Set once read, in a chat with a timer. The countdown runs to this. */
  expires_at?: string;
  /** 0 when written here; 1+ once it has been passed along. */
  forward_count?: number;
  /** Set when a channel post was forwarded here, so we can link back. */
  source_channel_id?: string;
  source_post_id?: string;
  /** Present on poll messages; the body itself stays end-to-end encrypted. */
  poll_votes?: PollTally;
}

export type ReceiptStatus = 'delivered' | 'read';

export interface ReactionDTO {
  message_id: number;
  user_id: string;
  emoji: string;
  created_at: string;
}

/** Realtime event envelope from GET /api/ws */
export interface RealtimeEvent {
  type: string;
  chat_id?: string;
  payload?: unknown;
}

/** Create a direct chat with a user */
export function createChat(peerUserId: string) {
  return api.post<{ chat_id: string; chat: ChatDTO }>('/api/chats', {
    peer_user_id: peerUserId,
  });
}

/** List one page of chats for the current user, newest-active first. */
export function listChats(params: ListChatsParams = {}) {
  const q = new URLSearchParams();
  if (params.limit != null) q.set('limit', String(params.limit));
  if (params.offset != null) q.set('offset', String(params.offset));
  if (params.archived) q.set('archived', 'true');
  const qs = q.toString();
  return api.get<ChatDTO[]>(`/api/chats${qs ? `?${qs}` : ''}`);
}

/** Toggle pin / mute / archive for the caller only. Omitted fields are untouched. */
export function updateChatSettings(chatId: string, settings: ChatSettings) {
  return api.patch<ChatDTO>(`/api/chats/${chatId}/settings`, settings);
}

/** Hide existing messages for the caller only; the peer keeps their copy. */
/** The durations the server accepts. Anything else is refused. */
export const DISAPPEAR_OPTIONS = [0, 3600, 86400, 604800, 2592000] as const;

/**
 * Set the disappearing timer for a chat.
 *
 * Any participant may: it is a property of the conversation, and both people
 * live with it. The clock on each message starts when it is read, not when
 * it is sent.
 */
export function setDisappearing(chatId: string, seconds: number) {
  return api.put<void>(`/api/chats/${chatId}/disappearing`, {
    disappear_seconds: seconds,
  });
}

export function clearChatHistory(chatId: string) {
  return api.post<void>(`/api/chats/${chatId}/clear`, {});
}

/** Remove the chat from the caller's list. It returns if the peer writes again. */
export function deleteChat(chatId: string) {
  return api.del<void>(`/api/chats/${chatId}`);
}

/** Send a message in a chat */
export type MessageOrigin = {
  /**
   * The count carried by the content being forwarded. The server stores one
   * more than this, so it cannot be used to reset a long chain.
   */
  forwardCount?: number;
  sourceChannelId?: string;
  sourcePostId?: string;
};

export function sendMessage(
  chatId: string,
  content: string,
  messageType?: string,
  replyToId?: number,
  viewLimit?: number | null,
  origin?: MessageOrigin,
) {
  return api.post<MessageDTO>(`/api/chats/${chatId}/messages`, {
    content,
    message_type: messageType ?? 'text',
    reply_to_id: replyToId,
    view_limit: viewLimit ?? undefined,
    forward_count: origin?.forwardCount,
    source_channel_id: origin?.sourceChannelId,
    source_post_id: origin?.sourcePostId,
  });
}

/**
 * Consume one view of a limited-view message.
 *
 * Deliberately separate from listing: scrolling past a message must never
 * burn a view. Throws with code `views_exhausted` (HTTP 410) once used up.
 */
export function openLimitedMessage(chatId: string, messageId: number) {
  return api.post<{ view_limit: number | null; views_left: number | null }>(
    `/api/chats/${chatId}/messages/${messageId}/open`,
    {},
  );
}

export interface PollTally {
  /** Vote count per opaque client-chosen option id. */
  counts: Record<string, number>;
  /** Option ids the current user selected. */
  mine: string[];
}

/**
 * Record this user's poll selections.
 *
 * Separate from editMessage on purpose: editing belongs to the message's
 * author, so voting on someone else's poll used to come back 403. Pass an
 * empty array to withdraw a vote.
 */
export function votePoll(chatId: string, messageId: number, optionIds: string[]) {
  return api.post<PollTally>(`/api/chats/${chatId}/messages/${messageId}/vote`, {
    option_ids: optionIds,
  });
}

/** Edit own message */
export function editMessage(chatId: string, messageId: number, content: string) {
  return api.patch<MessageDTO>(`/api/chats/${chatId}/messages/${messageId}`, { content });
}

/** Soft-delete own message */
export function deleteMessage(chatId: string, messageId: number) {
  return api.del<MessageDTO>(`/api/chats/${chatId}/messages/${messageId}`);
}

/** Batch delivered/read receipts */
export function postReceipts(
  chatId: string,
  messageIds: number[],
  status: ReceiptStatus,
) {
  return api.post<void>(`/api/chats/${chatId}/receipts`, {
    message_ids: messageIds,
    status,
  });
}

/** Mark chat read up to message id */
export function markRead(chatId: string, messageId: number) {
  return api.post<void>(`/api/chats/${chatId}/read`, { message_id: messageId });
}

/**
 * Broadcast what this person is doing in the composer.
 *
 * `recording` is a different signal from `typing`, not a variant of it:
 * holding the mic looks identical from the other side and means something
 * very different to the person waiting.
 */
export function setTyping(
  chatId: string,
  typing: boolean,
  kind: 'typing' | 'recording' = 'typing',
) {
  return api.post<void>(`/api/chats/${chatId}/typing`, { typing, kind });
}

/** Add reaction */
export function addReaction(chatId: string, messageId: number, emoji: string) {
  return api.post<ReactionDTO[]>(`/api/chats/${chatId}/messages/${messageId}/reactions`, {
    emoji,
  });
}

/** Remove reaction */
export function removeReaction(chatId: string, messageId: number, emoji: string) {
  return api.del<ReactionDTO[]>(
    `/api/chats/${chatId}/messages/${messageId}/reactions?emoji=${encodeURIComponent(emoji)}`,
  );
}

export interface ReceiptDetail {
  user_id: string;
  display_name: string;
  username: string;
  status: ReceiptStatus;
  updated_at: string;
}

/** Per-recipient delivery detail. Only the sender may read this. */
export function messageInfo(chatId: string, messageId: number) {
  return api.get<ReceiptDetail[]>(`/api/chats/${chatId}/messages/${messageId}/info`);
}

/** Accept a pending friend request chat */
export function acceptChat(chatId: string) {
  return api.post<ChatDTO>(`/api/chats/${chatId}/accept`);
}

export type ReportReason = 'spam' | 'abuse' | 'scam' | 'other';

/**
 * File a moderation report against a chat.
 *
 * `block` in the same call because reporting someone and still hearing from
 * them afterwards is the outcome nobody wants; two separate taps means some
 * people only manage the first.
 */
export function reportChat(
  chatId: string,
  reason: ReportReason,
  opts: { note?: string; block?: boolean } = {},
) {
  return api.post<void>(`/api/chats/${chatId}/report`, {
    reason,
    note: opts.note ?? '',
    block: opts.block ?? false,
  });
}

/** Block/decline a chat */
export function blockChat(chatId: string) {
  return api.post<void>(`/api/chats/${chatId}/block`);
}

/** List messages in a chat (newest first, paginated) */
export function listMessages(chatId: string, limit = 50, before?: number) {
  const params = new URLSearchParams({ limit: String(limit) });
  if (before) params.set('before', String(before));
  return api.get<MessageDTO[]>(`/api/chats/${chatId}/messages?${params}`);
}

/**
 * Open the realtime WebSocket using the stored access token.
 * Returns null if there is no session.
 */
export async function connectRealtime(
  onEvent: (ev: RealtimeEvent) => void,
  onClose?: () => void,
): Promise<WebSocket | null> {
  const token = await SecureStore.getItemAsync(ACCESS_KEY);
  if (!token) return null;
  return openRealtimeWithToken(token, onEvent, onClose);
}

export function openRealtimeWithToken(
  token: string,
  onEvent: (ev: RealtimeEvent) => void,
  onClose?: () => void,
): WebSocket {
  const base = BASE_URL.replace(/^http/, 'ws');
  const ws = new WebSocket(`${base}/api/ws?token=${encodeURIComponent(token)}`);
  ws.onmessage = (e) => {
    try {
      onEvent(JSON.parse(String(e.data)) as RealtimeEvent);
    } catch {
      /* ignore malformed */
    }
  };
  ws.onclose = () => onClose?.();
  return ws;
}
