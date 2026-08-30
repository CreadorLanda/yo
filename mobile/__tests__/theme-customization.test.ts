import { expect, test } from 'bun:test';

import {
  APP_ICONS,
  appIconFromPluginName,
  appIconSpec,
} from '@/data/theme-app-icons';
import {
  FONT_FAMILIES,
  fontFamilySpec,
  nearestWeight,
  resolveFontFace,
} from '@/data/theme-fonts';
import {
  DEFAULT_LAYOUT,
  THEME_CATEGORIES,
  amoledizeChat,
  amoledizeTokens,
  defaultChatChrome,
  withAlpha,
} from '@/data/theme-model';
import { DEFAULT_PACK_ID, hydrateThemeState, PREF_KEYS } from '@/data/theme-persistence';

/**
 * The knobs added on top of persistence: a typeface, true black, frosted
 * chrome, a wallpaper that moves, and the launcher icon.
 *
 * All five are pure decisions with a screen bolted on afterwards, and this is
 * the half that can be checked. The theme *store* still cannot be imported
 * here — it reaches a database and a native font loader — but since the dead
 * `constants/theme` import came out of [theme-model], everything it decides
 * is now reachable from Node, defaults included.
 */

// ── Typefaces ───────────────────────────────────────────────────────────────

test('o peso pedido cai na face mais próxima que existe', () => {
  expect(nearestWeight('bold')).toBe('700');
  expect(nearestWeight('normal')).toBe('400');
  expect(nearestWeight(undefined)).toBe('400');
  expect(nearestWeight(600)).toBe('600');
  expect(nearestWeight('500')).toBe('500');
  expect(nearestWeight(900)).toBe('700');
  // Nada mais leve que o regular vem no pacote, por isso 300 arredonda para
  // cima — 400 é um tom pesado de mais, 700 seria outro desenho.
  expect(nearestWeight(300)).toBe('400');
  expect(nearestWeight(100)).toBe('400');
});

test('lixo no peso não rebenta, cai no regular', () => {
  expect(nearestWeight('semibold')).toBe('400');
  expect(nearestWeight(null)).toBe('400');
  expect(nearestWeight({})).toBe('400');
});

test('“system” nunca nomeia uma fonte', () => {
  // É o contrato todo: nomear a fonte do sistema é o que lhe tira as
  // métricas de tamanho dinâmico do iOS.
  expect(resolveFontFace('system', 400)).toBeNull();
  expect(resolveFontFace('system', 'bold')).toBeNull();
});

test('cada família traz as quatro faces, e resolve para elas', () => {
  expect(resolveFontFace('inter', 'bold')).toBe('Inter_700Bold');
  expect(resolveFontFace('lora', 400)).toBe('Lora_400Regular');
  expect(resolveFontFace('space', 600)).toBe('SpaceGrotesk_600SemiBold');
  expect(resolveFontFace('jetbrains', 500)).toBe('JetBrainsMono_500Medium');

  for (const family of FONT_FAMILIES) {
    if (family.id === 'system') continue;
    for (const weight of ['400', '500', '600', '700'] as const) {
      expect(family.faces[weight].length).toBeGreaterThan(0);
    }
  }
});

test('uma família desconhecida cai no sistema em vez de rebentar', () => {
  expect(fontFamilySpec('nope' as never).id).toBe('system');
  expect(resolveFontFace('nope' as never, 700)).toBeNull();
});

// ── AMOLED ──────────────────────────────────────────────────────────────────

test('AMOLED apaga o fundo mas guarda as cores do tema', () => {
  const tokens = {
    ...amoledizeTokens({
      primary: '#E2622B',
      onPrimary: '#FFFFFF',
      background: '#14100C',
      surface: '#1D1913',
      surfaceElevated: '#26211A',
      surfaceMuted: '#100E09',
      text: '#F2E9D8',
      textSecondary: '#B0A48C',
      textMuted: '#7A7060',
      border: '#2E2820',
      divider: '#221D17',
      tint: '#E2622B',
      icon: '#B0A48C',
      tabIconDefault: '#7A7060',
      tabIconSelected: '#E2622B',
      success: '#10B981',
      warning: '#F59E0B',
      danger: '#EF4444',
      info: '#3B82F6',
    }),
  };

  expect(tokens.background).toBe('#000000');
  expect(tokens.surfaceMuted).toBe('#000000');
  // O que está por cima do preto continua a ter uma aresta.
  expect(tokens.surface).not.toBe('#000000');
  // E as cores que a pessoa escolheu ficam. É isto que separa isto de ser
  // apenas mais um pack monocromático.
  expect(tokens.primary).toBe('#E2622B');
  expect(tokens.text).toBe('#F2E9D8');
  expect(tokens.danger).toBe('#EF4444');
});

