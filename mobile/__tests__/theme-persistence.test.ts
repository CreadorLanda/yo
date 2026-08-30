import { expect, test } from 'bun:test';

import { resolveIcon } from '@/data/theme-icons';
import {
  DEFAULT_PACK_ID,
  hydratePack,
  hydrateThemeState,
  PREF_KEYS,
  sanitizeAgainst,
  serializeThemePrefs,
} from '@/data/theme-persistence';

/**
 * What a stored theme means when it is read back.
 *
 * The failure this guards against is specific: themes used to live in memory
 * only, so nothing could be wrong about restoring them. Now that they are
 * rows, every one of these cases is a way the app could come back painted in
 * something nobody chose — or not come back at all.
 *
 * The defaults below are written out rather than imported from
 * [theme-model]: the real ones reach the palette in `constants/theme`, which
 * imports react-native, and none of this needs a native module to be checked.
 */
const layoutDefaults = {
  bubbleShape: 'tail',
  bubbleRadius: 16,
  showTails: true,
  fontScale: 1,
  iconSet: 'outline',
  iconScale: 1,
  tabBarPosition: 'top',
};

const chromeDefaults = {
  light: { wallpaper: '#EEF1F6', wallpaperImage: '', bubbleMine: '#2D5BFF' },
  dark: { wallpaper: '#131419', wallpaperImage: '', bubbleMine: '#818CF8' },
};

const iconDefaults = { chats: '', send: '', attach: '' };

const defaults = {
  layout: layoutDefaults as never,
  chrome: chromeDefaults as never,
  icons: iconDefaults,
  bundledIds: [DEFAULT_PACK_ID, 'infinite-blue', 'phosphor'],
};

test('sem nada guardado, arranca no tema por omissão', () => {
  const state = hydrateThemeState({ prefs: {}, packs: [] }, defaults);

  expect(state.activeThemeId).toBe(DEFAULT_PACK_ID);
  expect(state.installed).toContain(DEFAULT_PACK_ID);
  expect(state.schemePreference).toBe('system');
  expect(state.ownedPacks).toEqual([]);
});

test('o que foi escolhido volta como foi escolhido', () => {
  const chosen = {
    activeThemeId: 'phosphor',
    installed: [DEFAULT_PACK_ID, 'phosphor'],
    liked: ['infinite-blue'],
    schemePreference: 'dark' as const,
    personalLayout: { bubbleRadius: 4, iconScale: 1.2 },
    personalChat: { dark: { wallpaper: '#000000' } },
    personalIcons: { send: 'file:///themes/send.png' },
  };

  const state = hydrateThemeState({ prefs: serializeThemePrefs(chosen), packs: [] }, defaults);

  expect(state.activeThemeId).toBe('phosphor');
  expect(state.installed).toEqual([DEFAULT_PACK_ID, 'phosphor']);
  expect(state.liked).toEqual(['infinite-blue']);
  expect(state.schemePreference).toBe('dark');
  expect(state.personalLayout).toEqual({ bubbleRadius: 4, iconScale: 1.2 });
  expect(state.personalIcons).toEqual({ send: 'file:///themes/send.png' });
});

test('um tema activo que já não existe cai no por omissão', () => {
  // The pack was deleted, or shipped in a build that no longer has it. The
  // app must open on the default rather than on nothing.
  const prefs = {
    [PREF_KEYS.active]: JSON.stringify('theme_deleted'),
    [PREF_KEYS.installed]: JSON.stringify(['theme_deleted', 'phosphor']),
  };

  const state = hydrateThemeState({ prefs, packs: [] }, defaults);

  expect(state.activeThemeId).toBe(DEFAULT_PACK_ID);
  expect(state.installed).not.toContain('theme_deleted');
  expect(state.installed).toContain('phosphor');
});

test('preferências corrompidas não impedem o arranque', () => {
  const prefs = {
    [PREF_KEYS.active]: 'not json at all',
    [PREF_KEYS.scheme]: JSON.stringify('neon'),
    [PREF_KEYS.installed]: JSON.stringify({ nope: true }),
  };

  const state = hydrateThemeState({ prefs, packs: [] }, defaults);

  expect(state.activeThemeId).toBe(DEFAULT_PACK_ID);
  expect(state.schemePreference).toBe('system');
  expect(state.installed).toEqual([DEFAULT_PACK_ID]);
});

test('guarda só os botões que esta versão conhece, e do tipo certo', () => {
  const stored = {
    bubbleRadius: 20,
    // A knob from a newer build, and one whose type changed under us.
    knobFromTheFuture: 'purple',
    fontScale: 'huge',
  };

  expect(sanitizeAgainst(stored, layoutDefaults)).toEqual({ bubbleRadius: 20 });
});

test('um pack guardado antes de um botão existir volta completo', () => {
  const json = JSON.stringify({
    id: 'theme_abc',
    name: 'Old theme',
    tokens: { light: { primary: '#123456' } },
    layout: { bubbleRadius: 8 },
  });

  const restored = hydratePack(json, defaults);

  expect(restored?.layout?.bubbleRadius).toBe(8);
  // Everything it never heard of still resolves, or every screen reading that
  // knob renders undefined.
  expect(restored?.layout?.iconSet).toBe('outline');
  expect(restored?.isOwned).toBe(true);
});

test('uma linha ilegível é descartada, não derruba o catálogo', () => {
  expect(hydratePack('{{{', defaults)).toBeNull();
  expect(hydratePack(JSON.stringify({ name: 'no id' }), defaults)).toBeNull();

  const state = hydrateThemeState(
    { prefs: {}, packs: [{ id: 'broken', json: '{{{' }, { id: 'ok', json: JSON.stringify({ id: 'ok', name: 'Mine' }) }] },
    defaults,
  );
  expect(state.ownedPacks.map((p) => p.id)).toEqual(['ok']);
});

test('um ícone próprio ganha ao símbolo do conjunto', () => {
  expect(resolveIcon('send', 'outline', { send: 'file:///themes/send.png' })).toEqual({
    kind: 'image',
    uri: 'file:///themes/send.png',
  });
  // An empty or blank override is not an icon; drawing it would leave a hole.
  expect(resolveIcon('send', 'outline', { send: '   ' })).toEqual({
    kind: 'glyph',
    glyph: { family: 'ionicons', name: 'arrow-up-outline' },
  });
});

test('o conjunto de ícones escolhe o desenho', () => {
  expect(resolveIcon('chats', 'filled')).toEqual({
    kind: 'glyph',
    glyph: { family: 'ionicons', name: 'chatbubble' },
  });
  expect(resolveIcon('chats', 'sharp')).toEqual({
    kind: 'glyph',
    glyph: { family: 'ionicons', name: 'chatbubble-sharp' },
  });
  expect(resolveIcon('chats', 'material')).toEqual({
    kind: 'glyph',
    glyph: { family: 'material', name: 'chat-bubble' },
  });
});
