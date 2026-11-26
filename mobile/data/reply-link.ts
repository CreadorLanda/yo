import type { Message } from '@/data/mock';

/**
 * Fill in each reply's quote from the message it points at.
 *
 * The server returns only `reply_to_id` — it cannot return the quoted text,
 * because the text is encrypted and it never sees it. So the quote is
 * reconstructed here, from messages already decrypted on this device.
 *
 * Without this a reply showed its quote only while the optimistic bubble was
 * on screen: the moment the server's version replaced it, the quote vanished,
 * and a thread loaded from history had no quotes at all.
 */
export function linkReplies(list: Message[]): Message[] {
  const byId = new Map<string, Message>();
  for (const m of list) byId.set(m.id, m);

  return list.map((m) => {
    if (!m.replyToId || m.replyTo) return m;
    const target = byId.get(String(m.replyToId));
    // A reply to something older than the loaded page, or to a message since
    // deleted, keeps its pointer and simply renders without a quote.
    if (!target) return m;
    return {
      ...m,
      replyTo: {
        id: target.id,
        text: target.text,
        fromMe: target.fromMe,
        senderName: target.senderName,
      },
    };
  });
}

/**
 * Add one message that arrived live, with its quote filled in from what is
 * already on screen (#367). The history path links a whole page at once;
 * a live reply needs the same, or it shows no quote until the chat reopens.
 */
export function appendLinked(list: Message[], message: Message): Message[] {
  return [...list, linkReplies([...list, message])[list.length]];
}
