import { expect, test } from 'bun:test';

import { blockedGroupNoticeKey, groupMemberRemovalLabel } from '@/data/group-membership-policy';

test('blocked member notice is absent, singular, or plural for zero, one, and many', () => {
  expect(blockedGroupNoticeKey(0)).toBeUndefined();
  expect(blockedGroupNoticeKey(1)).toBe('blocked.in_group_one');
  expect(blockedGroupNoticeKey(2)).toBe('blocked.in_group_many');
  expect(blockedGroupNoticeKey(3)).toBe('blocked.in_group_many');
});

test('group removal and leave events render the actor and target without placeholders', () => {
  const translate = (key: string, values: { actor?: string; member: string }) =>
    key === 'chat.group_member_left'
      ? `${values.member} left the group`
      : `${values.actor} removed ${values.member}`;

  expect(groupMemberRemovalLabel('admin-id', 'member-id', 'Ana', 'Bia', translate)).toBe(
    'Ana removed Bia',
  );
  expect(groupMemberRemovalLabel('member-id', 'member-id', 'Bia', 'Bia', translate)).toBe(
    'Bia left the group',
  );
});
