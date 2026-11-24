export function blockedGroupNoticeKey(
  count: number,
): 'blocked.in_group_one' | 'blocked.in_group_many' | undefined {
  if (count === 1) return 'blocked.in_group_one';
  if (count > 1) return 'blocked.in_group_many';
  return undefined;
}

export function groupMemberRemovalLabel(
  actorId: string,
  targetId: string,
  actor: string,
  member: string,
  translate: (
    key: 'chat.group_member_left' | 'chat.group_member_removed',
    values: { actor?: string; member: string },
  ) => string,
): string {
  return actorId === targetId
    ? translate('chat.group_member_left', { member })
    : translate('chat.group_member_removed', { actor, member });
}

/**
 * Who a membership event is about.
 *
 * Someone who left or was removed is no longer in the roster, so looking
 * them up there finds nobody. The server writes their name into the event
 * for exactly that reason; the roster is only the fallback for older events.
 * The one exception is the reader's own departure, which reads as "You".
 */
export function groupEventTargetName(
  target: { id?: string; snapshotName?: string; isYou: boolean },
  lookup: (id: string | undefined) => string,
  you: string,
): string {
  if (target.isYou) return you;
  return target.snapshotName || lookup(target.id);
}
