import { expect, test } from 'bun:test';

import { callGrid, tileHueIndex } from '@/data/call-grid';

const W = 360;
const H = 600;
const G = 8;

test('one person fills the stage', () => {
  const g = callGrid(1, W, H, G);
  expect(g.columns).toBe(1);
  expect(g.tileHeight).toBe(H);
  expect(g.scrolls).toBe(false);
});

test('two people stack in a portrait stage', () => {
  const g = callGrid(2, W, H, G);
  expect(g.columns).toBe(1);
  expect(g.tileHeight).toBe((H - G) / 2);
});

test('three people: two side by side and one across the row below', () => {
  const g = callGrid(3, W, H, G);
  expect(g.columns).toBe(2);
  expect(g.spanLast).toBe(true);
});

test('four people make an even grid', () => {
  const g = callGrid(4, W, H, G);
  expect(g.columns).toBe(2);
  expect(g.spanLast).toBe(false);
  expect(g.scrolls).toBe(false);
});

test('a crowd keeps usable tiles and scrolls', () => {
  const g = callGrid(12, W, H, G);
  expect(g.tileHeight).toBe(150);
  expect(g.scrolls).toBe(true);
});

test('a landscape stage uses its width', () => {
  expect(callGrid(2, 800, 360, G).columns).toBe(2);
  expect(callGrid(6, 800, 360, G).columns).toBe(3);
});

test('a person keeps their tile colour', () => {
  expect(tileHueIndex('ana', 6)).toBe(tileHueIndex('ana', 6));
  expect(tileHueIndex('ana', 6)).toBeLessThan(6);
});
