import { expect, test } from 'bun:test';

import type { Message } from '@/data/mock';
import { appendLinked } from '@/data/reply-link';

const msg = (id: string, text: string, extra: Partial<Message> = {}): Message =>
  ({ id, text, fromMe: false, timestamp: '', ...extra }) as Message;

test('a reply that arrives live gets its quote (#367)', () => {
  const list = [msg('10', 'hello bot', { fromMe: true })];
  const out = appendLinked(list, msg('11', 'You said: hello bot', { replyToId: 10 } as Partial<Message>));
  expect(out).toHaveLength(2);
  expect(out[1].replyTo).toEqual({ id: '10', text: 'hello bot', fromMe: true, senderName: undefined });
});

test('a reply to something not loaded keeps no quote', () => {
  const out = appendLinked([msg('10', 'x')], msg('12', 'y', { replyToId: 3 } as Partial<Message>));
  expect(out[1].replyTo).toBeUndefined();
});

test('earlier messages are left as they were', () => {
  const first = msg('10', 'x');
  const out = appendLinked([first], msg('11', 'y'));
  expect(out[0]).toBe(first);
});
