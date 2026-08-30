import { expect, test } from 'bun:test';

import { hasExhaustedRetries, MAX_SEND_ATTEMPTS } from '@/data/outbox-policy';

/**
 * The give-up boundary for a queued send.
 *
 * Kept as a standalone function specifically so this is checkable without a
 * database or a network — the retry loop itself (data/outbox.ts) needs both,
 * but whether a given attempt count means "try again" or "stop and ask the
 * user to retry" does not.
 */
test('não desiste antes do limite de tentativas', () => {
  expect(hasExhaustedRetries(0)).toBe(false);
  expect(hasExhaustedRetries(MAX_SEND_ATTEMPTS - 1)).toBe(false);
});

test('desiste ao atingir o limite de tentativas', () => {
  expect(hasExhaustedRetries(MAX_SEND_ATTEMPTS)).toBe(true);
  expect(hasExhaustedRetries(MAX_SEND_ATTEMPTS + 1)).toBe(true);
});
