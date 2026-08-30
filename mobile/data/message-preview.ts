/**
 * What a message looks like in a one-line list.
 *
 * This exists because the same bug has now happened twice. The chat list used
 * to render `{"kind":"poll",…}` for polls; cases were added for poll and
 * event, and the hole was left open. `call`, `game` and `system` fell through
 * it afterwards — a call row's content is `{"call_id":…,"mode":"video"}` and a
 * system notice's is `disappearing:60:<uuid>`, and both were shown to people
 * verbatim.
 *
 * So the fix is not four more cases. It is two things the previous version did
 * not have:
 *
 *   1. An exhaustive map. `MESSAGE_TYPES` is every type the server can store,
 *      and [previewShape] switches over all of them with a `never` check, so
 *      adding a fifteenth type without deciding how it reads is a compile
 *      error rather than a leak someone notices in production.
 *   2. [isMachineText], the net underneath. Even a type that slips through
 *      cannot put JSON or a colon-delimited record in front of somebody.
 *
 * Pure — no i18n, no React. Callers get a key and translate it.
 */

/** Every message_type the server stores. Mirrors MessageType in Go. */
export const MESSAGE_TYPES = [
  'text',
  'image',
  'video',
  'audio',
  'document',
  'sticker',
  'location',
  'contact',
  'poll',
  'event',
  'system',
  'reply',
  'game',
  'call',
] as const;

export type MessageTypeName = (typeof MESSAGE_TYPES)[number];

export type PreviewShape =
  /** A fixed label. `icon` is an emoji; `key` an i18n key. */
  | { kind: 'label'; icon: string; key: string }
  /** A label the message's own caption may replace, when it has one. */
  | { kind: 'captioned'; icon: string; key: string }
  /** Show the message text itself, once decrypted. */
  | { kind: 'text' };

export function isKnownMessageType(t: string | undefined): t is MessageTypeName {
  return !!t && (MESSAGE_TYPES as readonly string[]).includes(t);
}

export function previewShape(messageType: string | undefined): PreviewShape {
  if (!isKnownMessageType(messageType)) {
    // A type this build has never heard of. Treated as text so the net in
    // [isMachineText] gets the final say, rather than guessing at a label.
    return { kind: 'text' };
  }

  switch (messageType) {
    case 'text':
    case 'reply':
      return { kind: 'text' };
    case 'image':
      return { kind: 'captioned', icon: '\u{1F4F7}', key: 'chat.photo' };
    case 'video':
      return { kind: 'captioned', icon: '\u{1F3A5}', key: 'chat.video' };
    case 'audio':
      return { kind: 'label', icon: '\u{1F3B5}', key: 'chat.attach_audio' };
    case 'document':
      return { kind: 'label', icon: '\u{1F4C4}', key: 'chat.attach_document' };
    case 'sticker':
      return { kind: 'label', icon: '\u{1F9E9}', key: 'chat.sticker' };
    case 'location':
      return { kind: 'label', icon: '\u{1F4CD}', key: 'chat.attach_location' };
    case 'contact':
      return { kind: 'label', icon: '\u{1F464}', key: 'chat.attach_contact' };
    case 'poll':
      return { kind: 'label', icon: '\u{1F4CA}', key: 'chat.poll_label' };
    case 'event':
      return { kind: 'label', icon: '\u{1F4C5}', key: 'chat.event_label' };
    case 'game':
      return { kind: 'label', icon: '\u{1F3AE}', key: 'chat.game_label' };
    case 'call':
      return { kind: 'label', icon: '\u{1F4DE}', key: 'chat.call_label' };
    case 'system':
      return { kind: 'label', icon: '\u{2139}\u{FE0F}', key: 'chat.system_label' };
    default: {
      // Adding a type to MESSAGE_TYPES without a case fails to compile here.
      const exhaustive: never = messageType;
      return exhaustive;
    }
  }
}

/**
 * Whether a string is a record rather than something a person wrote.
 *
 * The last line of defence, and deliberately conservative: it is far worse to
 * show `{"call_id":"9f2c…"}` to somebody than to fall back to a generic word
 * for a message that merely happened to start with a brace.
 *
 * Three shapes, all of which have appeared in this list:
 *   - JSON objects and arrays — attachments, polls, games, call rows
 *   - the E2EE envelope, when decryption failed or has not run yet
 *   - `key:value:value` system records like `disappearing:60:<uuid>`
 */
export function isMachineText(text: string): boolean {
  const s = text.trim();
  if (!s) return false;

  if ((s.startsWith('{') && s.endsWith('}')) || (s.startsWith('[') && s.endsWith(']'))) {
    return true;
  }
  // Envelope prefix. Rendering ciphertext is the same failure wearing a hat.
  if (s.startsWith('soc1.')) return true;

  // A colon-delimited record with no spaces: `disappearing:60:<uuid>`. The
  // space check is what keeps "18:30: on my way" out of it.
  if (!/\s/.test(s) && s.split(':').length >= 3) return true;

  return false;
}
