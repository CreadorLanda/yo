import type { ChatDTO } from '@/data/api/messages';

/** Resolve the human-facing identity for a chat in every list and header. */
export function displayChatName(
  chat: Pick<ChatDTO, 'is_self' | 'title' | 'peer_username'>,
  selfLabel: string,
  fallback: string,
): string {
  if (chat.is_self) return selfLabel;
  return chat.title ?? chat.peer_username ?? fallback;
}
