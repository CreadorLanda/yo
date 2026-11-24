import { describe, expect, test } from 'bun:test';

import { canNotifyForChat, canOpenChat, findLockedChatMatches } from '@/data/chat-lock-policy';

describe('chat lock policy', () => {
  test('only opens a locked chat after that chat or all chats were revealed', () => {
    const locked = new Set(['hidden']);
    expect(canOpenChat('hidden', locked, new Set())).toBe(false);
    expect(canOpenChat('hidden', locked, new Set(['other']))).toBe(false);
    expect(canOpenChat('hidden', locked, new Set(['hidden']))).toBe(true);
    expect(canOpenChat('hidden', locked, new Set(['*']))).toBe(true);
    expect(canOpenChat('ordinary', locked, new Set())).toBe(true);
  });

  test('suppresses notifications only for chats marked locked', () => {
    expect(canNotifyForChat(true, false)).toBe(false);
    expect(canNotifyForChat(true, true)).toBe(true);
    expect(canNotifyForChat(false, false)).toBe(true);
  });

  test('search finds a locked direct chat by name or username without exposing other chats', () => {
    const chats = [
      { id: 'name', type: 'direct', name: 'Marta Silva', username: 'marta' },
      { id: 'username', type: 'direct', name: 'Contact', username: '@joao_silva' },
      { id: 'group', type: 'group', name: 'Marta group', username: '' },
      { id: 'ordinary', type: 'direct', name: 'Marta', username: 'marta2' },
      { id: 'revealed', type: 'direct', name: 'Marta old', username: 'marta3' },
      { id: 'self', type: 'direct', is_self: true, name: 'Marta', username: 'marta4' },
    ];
    const locked = new Set(['name', 'username', 'group', 'revealed', 'self']);
    const matches = findLockedChatMatches(chats, locked, new Set(['revealed']), '  SILVA  ');
    expect(matches.map((chat) => chat.id)).toEqual(['name', 'username']);
    expect(findLockedChatMatches(chats, locked, new Set(), 'm')).toEqual([]);
  });
});
