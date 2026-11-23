/** Whether a locked chat's history may be opened in this session. */
export function canOpenChat(
  chatId: string,
  lockedChatIds: ReadonlySet<string>,
  revealedChatIds: ReadonlySet<string>,
): boolean {
  return !lockedChatIds.has(chatId) || revealedChatIds.has('*') || revealedChatIds.has(chatId);
}

/** Locked chats must not identify a sender or preview text through a push. */
export function canNotifyForChat(isLocked: boolean, isRevealed: boolean): boolean {
  return !isLocked || isRevealed;
}

/** Search reveals a matching identity only; opening it still requires the code. */
export function findLockedChatMatches<T extends {
  id: string;
  type: string;
  is_self?: boolean;
  name: string;
  username?: string | null;
}>(
  chats: T[],
  lockedChatIds: ReadonlySet<string>,
  revealedChatIds: ReadonlySet<string>,
  query: string,
): T[] {
  const needle = query.trim().toLowerCase();
  if (needle.length < 2) return [];
  return chats.filter((chat) => {
    if (chat.type !== 'direct' || chat.is_self || !lockedChatIds.has(chat.id) || revealedChatIds.has(chat.id)) {
      return false;
    }
    const username = (chat.username ?? '').replace(/^@/, '').toLowerCase();
    return chat.name.toLowerCase().includes(needle) || username.includes(needle);
  });
}
