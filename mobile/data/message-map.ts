import { decodeMediaContent, mediaFileURL } from '@/data/api/media';
import type { MessageDTO, ReactionDTO } from '@/data/api/messages';
import {
  decryptFromGroup,
  decryptFromPeer,
  isEnvelope,
  isGroupEnvelope,
  syncGroupKeys,
} from '@/data/crypto';
import type { MediaAttachment, Message, MessageAttachment } from '@/data/mock';
import { t } from '@/i18n';

/**
 * On-screen size of a sticker bubble, shared by send and reload paths.
 * Roughly matches what other messengers use — 160 read as oversized.
 */
export const STICKER_BUBBLE_SIZE = 124;

/** Best-guess container for a message type, used for cache file naming. */
function mimeForType(mt: string): string {
  if (mt === 'image') return 'image/jpeg';
  if (mt === 'video') return 'video/mp4';
  if (mt === 'audio') return 'audio/mp4';
  return 'application/octet-stream';
}

/** Map API message → UI Message used by the chat screen. */
export function mapApiMessage(m: MessageDTO, meId?: string | null): Message {
  const deleted = !!m.deleted_at;
  const base: Message = {
    id: String(m.id),
    text: deleted ? '' : m.content,
    fromMe: !!meId && m.sender_id === meId,
    timestamp: formatMsgTime(m.created_at),
    // A message whose sender deleted their account keeps its place in the
    // conversation and loses its name. Falling through to the chat title would
    // be worse than blank: it would attribute the message to whoever is left.
    senderName: m.sender_id ? m.sender_name : t('chat.deleted_user'),
    senderId: m.sender_id,
    replyToId: m.reply_to_id,
    senderAvatarUri: m.sender_avatar,
    edited: !!m.edited_at,
    deletedAt: m.deleted_at,
    status: m.read_by && m.read_by > 0 ? 'read' : m.delivered_to && m.delivered_to > 0 ? 'delivered' : 'sent',
    isUnread: m.is_unread,
    isStarred: m.is_starred,
    expiresAt: m.expires_at,
    // The whole limited-view feature was a UI flag nothing ever set: the
    // server has tracked the limit from the start and the client read
    // neither field, so a "view once" opened forever.
    // A call leaves a row in the thread. The content is the call id and mode;
    // the outcome is resolved from the call log when rendering, because it
    // changes after the message is written.
    call:
      m.message_type === 'call'
        ? (() => {
            try {
              const p = JSON.parse(m.content) as { call_id?: string; mode?: string };
              return p.call_id
                ? { callId: p.call_id, mode: p.mode === 'video' ? 'video' : 'voice' }
                : undefined;
            } catch {
              return undefined;
            }
          })()
        : undefined,
    viewOnce: m.view_limit != null,
    viewsLeft: m.views_left,
    viewed: m.view_limit != null && (m.views_left ?? 1) <= 0,

    forwardCount: m.forward_count ?? 0,
    sourceChannelId: m.source_channel_id,
    sourcePostId: m.source_post_id,
  };
  if (deleted) return base;

  // System notices carry a machine-readable body, so the client can render
  // them in the reader's language and name the actor from their own list
  // rather than showing a sentence the server guessed at.
  if ((m.message_type || '').toLowerCase() === 'system') {
    const parts = m.content.split(':');
    if (parts[0] === 'disappearing' && parts.length >= 3) {
      return {
        ...base,
        text: '',
        system: true,
        systemEvent: {
          kind: 'disappearing',
          seconds: Number(parts[1]) || 0,
          actorId: parts[2],
        },
      };
    }
    return { ...base, text: '', system: true, systemEvent: { kind: 'joined' } };
  }


  const mt = (m.message_type || 'text').toLowerCase();
  if (mt === 'image' || mt === 'video' || mt === 'audio') {
    const decoded = decodeMediaContent(m.content);
    if (decoded) {
      const media: MediaAttachment = {
        type: mt as 'image' | 'video' | 'audio',
        uri: mediaFileURL(decoded.url),
        // Present only for encrypted blobs; older messages have none.
        key: decoded.key && decoded.nonce ? { key: decoded.key, nonce: decoded.nonce } : null,
        // The wire type is opaque for encrypted blobs, so the cache needs
        // the real one to pick a file extension the players understand.
        mime: mimeForType(mt),
      };
      return {
        ...base,
        text: decoded.caption,
        media,
      };
    }
  }

  // Stickers and documents also carry encoded media content. Without these
  // the JSON envelope fell through to `text` and rendered as raw
  // {"url":…,"caption":…} once the message came back from the server.
  if (mt === 'sticker') {
    const decoded = decodeMediaContent(m.content);
    if (decoded) {
      return {
        ...base,
        text: '',
        attachment: {
          kind: 'sticker',
          uri: mediaFileURL(decoded.url),
          width: STICKER_BUBBLE_SIZE,
          height: STICKER_BUBBLE_SIZE,
        },
      };
    }
  }

  // Rich attachments round-trip as JSON in the body.
  if (mt === 'location' || mt === 'contact' || mt === 'poll' || mt === 'event' || mt === 'game') {
    try {
      const parsed = JSON.parse(m.content) as MessageAttachment;
      if (parsed?.kind === 'poll' && m.poll_votes) {
        // Counts live in their own table, not in the body — the body is
        // end-to-end encrypted, so it could never carry a shared tally.
        // Whatever numbers the author happened to serialise are stale.
        const tally = m.poll_votes;
        return {
          ...base,
          text: '',
          attachment: {
            ...parsed,
            options: parsed.options.map((o) => ({
              ...o,
              votes: tally.counts[o.id] ?? 0,
              voted: tally.mine.includes(o.id),
            })),
          },
        };
      }
      if (parsed?.kind) return { ...base, text: '', attachment: parsed };
    } catch {
      /* fall through to plain text */
    }
  }

  if (mt === 'document') {
    const decoded = decodeMediaContent(m.content);
    if (decoded) {
      const name = decoded.caption || 'file';
      const ext = name.includes('.') ? name.split('.').pop()!.toUpperCase() : '';
      return {
        ...base,
        text: '',
        attachment: {
          kind: 'document',
          name,
          ext,
          sizeLabel: '',
          // Carried so the row can fetch and decrypt on demand.
          url: mediaFileURL(decoded.url),
          key: decoded.key && decoded.nonce ? { key: decoded.key, nonce: decoded.nonce } : null,
        },
      };
    }
  }
  // Client-E2EE envelope: keep ciphertext until async decrypt fills in.
  if (isEnvelope(m.content)) {
    return { ...base, text: '🔒 …' };
  }
  return base;
}

