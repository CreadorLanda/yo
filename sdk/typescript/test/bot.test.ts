import { createHmac } from 'node:crypto';

import { expect, test } from 'bun:test';

import { parseInvocation, textOf } from '../src/bot';
import { encodeReply } from '../src/types';
import { verifySignature } from '../src/webhook';

test('invocations parse like the app builds them', () => {
  expect(parseInvocation('/remind@helper_bot when:2026-11-26T09:00:00.000Z what:"drink \\"lots of\\" water"')).toEqual({
    name: 'remind',
    options: { when: '2026-11-26T09:00:00.000Z', what: 'drink "lots of" water' },
  });
  expect(parseInvocation('hello')).toBeNull();
});

test('bodies: text out of cards and previews, replies into cards', () => {
  expect(textOf('{"zl1":{"text":"see this","preview":{}}}')).toBe('see this');
  expect(textOf('plain')).toBe('plain');
  expect(encodeReply('hi')).toBe('hi');
  expect(encodeReply({ text: 'only text' })).toBe('only text');
  const card = JSON.parse(encodeReply({ text: 'Lunch?', components: [[{ type: 'button', id: 'y', label: 'Yes' }]] }));
  expect(card.zi1.text).toBe('Lunch?');
  expect(card.zi1.components[0][0].id).toBe('y');
});

test('webhook signatures and the replay window', () => {
  const body = '{"id":1,"type":"ping"}';
  const now = Date.UTC(2026, 10, 26, 12);
  const ts = String(Math.floor(now / 1000));
  const sig = `sha256=${createHmac('sha256', 'whsec_x').update(`${ts}.${body}`).digest('hex')}`;
  expect(verifySignature('whsec_x', ts, body, sig, now)).toBe(true);
  expect(verifySignature('whsec_x', ts, body + ' ', sig, now)).toBe(false);
  expect(verifySignature('other', ts, body, sig, now)).toBe(false);
  expect(verifySignature('whsec_x', ts, body, sig, now + 6 * 60 * 1000)).toBe(false);
  expect(verifySignature('whsec_x', null, body, sig, now)).toBe(false);
});
