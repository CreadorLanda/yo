import { describe, expect, test } from 'bun:test';

import type { MessageDTO } from '@/data/api/messages';
import {
  isSealedBody,
  mergeThread,
  reusableBody,
  sameThread,
  staleCachedIds,
  withoutExpired,
} from '@/data/message-sync';

const dto = (id: number, extra: Partial<MessageDTO> = {}): MessageDTO =>
  ({ id, chat_id: 'c', sender_id: 'u', content: `m${id}`, created_at: '', ...extra }) as MessageDTO;

describe('reusableBody', () => {
  test('reuses what was already opened', () => {
    expect(reusableBody(dto(1, { content: 'soc1.x' }), dto(1, { content: 'hello' }))).toBe('hello');
  });
  test('decrypts what is not on disk', () => {
    expect(reusableBody(dto(1), undefined)).toBeNull();
  });
  test('decrypts an edit again', () => {
    expect(reusableBody(dto(1, { edited_at: 'later' }), dto(1, { content: 'old' }))).toBeNull();
  });
  test('gives a body that failed to open another chance', () => {
    expect(reusableBody(dto(1), dto(1, { content: '[encrypted]' }))).toBeNull();
    expect(reusableBody(dto(1), dto(1, { content: 'soc1g.abc' }))).toBeNull();
    expect(reusableBody(dto(1), dto(1, { content: '' }))).toBeNull();
  });
  test('treats a missing and a null edit time as the same', () => {
    expect(reusableBody(dto(1, { edited_at: undefined }), dto(1, { content: 'x' }))).toBe('x');
  });
});

describe('staleCachedIds', () => {
  test('finds a message deleted inside the page', () => {
    expect(staleCachedIds([dto(1), dto(2), dto(3)], [dto(3), dto(1)], 50)).toEqual([2]);
  });
  test('a short page is the whole history, so older rows are gone too', () => {
    expect(staleCachedIds([dto(1), dto(5)], [dto(5)], 50)).toEqual([1]);
  });
  test('a full page says nothing about what is older than it', () => {
    expect(staleCachedIds([dto(1), dto(5)], [dto(6), dto(5)], 2)).toEqual([]);
  });
  test('keeps what arrived after the page was read', () => {
    expect(staleCachedIds([dto(9)], [dto(5)], 50)).toEqual([]);
  });
  test('an empty answer means the chat was cleared', () => {
    expect(staleCachedIds([dto(1), dto(2)], [], 50)).toEqual([1, 2]);
  });
});

describe('mergeThread', () => {
  const m = (id: string, text = id) => ({ id, text });

  test('keeps a bubble the server has not accepted yet', () => {
    expect(mergeThread([m('1'), m('tmp_a')], [m('1')], []).map((x) => x.id)).toEqual(['1', 'tmp_a']);
  });
  test('keeps what arrived live while the page was in flight', () => {
    expect(mergeThread([m('1'), m('3')], [m('1'), m('2')], []).map((x) => x.id)).toEqual(['1', '2', '3']);
  });
  test('removes what went stale', () => {
    expect(mergeThread([m('1'), m('2')], [m('2')], [1]).map((x) => x.id)).toEqual(['2']);
  });
  test('prefers the fetched copy', () => {
    expect(mergeThread([m('1', 'old')], [m('1', 'new')], [])[0].text).toBe('new');
  });
  test('an empty page only removes what it was told to', () => {
    expect(mergeThread([m('1'), m('tmp_a')], [], [1]).map((x) => x.id)).toEqual(['tmp_a']);
  });
});

test('sameThread tells a repaint from a no-op', () => {
  expect(sameThread([{ id: '1', status: 'sent' }], [{ id: '1', status: 'sent' }])).toBe(true);
  expect(sameThread([{ id: '1', status: 'sent' }], [{ id: '1', status: 'read' }])).toBe(false);
});

test('withoutExpired drops a message past its deadline', () => {
  const now = Date.parse('2026-01-02T00:00:00Z');
  const list = [
    { id: 1, expires_at: '2026-01-01T00:00:00Z' },
    { id: 2, expires_at: '2026-01-03T00:00:00Z' },
    { id: 3 },
  ];
  expect(withoutExpired(list, now).map((m) => m.id)).toEqual([2, 3]);
});

test('isSealedBody recognises every unopened form', () => {
  for (const body of ['[encrypted]', 'soc1.abc', 'soc1g.abc']) expect(isSealedBody(body)).toBe(true);
  expect(isSealedBody('hello')).toBe(false);
  expect(isSealedBody('')).toBe(false);
});
