import { expect, test } from 'bun:test';

import type { Live } from '../data/api/lives';
import { findRunningLive, isAlreadyLive } from '../data/live-resume';

const base: Live = {
  id: 'live-1',
  host_id: 'host',
  host_name: 'Host',
  title: '',
  started_at: '2026-10-29T10:00:00Z',
  viewers: 0,
  peak_viewers: 0,
};

test('already_live is recognised, other failures are not', () => {
  expect(isAlreadyLive(new Error('already_live'))).toBe(true);
  expect(isAlreadyLive(new Error('internal'))).toBe(false);
  expect(isAlreadyLive('already_live')).toBe(false);
});

test('finds the running live in the same chat', () => {
  const lives = [
    { ...base, id: 'a', chat_id: 'chat-other' },
    { ...base, id: 'b', chat_id: 'chat-1' },
  ];
  expect(findRunningLive(lives, { chatId: 'chat-1' })?.id).toBe('b');
});

test('finds the running live in the same channel', () => {
  const lives = [{ ...base, id: 'c', channel_id: 'chan-1' }];
  expect(findRunningLive(lives, { channelId: 'chan-1' })?.id).toBe('c');
});

test('a chat id never matches a channel live, and an ended live is skipped', () => {
  const lives = [
    { ...base, id: 'd', channel_id: 'x' },
    { ...base, id: 'e', chat_id: 'x', ended_at: '2026-10-29T11:00:00Z' },
  ];
  expect(findRunningLive(lives, { chatId: 'x' })).toBeUndefined();
});

test('nothing running there gives nothing', () => {
  expect(findRunningLive([], { chatId: 'chat-1' })).toBeUndefined();
  expect(findRunningLive([{ ...base, chat_id: 'chat-1' }], {})).toBeUndefined();
});
