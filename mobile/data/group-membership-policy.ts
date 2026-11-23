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
