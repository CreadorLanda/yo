import { expect, test } from 'bun:test';

import { filterChatMessages, matchesChatSearchFilter } from '../data/chat-search';
import type { Message } from '../data/mock';

function message(overrides: Partial<Message> = {}): Message {
  return {
    id: '1',
    text: '',
    fromMe: false,
    timestamp: 'now',
    ...overrides,
  };
}

test('media includes photos, videos, and stickers but excludes audio', () => {
  expect(matchesChatSearchFilter(message({ media: { type: 'image', uri: 'image' } }), 'media')).toBe(true);
  expect(matchesChatSearchFilter(message({ media: { type: 'video', uri: 'video' } }), 'media')).toBe(true);
  expect(
    matchesChatSearchFilter(
      message({ attachment: { kind: 'sticker', uri: 'sticker', width: 10, height: 10 } }),
      'media',
    ),
  ).toBe(true);
  expect(matchesChatSearchFilter(message({ media: { type: 'audio', uri: 'audio' } }), 'media')).toBe(false);
});

test('unread includes only inbound messages flagged by the server read cursor', () => {
  const unread = message({ id: 'unread', text: 'Unread message', isUnread: true });
  expect(matchesChatSearchFilter(unread, 'unread')).toBe(true);
  expect(matchesChatSearchFilter(message({ isUnread: false }), 'unread')).toBe(false);
  expect(matchesChatSearchFilter(message({ isUnread: true, fromMe: true }), 'unread')).toBe(false);
  expect(filterChatMessages([unread], 'unread', 'unread')).toEqual([unread]);
});

test('starred filter only includes messages saved by the current participant', () => {
  const starred = message({ id: 'starred', isStarred: true });
  expect(matchesChatSearchFilter(starred, 'starred')).toBe(true);
  expect(matchesChatSearchFilter(message({ isStarred: false }), 'starred')).toBe(false);
  expect(filterChatMessages([starred, message()], '', 'starred')).toEqual([starred]);
});

test('documents and audio match their attachment types', () => {
  expect(matchesChatSearchFilter(message({ attachment: { kind: 'document', name: 'a.pdf', ext: 'PDF', sizeLabel: '' } }), 'documents')).toBe(true);
  expect(matchesChatSearchFilter(message({ media: { type: 'audio', uri: 'audio' } }), 'audio')).toBe(true);
});

test('text search can match a document name inside the selected category', () => {
  const document = message({
    attachment: { kind: 'document', name: 'invoice-april.pdf', ext: 'PDF', sizeLabel: '' },
  });
  expect(filterChatMessages([document], 'invoice', 'documents')).toEqual([document]);
});

test('links are detected in message text with or without a protocol', () => {
  expect(matchesChatSearchFilter(message({ text: 'Read https://example.com/page' }), 'links')).toBe(true);
  expect(matchesChatSearchFilter(message({ text: 'Visit www.example.com' }), 'links')).toBe(true);
  expect(matchesChatSearchFilter(message({ text: 'No link here' }), 'links')).toBe(false);
});

test('query and category filters combine, and hidden/deleted messages stay out', () => {
  const matching = message({ id: 'matching', text: 'The photo caption', media: { type: 'image', uri: 'image' } });
  const wrongType = message({ id: 'wrong-type', text: 'The photo caption', media: { type: 'audio', uri: 'audio' } });
  const wrongQuery = message({ id: 'wrong-query', text: 'A video', media: { type: 'image', uri: 'image' } });
  const deleted = message({ id: 'deleted', text: 'The photo caption', deletedAt: 'now', media: { type: 'image', uri: 'image' } });
  const system = message({ id: 'system', text: 'The photo caption', system: true, media: { type: 'image', uri: 'image' } });

  expect(filterChatMessages([matching, wrongType, wrongQuery, deleted, system], 'photo', 'media')).toEqual([
    matching,
  ]);
});
