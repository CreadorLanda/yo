import type {
  ChatChrome,
  ComposerStyle,
  HeaderStyle,
  MessageDensity,
  SendButtonStyle,
  ThemeLayout,
  ThemeTokens,
} from './theme-model';
import { THEME_LAYOUT_RANGES } from './theme-model';

export type ThemeCssDiagnostic = {
  line: number;
  message: string;
  property?: string;
};

export type ParsedThemeCss = {
  tokens: Partial<ThemeTokens>;
  chat: Partial<ChatChrome>;
  layout: Partial<ThemeLayout>;
  errors: ThemeCssDiagnostic[];
  appliedProperties: string[];
  valid: boolean;
};

export const CSS_THEME_TEMPLATE = `/* Yo theme CSS — safe custom properties only */
:root {
  --primary: #5B3DF5;
  --background: #0E0F13;
  --surface: #191A21;
  --text: #ECEDF2;
  --wallpaper: #131419;
  --bubble-mine: #5B3DF5;
  --bubble-theirs: #191A21;
  --text-mine: #FFFFFF;
  --text-theirs: #ECEDF2;
  --my-side: right;          /* left | right */
  --bubble-shape: tail;      /* tail | rounded | pill | square */
  --bubble-radius: 16;       /* 4..28 */
  --font-scale: 1;           /* 0.85..1.35 */
  --density: cozy;            /* compact | cozy | roomy */
  --bubble-max-width: 82;     /* 60..94 */
  --wallpaper-dim: 35;        /* 0..80 */
  --bubble-padding-h: 11;     /* 6..22 */
  --bubble-padding-v: 7;      /* 4..18 */
  --emoji-scale: 1;            /* 0.8..1.6 */
  --letter-spacing: 0;         /* -0.5..1.5 */
  --show-tails: true;
  --bubble-shadow: true;
  --wallpaper-pattern: false;
  --send-button: circle;       /* circle | pill | icon */
  --composer: rounded;         /* rounded | flat | floating */
  --header-style: minimal;     /* brand | minimal | colored */
}
`;

const HEX_COLOR = /^#(?:[0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})$/i;
const RGB_COLOR = /^rgba?\(\s*(\d{1,3})\s*,\s*(\d{1,3})\s*,\s*(\d{1,3})(?:\s*,\s*(0|1|0?\.\d+))?\s*\)$/i;

const TOKEN_PROPERTIES: Record<string, keyof ThemeTokens> = {
  primary: 'primary',
  'on-primary': 'onPrimary',
  background: 'background',
  surface: 'surface',
  'surface-elevated': 'surfaceElevated',
  'surface-muted': 'surfaceMuted',
  text: 'text',
  'text-secondary': 'textSecondary',
  'text-muted': 'textMuted',
  border: 'border',
  divider: 'divider',
  tint: 'tint',
  icon: 'icon',
  'tab-icon-default': 'tabIconDefault',
  'tab-icon-selected': 'tabIconSelected',
  success: 'success',
  warning: 'warning',
  danger: 'danger',
  info: 'info',
};

const CHAT_PROPERTIES: Record<string, keyof ChatChrome> = {
  wallpaper: 'wallpaper',
  'wallpaper-image': 'wallpaperImage',
  'bubble-mine': 'bubbleMine',
  'bubble-theirs': 'bubbleTheirs',
  'text-mine': 'textMine',
  'text-theirs': 'textTheirs',
  'meta-mine': 'metaMine',
  'meta-theirs': 'metaTheirs',
  'date-pill-bg': 'datePillBg',
  'date-pill-text': 'datePillText',
  'composer-bg': 'composerBg',
  'input-bg': 'inputBg',
  'link-mine': 'linkMine',
  'link-theirs': 'linkTheirs',
  'header-bg': 'headerBg',
  'header-fg': 'headerFg',
  'send-btn': 'sendBtnBg',
  'reply-bar-bg': 'replyBarBg',
  'reply-bar-accent': 'replyBarAccent',
  'selection-bg': 'selectionBg',
  'typing-dot': 'typingDot',
  'system-bg': 'systemBg',
  'system-text': 'systemText',
  'unread-badge': 'unreadBadge',
};