test('AMOLED não apaga o balão nosso nem a foto de fundo', () => {
  const chrome = defaultChatChrome('dark', '#E2622B');
  const flat = amoledizeChat({ ...chrome, wallpaperImage: 'file:///wall.jpg' });

  expect(flat.wallpaper).toBe('#000000');
  expect(flat.composerBg).toBe('#000000');
  expect(flat.headerBg).toBe('#000000');
  // O acento é a única cor que sobra numa conversa preta.
  expect(flat.bubbleMine).toBe('#E2622B');
  expect(flat.sendBtnBg).toBe('#E2622B');
  // Uma foto escolhida por alguém não é uma superfície para achatar.
  expect(flat.wallpaperImage).toBe('file:///wall.jpg');
});

// ── withAlpha ───────────────────────────────────────────────────────────────

test('withAlpha aceita as quatro formas em que uma cor pode estar guardada', () => {
  expect(withAlpha('#0A0', 0.5)).toBe('rgba(0,170,0,0.5)');
  expect(withAlpha('#0A0F1E', 0.25)).toBe('rgba(10,15,30,0.25)');
  expect(withAlpha('#0A0F1EFF', 1)).toBe('rgba(10,15,30,1)');
  expect(withAlpha('rgb(1, 2, 3)', 0.4)).toBe('rgba(1,2,3,0.4)');
  expect(withAlpha('rgba(1, 2, 3, 0.9)', 0.4)).toBe('rgba(1,2,3,0.4)');
});

test('withAlpha devolve o que não percebe, em vez de transparente', () => {
  // Um painel opaco de mais é muito melhor falha do que um invisível.
  expect(withAlpha('papayawhip', 0.5)).toBe('papayawhip');
  expect(withAlpha('', 0.5)).toBe('');
  expect(withAlpha('#12345', 0.5)).toBe('#12345');
});

test('withAlpha trava a opacidade fora do intervalo', () => {
  expect(withAlpha('#000000', 5)).toBe('rgba(0,0,0,1)');
  expect(withAlpha('#000000', -2)).toBe('rgba(0,0,0,0)');
});

// ── Defaults ────────────────────────────────────────────────────────────────

test('nada de novo está ligado por omissão', () => {
  // Tudo o que se acrescentou é opt-in: quem não mexer em nada continua a ver
  // exactamente a app que tinha.
  expect(DEFAULT_LAYOUT.fontFamily).toBe('system');
  expect(DEFAULT_LAYOUT.amoledBlack).toBe(false);
  expect(DEFAULT_LAYOUT.glassChrome).toBe(false);
  expect(DEFAULT_LAYOUT.wallpaperAnimation).toBe('none');
});

// ── Ícone da app ────────────────────────────────────────────────────────────

test('o nome nativo e o id do ícone fazem ida e volta', () => {
  for (const icon of APP_ICONS) {
    expect(appIconFromPluginName(icon.pluginName)).toBe(icon.id);
    expect(appIconSpec(icon.id).pluginName).toBe(icon.pluginName);
  }
  expect(appIconSpec('default').pluginName).toBeNull();
});

test('um ícone que este build já não traz volta ao de origem', () => {
  expect(appIconFromPluginName('Removido')).toBe('default');
  expect(appIconFromPluginName(null)).toBe('default');
  expect(appIconSpec('nope' as never).id).toBe('default');
});

test('o ícone escolhido sobrevive ao restart, o inventado não', () => {
  const defaults = {
    layout: DEFAULT_LAYOUT,
    chrome: {
      light: defaultChatChrome('light', '#2D5BFF'),
      dark: defaultChatChrome('dark', '#818CF8'),
    },
    icons: {},
    bundledIds: [DEFAULT_PACK_ID],
  };

  const kept = hydrateThemeState(
    { prefs: { [PREF_KEYS.appIcon]: JSON.stringify('phosphor') }, packs: [] },
    defaults,
  );
  expect(kept.appIcon).toBe('phosphor');

  const bogus = hydrateThemeState(
    { prefs: { [PREF_KEYS.appIcon]: JSON.stringify('gojo') }, packs: [] },
    defaults,
  );
  expect(bogus.appIcon).toBe('default');

  const missing = hydrateThemeState({ prefs: {}, packs: [] }, defaults);
  expect(missing.appIcon).toBe('default');
});

// ── Categorias ──────────────────────────────────────────────────────────────

test('as categorias são únicas e os dois filtros ficam nas pontas', () => {
  expect(new Set(THEME_CATEGORIES).size).toBe(THEME_CATEGORIES.length);
  // 'all' e 'mine' são filtros, não estilos: nenhum pack os pode declarar,
  // e por isso ficam no princípio e no fim da lista.
  expect(THEME_CATEGORIES[0]).toBe('all');
  expect(THEME_CATEGORIES[THEME_CATEGORIES.length - 1]).toBe('mine');
  expect(THEME_CATEGORIES).toContain('retro');
});
