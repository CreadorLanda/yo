import type { ThemePack } from './theme-model';
import { DEFAULT_LAYOUT, THEME_LAYOUT_RANGES } from './theme-model';
import { ICON_SETS, ICON_SLOTS } from './theme-icons';
import { FONT_FAMILY_IDS } from './theme-fonts';
import { isSafeThemeColor, parseThemeCss } from './theme-css';

export const THEME_FORMAT = 'yo.design';
export const THEME_FORMAT_VERSION = 1 as const;

export type ThemeDesignDocument = {
  format: typeof THEME_FORMAT;
  version: typeof THEME_FORMAT_VERSION;
  theme: ThemePack;
  capabilities: {
    semanticTokens: true;
    chatChrome: true;
    icons: true;
    layout: true;
    effects: {
      deterministicAnimations: true;
      reducedMotion: 'system';
      maxConcurrentLayers: 3;
    };
  };
};

export type ThemeDocumentResult<T> =
  | { ok: true; value: T }
  | { ok: false; errors: string[] };

const isRecord = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === 'object' && !Array.isArray(value);

const COLOR_KEYS = new Set([
  'primary',
  'onPrimary',
  'background',
  'surface',
  'surfaceElevated',
  'surfaceMuted',
  'text',
  'textSecondary',
  'textMuted',
  'border',
  'divider',
  'tint',
  'icon',
  'tabIconDefault',
  'tabIconSelected',
  'success',
  'warning',
  'danger',
  'info',
]);
const CHAT_COLOR_KEYS = new Set([
  'wallpaper',
  'bubbleMine',
  'bubbleTheirs',
  'textMine',
  'textTheirs',
  'metaMine',
  'metaTheirs',
  'datePillBg',
  'datePillText',
  'composerBg',
  'inputBg',
  'linkMine',
  'linkTheirs',
  'headerBg',
  'headerFg',
  'sendBtnBg',
  'replyBarBg',
  'replyBarAccent',
  'selectionBg',
  'typingDot',
  'systemBg',
  'systemText',
  'unreadBadge',
]);
const CATEGORIES = new Set(['official', 'neon', 'pastel', 'minimal', 'nature', 'midnight', 'retro']);
const LAYOUT_ENUMS: Record<string, readonly string[]> = {
  myBubbleSide: ['left', 'right'],
  bubbleShape: ['rounded', 'tail', 'square', 'pill'],
  density: ['compact', 'cozy', 'roomy'],
  avatarPosition: ['left', 'right', 'hidden'],
  selectionCheckSide: ['left', 'right'],
  headerStyle: ['brand', 'minimal', 'colored'],
  tabBarPosition: ['top', 'bottom'],
  tabBarLabels: ['labels', 'icons', 'both'],
  composerStyle: ['rounded', 'flat', 'floating'],
  datePillStyle: ['pill', 'text', 'hidden'],
  replyStyle: ['quote', 'bar', 'minimal'],
  sendButtonStyle: ['circle', 'pill', 'icon'],
  attachSide: ['left', 'right'],
  wallpaperAnimation: ['none', 'aurora', 'drift', 'pulse', 'liquid'],
};

function validateScheme(
  value: unknown,
  colorKeys: Set<string>,
  label: string,
  errors: string[],
) {
  if (!isRecord(value)) {
    errors.push(`${label} must be an object`);
    return;
  }
  for (const [key, item] of Object.entries(value)) {
    if (colorKeys.has(key)) {
      if (typeof item !== 'string' || !isSafeThemeColor(item)) {
        errors.push(`${label}.${key} must be a safe color`);
      }
      continue;
    }
    if (key === 'wallpaperImage') {
      if (
        typeof item !== 'string' ||
        !(item.startsWith('file://') || item.startsWith('content://'))
      ) {
        errors.push(`${label}.${key} must be a local file or content URI`);
      }
      continue;
    }
    errors.push(`${label}.${key} is not supported`);
  }
}

function validateLayout(value: unknown, errors: string[]) {
  if (!isRecord(value)) {
    errors.push('theme.layout must be an object');
    return;
  }
  for (const [key, item] of Object.entries(value)) {
    if (!(key in DEFAULT_LAYOUT)) {
      errors.push(`theme.layout.${key} is not supported`);
      continue;
    }
    const expected = typeof DEFAULT_LAYOUT[key as keyof typeof DEFAULT_LAYOUT];
    if (typeof item !== expected) {
      errors.push(`theme.layout.${key} must be a ${expected}`);
      continue;
    }
    const enumValues = LAYOUT_ENUMS[key];
    if (enumValues && !enumValues.includes(String(item))) {
      errors.push(`theme.layout.${key} is not supported`);
      continue;
    }
    const range = THEME_LAYOUT_RANGES[key as keyof typeof THEME_LAYOUT_RANGES];
    if (range && (typeof item !== 'number' || !Number.isFinite(item) || item < range[0] || item > range[1])) {
      errors.push(`theme.layout.${key} must be between ${range[0]} and ${range[1]}`);
    }
  }
  if (value.iconSet !== undefined && !ICON_SETS.includes(value.iconSet as never)) {
    errors.push('theme.layout.iconSet is not supported');
  }
  if (value.fontFamily !== undefined && !FONT_FAMILY_IDS.includes(value.fontFamily as never)) {
    errors.push('theme.layout.fontFamily is not supported');
  }
}