function lineOf(source: string, offset: number): number {
  return source.slice(0, offset).split('\n').length;
}

export function isSafeThemeColor(value: string): boolean {
  if (HEX_COLOR.test(value)) return true;
  const match = RGB_COLOR.exec(value);
  if (!match) return false;
  return [match[1], match[2], match[3]].every((channel) => Number(channel) <= 255);
}

function localImage(value: string): boolean {
  return value.startsWith('file://') || value.startsWith('content://');
}

function numberInRange(value: string, min: number, max: number): number | null {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return null;
  return Math.min(max, Math.max(min, parsed));
}

function enumValue<T extends string>(value: string, values: readonly T[]): T | null {
  return values.includes(value as T) ? (value as T) : null;
}

function addError(
  errors: ThemeCssDiagnostic[],
  source: string,
  offset: number,
  message: string,
  property?: string,
) {
  errors.push({ line: lineOf(source, offset), message, property });
}

/**
 * Parse the deliberately small CSS dialect accepted by the native renderer.
 * This is not a browser CSS interpreter: unknown properties, URLs, functions,
 * selectors and arbitrary declarations are rejected before they reach theme
 * state. Invalid numeric values are clamped for preview safety and reported so
 * the editor can prevent publication.
 */
export function parseThemeCss(css: string): ParsedThemeCss {
  const tokens: Partial<ThemeTokens> = {};
  const chat: Partial<ChatChrome> = {};
  const layout: Partial<ThemeLayout> = {};
  const errors: ThemeCssDiagnostic[] = [];
  const appliedProperties: string[] = [];

  if (typeof css !== 'string' || css.length > 32_000) {
    return {
      tokens,
      chat,
      layout,
      errors: [{ line: 1, message: 'CSS must be text shorter than 32 KB.' }],
      appliedProperties,
      valid: false,
    };
  }

  const commentMatch = /\/\*[\s\S]*?\*\//g;
  const withoutComments = css.replace(commentMatch, (match) => ' '.repeat(match.length));
  if (withoutComments.includes('/*')) {
    addError(errors, css, withoutComments.indexOf('/*'), 'Unclosed comment.');
  }

  const root = /:root\s*\{/i.exec(withoutComments);
  if (!root) {
    addError(errors, css, 0, 'A single :root block is required.');
    return { tokens, chat, layout, errors, appliedProperties, valid: false };
  }

  if (withoutComments.slice(0, root.index).trim()) {
    addError(errors, css, 0, 'Only a :root block with allowlisted custom properties is supported.');
  }

  const open = withoutComments.indexOf('{', root.index);
  let depth = 1;
  let close = -1;
  for (let index = open + 1; index < withoutComments.length; index += 1) {
    if (withoutComments[index] === '{') depth += 1;
    if (withoutComments[index] === '}') {
      depth -= 1;
      if (depth === 0) {
        close = index;
        break;
      }
    }
  }
  if (close < 0) {
    addError(errors, css, open, 'Unclosed :root block.');
    return { tokens, chat, layout, errors, appliedProperties, valid: false };
  }

  const afterRoot = withoutComments.slice(close + 1);
  if (afterRoot.trim()) {
    addError(
      errors,
      css,
      close + 1,
      'Only a :root block with allowlisted custom properties is supported.',
    );
  }

  const rootContent = withoutComments.slice(open + 1, close);

  const declaration = /--([a-z0-9-]+)\s*:\s*([^;{}]+);/gi;
  let match: RegExpExecArray | null;
  while ((match = declaration.exec(rootContent)) !== null) {
    const property = match[1].toLowerCase();
    const raw = match[2].trim().replace(/^['"]|['"]$/g, '');
    const offset = open + 1 + match.index;

    if (property in TOKEN_PROPERTIES) {
      if (!isSafeThemeColor(raw)) {
        addError(errors, css, offset, 'Expected a hex or rgb/rgba color.', property);
        continue;
      }
      tokens[TOKEN_PROPERTIES[property]] = raw;
      appliedProperties.push(property);
      continue;
    }

    if (property in CHAT_PROPERTIES) {
      const target = CHAT_PROPERTIES[property];
      if (target === 'wallpaperImage') {
        if (!localImage(raw)) {
          addError(errors, css, offset, 'Wallpaper images must be local file or content URIs.', property);
          continue;
        }
      } else if (!isSafeThemeColor(raw)) {
        addError(errors, css, offset, 'Expected a hex or rgb/rgba color.', property);
        continue;
      }
      chat[target] = raw;
      appliedProperties.push(property);
      continue;
    }

    const numeric: Record<string, keyof ThemeLayout> = {
      'bubble-radius': 'bubbleRadius',
      'font-scale': 'fontScale',
      'bubble-max-width': 'bubbleMaxWidth',
      'wallpaper-dim': 'wallpaperDim',
      'bubble-padding-h': 'bubblePaddingH',
      'bubble-padding-v': 'bubblePaddingV',
      'emoji-scale': 'emojiScale',
      'letter-spacing': 'letterSpacing',
    };
    const target = numeric[property];
    if (target) {
      const range = THEME_LAYOUT_RANGES[target];
      if (!range) {
        addError(errors, css, offset, 'Numeric property has no shared range.', property);
        continue;
      }
      const [min, max] = range;
      const parsed = numberInRange(raw, min, max);
      if (parsed === null) {
        addError(errors, css, offset, `Expected a number between ${min} and ${max}.`, property);
      } else {
        if (parsed !== Number(raw)) {
          addError(errors, css, offset, `Value is outside the safe range ${min}..${max}.`, property);
        }
        (layout as Record<string, unknown>)[target] = parsed;
        appliedProperties.push(property);
      }
      continue;
    }

    const boolean: Record<string, keyof ThemeLayout> = {
      'show-tails': 'showTails',
      'bubble-shadow': 'bubbleShadow',
      'wallpaper-pattern': 'wallpaperPattern',
      'full-width': 'fullWidthBubbles',
    };
    if (property in boolean) {
      if (raw !== 'true' && raw !== 'false') {
        addError(errors, css, offset, 'Expected true or false.', property);
      } else {
        (layout as Record<string, unknown>)[boolean[property]] = raw === 'true';
        appliedProperties.push(property);
      }
      continue;
    }

    const enums: Record<string, [keyof ThemeLayout, readonly string[]]> = {
      'my-side': ['myBubbleSide', ['left', 'right']],
      'bubble-shape': ['bubbleShape', ['tail', 'rounded', 'pill', 'square']],
      density: ['density', ['compact', 'cozy', 'roomy']],
      'send-button': ['sendButtonStyle', ['circle', 'pill', 'icon']],
      composer: ['composerStyle', ['rounded', 'flat', 'floating']],
      'header-style': ['headerStyle', ['brand', 'minimal', 'colored']],
    };
    const enumSpec = enums[property];
    if (enumSpec) {
      const parsed = enumValue(raw, enumSpec[1]);
      if (!parsed) {
        addError(errors, css, offset, `Expected one of: ${enumSpec[1].join(', ')}.`, property);
      } else {
        layout[enumSpec[0]] = parsed as never;
        appliedProperties.push(property);
      }
      continue;
    }

    addError(errors, css, offset, 'Property is not allowlisted.', property);
  }

  const residue = rootContent.replace(declaration, '').trim();
  if (residue) {
    addError(errors, css, 0, 'Only a :root block with allowlisted custom properties is supported.');
  }

  // Primary is the semantic accent. Keep the two UI selectors coherent when a
  // pack only declares --primary, while still respecting an explicit override.
  if (tokens.primary && !tokens.tint) tokens.tint = tokens.primary;
  if (tokens.primary && !tokens.tabIconSelected) tokens.tabIconSelected = tokens.primary;

  return { tokens, chat, layout, errors, appliedProperties, valid: errors.length === 0 };
}
