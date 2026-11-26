import { expect, test } from 'bun:test';

import {
  decodeBotBody,
  encodeBotBody,
  interactionPayload,
  isExpired,
  LIMITS,
  sanitizeInteractive,
} from '@/data/bot-message';

test('plain text stays plain text', () => {
  expect(decodeBotBody('hello')).toEqual({ text: 'hello' });
  expect(decodeBotBody('{"zi1": broken')).toEqual({ text: '{"zi1": broken' });
});

test('a card with buttons round-trips', () => {
  const body = encodeBotBody('Pick one', {
    card: { title: 'Lunch', description: 'Where?', color: 'success', fields: [{ name: 'When', value: '13:00', inline: true }] },
    components: [[
      { type: 'button', id: 'yes', label: 'Yes', style: 'primary' },
      { type: 'button', id: 'no', label: 'No', style: 'danger' },
      { type: 'button', label: 'Menu', style: 'link', url: 'https://example.com/menu' },
    ]],
  });
  const { text, interactive } = decodeBotBody(body);
  expect(text).toBe('Pick one');
  expect(interactive?.card?.title).toBe('Lunch');
  expect(interactive?.card?.color).toBe('success');
  expect(interactive?.rows[0].map((c) => c.type === 'button' && c.style)).toEqual(['primary', 'danger', 'link']);
});

test('whatever a bot sends is cut to size and cleaned', () => {
  const huge = 'x'.repeat(10_000);
  const out = sanitizeInteractive({
    card: { title: huge, color: '#ff0000', thumbnail: 'https://tracker.example/p.png' },
    components: [
      [{ type: 'button', id: 'a', label: huge, style: 'weird' }],
      [{ type: 'button', label: 'Bad link', style: 'link', url: 'javascript:alert(1)' }],
      [{ type: 'button', id: 'a', label: 'Duplicate id', style: 'primary' }],
      [{ type: 'html', id: 'h', content: '<script>' }],
      ...Array.from({ length: 10 }, (_, i) => [{ type: 'button', id: `b${i}`, label: `B${i}`, style: 'primary' }]),
    ],
  })!;
  expect(out.card?.title?.length).toBe(LIMITS.title);
  expect(out.card?.color).toBeUndefined();
  expect(out.card?.thumbnail).toBeUndefined();
  const first = out.rows[0][0];
  expect(first.type === 'button' && first.style).toBe('secondary');
  expect(first.type === 'button' && first.label.length).toBe(LIMITS.label);
  expect(out.rows.length).toBe(LIMITS.rows);
  const ids = out.rows.flat().map((c) => c.id);
  expect(new Set(ids).size).toBe(ids.length);
  expect(ids).not.toContain('h');
});

test('menus and forms are checked and sit alone in their row', () => {
  const out = sanitizeInteractive({
    components: [[
      { type: 'select', id: 'pick', options: [{ label: 'A', value: 'a' }, { label: 'B', value: 'b' }], max: 5 },
      { type: 'form', id: 'f', title: 'RSVP', fields: [
        { id: 'name', label: 'Name', type: 'text', required: true },
        { id: 'size', label: 'Size', type: 'choice' },
        { id: 'meal', label: 'Meal', type: 'choice', choices: [{ label: 'Fish', value: 'fish' }] },
      ] },
      { type: 'select', id: 'empty', options: [] },
    ]],
  })!;
  expect(out.rows.length).toBe(2);
  const select = out.rows[0][0];
  expect(select.type === 'select' && [select.min, select.max]).toEqual([0, 2]);
  const form = out.rows[1][0];
  expect(form.type === 'form' && form.fields.map((f) => f.id)).toEqual(['name', 'meal']);
});

test('expiry and the click payload', () => {
  const out = sanitizeInteractive({ components: [[{ type: 'button', id: 'x', label: 'X', style: 'primary' }]], expires_at: '2026-01-01T00:00:00Z' })!;
  expect(isExpired(out, new Date('2026-06-01'))).toBe(true);
  expect(isExpired(out, new Date('2025-06-01'))).toBe(false);
  expect(JSON.parse(interactionPayload({ messageId: 42, componentId: 'yes' }))).toEqual({
    v: 1, kind: 'interaction', message_id: 42, component_id: 'yes',
  });
  expect(sanitizeInteractive({})).toBeNull();
});
