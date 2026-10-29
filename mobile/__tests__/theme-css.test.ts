import { expect, test } from 'bun:test';

import { CSS_THEME_TEMPLATE, parseThemeCss } from '@/data/theme-css';

test('o template oficial é válido e aplica propriedades allowlisted', () => {
  const result = parseThemeCss(CSS_THEME_TEMPLATE);

  expect(result.valid).toBe(true);
  expect(result.errors).toEqual([]);
  expect(result.tokens.primary).toBe('#5B3DF5');
  expect(result.chat.bubbleMine).toBe('#5B3DF5');
  expect(result.layout.bubbleRadius).toBe(16);
  expect(result.appliedProperties.length).toBeGreaterThan(10);
});

test('CSS desconhecido, selector e funções não chegam ao estado do tema', () => {
  const result = parseThemeCss(`
    :root {
      --primary: url(https://evil.example/theme.css);
      --not-allowed: #fff;
    }
    .message { color: red; }
  `);

  expect(result.valid).toBe(false);
  expect(result.tokens.primary).toBeUndefined();
  expect(result.errors.some((error) => error.property === 'primary')).toBe(true);
  expect(result.errors.some((error) => error.property === 'not-allowed')).toBe(true);
  expect(result.errors.some((error) => error.message.includes(':root block'))).toBe(true);
});

test('intervalos e enumerações inválidos são diagnosticados e limitados', () => {
  const result = parseThemeCss(`
    :root {
      --bubble-radius: 999;
      --font-scale: nope;
      --density: spacious;
      --show-tails: maybe;
    }
  `);

  expect(result.valid).toBe(false);
  expect(result.layout.bubbleRadius).toBe(28);
  expect(result.layout.fontScale).toBeUndefined();
  expect(result.layout.density).toBeUndefined();
  expect(result.layout.showTails).toBeUndefined();
});

test('wallpaper-image só aceita armazenamento local', () => {
  const remote = parseThemeCss(':root { --wallpaper-image: https://example.com/a.jpg; }');
  const local = parseThemeCss(':root { --wallpaper-image: file:///themes/a.jpg; }');

  expect(remote.valid).toBe(false);
  expect(remote.chat.wallpaperImage).toBeUndefined();
  expect(local.valid).toBe(true);
  expect(local.chat.wallpaperImage).toBe('file:///themes/a.jpg');
});