/**
 * Decrypt envelope content when possible. For outbound messages we decrypt
 * with the peer's session (same root key). Returns original text on failure.
 */
export async function decryptMessageContent(
  m: MessageDTO,
  meId?: string | null,
  peerUserId?: string | null,
): Promise<string> {
  // A group envelope opens with a sender key, not a pairwise session. When
  // the key has not arrived yet we fetch and retry once, rather than handing
  // back the ciphertext to be rendered as gibberish.
  if (isGroupEnvelope(m.content)) {
    const chatId = String(m.chat_id);
    const first = await decryptFromGroup(chatId, m.content);
    if (first != null) return first;
    try {
      await syncGroupKeys(chatId);
    } catch {
      return '[encrypted]';
    }
    return (await decryptFromGroup(chatId, m.content)) ?? '[encrypted]';
  }

  if (!isEnvelope(m.content)) return m.content;
  // For messages we sent, peer is the other party; for received, sender is
  // peer. A message with no sender has no session to look up: the account is
  // gone and so is the pairwise state, so it stays sealed.
  const sessionPeer =
    meId && m.sender_id === meId ? peerUserId ?? undefined : m.sender_id;
  if (!sessionPeer) return m.content;
  try {
    return await decryptFromPeer(sessionPeer, m.content);
  } catch {
    return '[encrypted]';
  }
}

export function formatMsgTime(iso: string): string {
  try {
    return new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  } catch {
    return '';
  }
}

/** Collapse reaction rows into the UI shape { emoji, count, mine }. */
export function collapseReactions(
  rows: ReactionDTO[],
  meId?: string | null,
): { emoji: string; count: number; mine: boolean }[] {
  const map = new Map<string, { emoji: string; count: number; mine: boolean }>();
  for (const r of rows) {
    const cur = map.get(r.emoji) ?? { emoji: r.emoji, count: 0, mine: false };
    cur.count += 1;
    if (meId && r.user_id === meId) cur.mine = true;
    map.set(r.emoji, cur);
  }
  return Array.from(map.values());
}

/** Numeric server id if the bubble id is an API id; null for optimistic temps. */
export function serverMessageId(id: string): number | null {
  if (!/^\d+$/.test(id)) return null;
  const n = Number(id);
  return Number.isFinite(n) ? n : null;
}
