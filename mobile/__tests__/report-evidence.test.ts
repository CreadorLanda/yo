import { expect, test } from 'bun:test';

import {
  MAX_EVIDENCE,
  SELECTABLE_RECENT,
  buildEvidence,
  evidenceCandidates,
  noContactRemaining,
} from '../data/report-evidence';

const msg = (id: number, over: Record<string, unknown> = {}) => ({
  id,
  message_type: 'text',
  created_at: new Date(2026, 10, 1, 10, id).toISOString(),
  sender_id: 'them',
  ...over,
});

test('only readable, visible text messages are offered, oldest first', () => {
  const messages = [
    msg(3),
    msg(1),
    msg(2, { message_type: 'image' }),
    msg(4, { deleted_at: '2026-11-01T11:00:00Z' }),
    msg(5),
    msg(6),
    msg(7, { message_type: 'system' }),
  ];
  const text = new Map([
    ['1', 'first'],
    ['3', 'third'],
    ['5', '[encrypted]'],
    ['6', '   '],
  ]);
  const out = evidenceCandidates(messages, text, 'me');
  expect(out.map((c) => c.id)).toEqual([1, 3]);
  expect(out.every((c) => !c.fromMe)).toBe(true);
});

test('the sender is read from the message, not from the text', () => {
  const out = evidenceCandidates([msg(1, { sender_id: 'me' })], new Map([['1', 'mine']]), 'me');
  expect(out[0].fromMe).toBe(true);
});

test('only the most recent messages are offered', () => {
  const many = Array.from({ length: SELECTABLE_RECENT + 10 }, (_, i) => msg(i + 1));
  const text = new Map(many.map((m) => [String(m.id), `m${m.id}`]));
  const out = evidenceCandidates(many, text, 'me');
  expect(out).toHaveLength(SELECTABLE_RECENT);
  expect(out[out.length - 1].id).toBe(many.length);
});

test('evidence holds only what was chosen, capped and trimmed', () => {
  const candidates = Array.from({ length: MAX_EVIDENCE + 5 }, (_, i) => ({
    id: i + 1,
    text: ` body ${i + 1} `,
    fromMe: false,
    sentAt: '2026-11-01T10:00:00Z',
  }));
  expect(buildEvidence(candidates, new Set())).toEqual([]);
  const chosen = new Set(candidates.map((c) => c.id));
  const out = buildEvidence(candidates, chosen);
  expect(out).toHaveLength(MAX_EVIDENCE);
  expect(out[0]).toEqual({ message_id: 1, body: 'body 1' });
  const long = buildEvidence([{ id: 9, text: 'x'.repeat(3000), fromMe: true, sentAt: '' }], new Set([9]));
  expect(long[0].body).toHaveLength(2000);
});

test('the time left is counted in whole minutes and ends at zero', () => {
  const now = Date.parse('2026-11-04T12:00:00Z');
  expect(noContactRemaining(null, now)).toBeNull();
  expect(noContactRemaining('2026-11-04T11:59:00Z', now)).toBeNull();
  expect(noContactRemaining('2026-11-05T11:30:30Z', now)).toEqual({ hours: 23, minutes: 31, totalMinutes: 1411 });
  expect(noContactRemaining('2026-11-04T12:00:01Z', now)).toEqual({ hours: 0, minutes: 1, totalMinutes: 1 });
});
