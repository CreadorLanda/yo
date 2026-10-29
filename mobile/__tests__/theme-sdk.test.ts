import { expect, test } from 'bun:test';

import {
  createThemeDesign,
  parseThemeDesign,
  previewThemeDesign,
  serializeThemeDesign,
} from '@/data/theme-sdk';
import type { ThemePack } from '@/data/theme-model';

const theme = {
  id: 'theme_test',
  name: 'Test design',
  author: 'You',
  description: 'Portable design',
  category: 'minimal',
  downloads: 0,
  likes: 0,
  price: 0,
  swatches: ['#5B3DF5'],
  tokens: { light: { primary: '#5B3DF5' } },
  chat: { light: { bubbleMine: '#5B3DF5' } },
  layout: { wallpaperAnimation: 'aurora' as const },
  icons: { send: 'file:///themes/send.png' },
} satisfies ThemePack;

test('design document faz round trip versionado e preview sem mutação', () => {
  const document = createThemeDesign(theme);
  const serialized = serializeThemeDesign(theme);
  expect(serialized.ok).toBe(true);
  if (!serialized.ok) return;

  const parsed = parseThemeDesign(serialized.value);
  expect(parsed.ok).toBe(true);
  if (!parsed.ok) return;
  expect(parsed.value.version).toBe(1);
  expect(parsed.value.format).toBe('yo.design');
  expect(previewThemeDesign(parsed.value)).toMatchObject({
    id: 'theme_test',
    name: 'Test design',
    animation: 'aurora',
    version: 1,
  });
  expect(document.theme).not.toBe(theme);
  expect(theme.isPublished).toBeUndefined();
});

test('formato desconhecido, versão futura e CSS inválido são rejeitados', () => {
  const serialized = JSON.stringify({
    format: 'yo.design',
    version: 2,
    theme,
  });
  expect(parseThemeDesign(serialized).ok).toBe(false);

  const invalid = serializeThemeDesign({
    ...theme,
    customCss: ':root { --evil: url(https://example.com/x); }',
  });
  expect(invalid.ok).toBe(false);
});
