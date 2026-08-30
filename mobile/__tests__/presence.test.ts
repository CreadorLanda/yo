import { expect, test } from 'bun:test';

import { presenceLabel } from '@/data/presence';

const NOW = new Date('2026-08-30T12:00:00Z').getTime();
const ago = (ms: number) => new Date(NOW - ms).toISOString();

test('online ganha a tudo o resto', () => {
  expect(presenceLabel(true, ago(5 * 60_000), NOW)).toEqual({ kind: 'online' });
  // Mesmo sem timestamp nenhum: estar ligado agora é o facto mais recente.
  expect(presenceLabel(true, undefined, NOW)).toEqual({ kind: 'online' });
});

test('sem timestamp não se inventa nada', () => {
  // Escondido, congelado fora de vista, ou nunca visto — do ponto de vista
  // do ecrã são a mesma coisa: não há nada para dizer.
  expect(presenceLabel(false, undefined, NOW)).toEqual({ kind: 'unknown' });
});

test('os baldes alargam à medida que envelhecem', () => {
  expect(presenceLabel(false, ago(30_000), NOW).key).toBe('chats.seen_just_now');
  expect(presenceLabel(false, ago(5 * 60_000), NOW)).toEqual({
    kind: 'last-seen', key: 'chats.seen_minutes', value: 5,
  });
  expect(presenceLabel(false, ago(3 * 3_600_000), NOW)).toEqual({
    kind: 'last-seen', key: 'chats.seen_hours', value: 3,
  });
  expect(presenceLabel(false, ago(2 * 86_400_000), NOW)).toEqual({
    kind: 'last-seen', key: 'chats.seen_days', value: 2,
  });
});

test('as fronteiras caem para o balde maior, não para o menor', () => {
  expect(presenceLabel(false, ago(60_000), NOW).key).toBe('chats.seen_minutes');
  expect(presenceLabel(false, ago(3_600_000), NOW).key).toBe('chats.seen_hours');
  expect(presenceLabel(false, ago(86_400_000), NOW).key).toBe('chats.seen_days');
});

test('data impossível não vira um número', () => {
  // Um relógio dessincronizado dava "visto há -4h" com aritmética simples.
  expect(presenceLabel(false, new Date(NOW + 3_600_000).toISOString(), NOW)).toEqual({
    kind: 'unknown',
  });
  expect(presenceLabel(false, 'nem uma data', NOW)).toEqual({ kind: 'unknown' });
  expect(presenceLabel(false, '', NOW)).toEqual({ kind: 'unknown' });
});
