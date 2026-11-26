import { describe, expect, test } from 'bun:test';

import { hasExhaustedRetries, MAX_SEND_ATTEMPTS, nextToSend } from '@/data/outbox-policy';

describe('nextToSend', () => {
  test('takes the oldest message still trying', () => {
    expect(nextToSend([{ id: 1, status: 'pending' }, { id: 2, status: 'pending' }])?.id).toBe(1);
  });

  test('a message that gave up does not block the ones after it (#364)', () => {
    expect(nextToSend([{ id: 1, status: 'failed' }, { id: 2, status: 'pending' }, { id: 3, status: 'pending' }])?.id).toBe(2);
  });

  test('nothing to send when every message gave up', () => {
    expect(nextToSend([{ id: 1, status: 'failed' }])).toBeUndefined();
    expect(nextToSend([])).toBeUndefined();
  });
});

test('gives up after the last attempt', () => {
  expect(hasExhaustedRetries(MAX_SEND_ATTEMPTS - 1)).toBe(false);
  expect(hasExhaustedRetries(MAX_SEND_ATTEMPTS)).toBe(true);
});
