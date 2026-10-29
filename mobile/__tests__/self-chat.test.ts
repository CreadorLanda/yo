import { expect, test } from 'bun:test';

import { displayChatName } from '@/data/chat-identity';

test('self-chat has one stable saved-messages identity', () => {
  expect(displayChatName({ is_self: true, title: 'Helio', peer_username: 'helio' }, 'Saved messages', 'Unknown'))
    .toBe('Saved messages');
  expect(displayChatName({ is_self: false, title: 'Ana', peer_username: 'ana' }, 'Saved messages', 'Unknown'))
    .toBe('Ana');
  expect(displayChatName({ is_self: false, peer_username: 'ana' }, 'Saved messages', 'Unknown'))
    .toBe('ana');
});

test('client uses the idempotent self-chat endpoint', async () => {
  const source = await Bun.file('data/api/messages.ts').text();
  expect(source).toContain("'/api/chats/self'");
  expect(source).toContain('export function createSelfChat()');
});
