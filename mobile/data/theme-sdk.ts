import type { ThemePack } from './theme-model';
import { parseThemeCss } from './theme-css';

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

function validateTheme(theme: unknown): string[] {
  if (!isRecord(theme)) return ['theme must be an object'];
  const errors: string[] = [];
  if (typeof theme.id !== 'string' || !theme.id.trim()) errors.push('theme.id is required');
  if (typeof theme.name !== 'string' || !theme.name.trim()) errors.push('theme.name is required');
  if (!isRecord(theme.tokens)) errors.push('theme.tokens is required');
  if (theme.chat !== undefined && !isRecord(theme.chat)) errors.push('theme.chat must be an object');
  if (theme.layout !== undefined && !isRecord(theme.layout)) errors.push('theme.layout must be an object');
  if (theme.icons !== undefined && !isRecord(theme.icons)) errors.push('theme.icons must be an object');
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
