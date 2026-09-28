import type { Message } from './mock';

export type ChatSearchFilter = 'all' | 'unread' | 'starred' | 'media' | 'documents' | 'links' | 'audio';

const LINK_PATTERN = /\b(?:https?:\/\/|www\.)[^\s<>()]+/i;

export function matchesChatSearchFilter(message: Message, filter: ChatSearchFilter): boolean {
  switch (filter) {
    case 'all':
      return true;
    case 'unread':
      return message.isUnread === true && !message.fromMe;
    case 'starred':
      return message.isStarred === true;
    case 'media':
      return (
        message.media?.type === 'image' ||
        message.media?.type === 'video' ||
        message.attachment?.kind === 'sticker'
      );
    case 'documents':
      return message.attachment?.kind === 'document';
    case 'links':
      return LINK_PATTERN.test(message.text);
    case 'audio':
      return message.media?.type === 'audio';
  }
}

export function filterChatMessages(
  messages: Message[],
  query: string,
  filter: ChatSearchFilter,
): Message[] {
  const normalizedQuery = query.trim().toLowerCase();
  return messages.filter((message) => {
    if (message.system || message.deletedAt) return false;
    const searchableText = [
      message.text,
      message.attachment?.kind === 'document' ? message.attachment.name : '',
    ]
      .join(' ')
      .toLowerCase();
    if (normalizedQuery && !searchableText.includes(normalizedQuery)) return false;
    return matchesChatSearchFilter(message, filter);
  });
}