function validateTheme(theme: unknown): string[] {
  if (!isRecord(theme)) return ['theme must be an object'];
  const errors: string[] = [];
  if (typeof theme.id !== 'string' || !theme.id.trim()) errors.push('theme.id is required');
  if (typeof theme.name !== 'string' || !theme.name.trim()) errors.push('theme.name is required');
  if (typeof theme.author !== 'string') errors.push('theme.author is required');
  if (typeof theme.description !== 'string') errors.push('theme.description is required');
  if (typeof theme.category !== 'string' || !CATEGORIES.has(theme.category)) {
    errors.push('theme.category is not supported');
  }
  for (const key of ['downloads', 'likes', 'price']) {
    if (typeof theme[key] !== 'number' || !Number.isFinite(theme[key]) || theme[key] < 0) {
      errors.push(`theme.${key} must be a non-negative number`);
    }
  }
  if (!Array.isArray(theme.swatches) || theme.swatches.some((item) => typeof item !== 'string' || !isSafeThemeColor(item))) {
    errors.push('theme.swatches must contain only safe colors');
  }
  if (!isRecord(theme.tokens)) {
    errors.push('theme.tokens is required');
  } else {
    for (const scheme of ['light', 'dark']) {
      if (theme.tokens[scheme] !== undefined) {
        validateScheme(theme.tokens[scheme], COLOR_KEYS, `theme.tokens.${scheme}`, errors);
      }
    }
  }
  if (theme.chat !== undefined) {
    if (!isRecord(theme.chat)) errors.push('theme.chat must be an object');
    else {
      for (const scheme of ['light', 'dark']) {
        if (theme.chat[scheme] !== undefined) {
          validateScheme(theme.chat[scheme], CHAT_COLOR_KEYS, `theme.chat.${scheme}`, errors);
        }
      }
    }
  }
  if (theme.layout !== undefined) validateLayout(theme.layout, errors);
  if (theme.icons !== undefined) {
    if (!isRecord(theme.icons)) errors.push('theme.icons must be an object');
    else {
      for (const [slot, uri] of Object.entries(theme.icons)) {
        if (!ICON_SLOTS.includes(slot as never)) errors.push(`theme.icons.${slot} is not supported`);
        else if (typeof uri !== 'string' || (uri !== '' && !(uri.startsWith('file://') || uri.startsWith('content://')))) {
          errors.push(`theme.icons.${slot} must be a local file or content URI`);
        }
      }
    }
  }
  if (theme.customCss !== undefined) {
    if (typeof theme.customCss !== 'string') errors.push('theme.customCss must be text');
    else {
      const css = parseThemeCss(theme.customCss);
      errors.push(...css.errors.map((error) => `customCss line ${error.line}: ${error.message}`));
    }
  }
  return errors;
}

export function createThemeDesign(theme: ThemePack): ThemeDesignDocument {
  return {
    format: THEME_FORMAT,
    version: THEME_FORMAT_VERSION,
    theme: JSON.parse(JSON.stringify(theme)) as ThemePack,
    capabilities: {
      semanticTokens: true,
      chatChrome: true,
      icons: true,
      layout: true,
      effects: {
        deterministicAnimations: true,
        reducedMotion: 'system',
        maxConcurrentLayers: 3,
      },
    },
  };
}

export function serializeThemeDesign(theme: ThemePack): ThemeDocumentResult<string> {
  const errors = validateTheme(theme);
  if (errors.length) return { ok: false, errors };
  return { ok: true, value: JSON.stringify(createThemeDesign(theme), null, 2) };
}

export function parseThemeDesign(raw: string): ThemeDocumentResult<ThemeDesignDocument> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { ok: false, errors: ['document is not valid JSON'] };
  }
  if (!isRecord(parsed)) return { ok: false, errors: ['document must be an object'] };
  if (parsed.format !== THEME_FORMAT) return { ok: false, errors: ['unsupported design format'] };
  if (parsed.version !== THEME_FORMAT_VERSION) return { ok: false, errors: ['unsupported design version'] };
  const errors = validateTheme(parsed.theme);
  if (errors.length) return { ok: false, errors };
  return { ok: true, value: createThemeDesign(parsed.theme as ThemePack) };
}

/**
 * A pure preview contract. The UI can render these fields without applying or
 * persisting the document, so import previews cannot mutate the active theme.
 */
export function previewThemeDesign(document: ThemeDesignDocument) {
  return {
    id: document.theme.id,
    name: document.theme.name,
    description: document.theme.description,
    swatches: [...document.theme.swatches],
    hasCustomCss: !!document.theme.customCss,
    hasWallpaper: Object.values(document.theme.chat ?? {}).some((scheme) =>
      !!scheme?.wallpaperImage,
    ),
    animation: document.theme.layout?.wallpaperAnimation ?? 'none',
    format: document.format,
    version: document.version,
  };
}
