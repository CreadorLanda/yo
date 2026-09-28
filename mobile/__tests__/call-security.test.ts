import { expect, test } from 'bun:test';

import { getCallSecurityState } from '../data/call-security';

test('group calls without a media key are labeled as unencrypted', () => {
  expect(getCallSecurityState(true, null)).toBe('group-unencrypted');
});

test('one-to-one calls with a media key are labeled as end-to-end encrypted', () => {
  expect(getCallSecurityState(false, 'shared-key')).toBe('encrypted');
});

test('a call without a media key is never labeled as encrypted', () => {
  expect(getCallSecurityState(false, null)).toBe('unencrypted');
});
