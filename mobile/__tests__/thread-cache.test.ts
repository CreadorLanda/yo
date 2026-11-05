import { beforeEach, expect, test } from 'bun:test';

import type { Message } from '@/data/mock';
import {
  claimPrefetch,
  forgetThread,
  peekThread,
  rememberThread,
  resetThreads,
} from '@/data/thread-cache';

const m = (id: string) => ({ id, text: id }) as Message;

beforeEach(resetThreads);

test('a chat that was seen opens with its messages', () => {
  rememberThread('c', [m('1'), m('2')], {});
  expect(peekThread('c')?.messages.map((x) => x.id)).toEqual(['1', '2']);
});

test('a pending bubble is left to the outbox', () => {
  rememberThread('c', [m('1'), m('tmp_a')], {});
  expect(peekThread('c')?.messages.map((x) => x.id)).toEqual(['1']);
});

test('keeps the newest messages of a long thread', () => {
  const all = Array.from({ length: 80 }, (_, i) => m(String(i + 1)));
  rememberThread('c', all, {});
  const kept = peekThread('c')?.messages ?? [];
  expect(kept.length).toBe(50);
  expect(kept[kept.length - 1].id).toBe('80');
});

test('the least recent chat goes first', () => {
  for (let i = 0; i < 31; i += 1) rememberThread(`c${i}`, [m('1')], {});
  expect(peekThread('c0')).toBeUndefined();
  expect(peekThread('c30')).toBeDefined();
});

test('a thread with nothing delivered holds nothing', () => {
  rememberThread('c', [m('1')], {});
  rememberThread('c', [m('tmp_a')], {});
  expect(peekThread('c')).toBeUndefined();
});

test('an empty chat is read from disk only once', () => {
  expect(claimPrefetch('c')).toBe(true);
  expect(claimPrefetch('c')).toBe(false);
});

test('a chat already in memory is not read again', () => {
  rememberThread('c', [m('1')], {});
  expect(claimPrefetch('c')).toBe(false);
});

test('forgetting a chat clears it, and logout clears everything', () => {
  rememberThread('a', [m('1')], {});
  rememberThread('b', [m('1')], {});
  forgetThread('a');
  expect(peekThread('a')).toBeUndefined();
  resetThreads();
  expect(peekThread('b')).toBeUndefined();
});
