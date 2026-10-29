import { expect, test } from 'bun:test';

const store = await Bun.file('data/live-store.ts').text();

test('o store deduplica eventos de live iniciada', () => {
  expect(store).toContain("type === 'live.started'");
  expect(store).toContain('filter((l) => l.id !== live.id)');
});

test('o contador e o fim atualizam o rail', () => {
  expect(store).toContain("type === 'live.viewers'");
  expect(store).toContain('viewers.set(id, n)');
  expect(store).toContain("type === 'live.ended'");
  expect(store).toContain('viewers.delete(id)');
});

test('eventos incompletos nao inventam estado', () => {
  expect(store).toContain("if (!live?.id) return true");
  expect(store).toContain("if (typeof id !== 'string' || typeof n !== 'number') return true");
});
