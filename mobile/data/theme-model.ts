import type { FontFamilyId } from './theme-fonts';
import type { IconSet, ThemeIcons } from './theme-icons';

/**
 * What a theme *is*, with none of the state that makes one current.
 *
 * Split from [theme-store] so the shape of a theme can be reasoned about —
 * and tested — without a database, a screen or a live catalog behind it. The
 * store owns which theme is active and how that survives a restart; this file
 * owns the token set, the defaults everything falls back to, and the geometry
 * derived from them.
 *
 * Everything here is pure, and — since the unused `constants/theme` import
 * went — that is now load-bearing rather than aspirational: nothing in this
 * file reaches react-native, so the tests exercise the real defaults instead
 * of a second copy that drifts.
 */

export type ThemeMode = 'light' | 'dark';

/** App-wide semantic colors a pack can override. */
export type ThemeTokens = {
  primary: string;
  onPrimary: string;
  background: string;
  surface: string;
  surfaceElevated: string;
  surfaceMuted: string;
  text: string;
  textSecondary: string;
  textMuted: string;
  border: string;
  divider: string;
  tint: string;
  icon: string;
  tabIconDefault: string;
  tabIconSelected: string;
  success: string;
  warning: string;
  danger: string;
  info: string;
};

/** Chat-thread chrome — classic GBWhatsApp-style knobs. */
export type ChatChrome = {
  /** Thread background (wallpaper solid). Empty = use surfaceMuted. */
  wallpaper: string;
  /** Local/remote image URI for photo wallpaper. */
  wallpaperImage: string;
  bubbleMine: string;
  bubbleTheirs: string;
  textMine: string;
  textTheirs: string;
  metaMine: string;
  metaTheirs: string;
  datePillBg: string;
  datePillText: string;
  composerBg: string;
  inputBg: string;
  linkMine: string;
  linkTheirs: string;
  headerBg: string;
  headerFg: string;
  sendBtnBg: string;
  replyBarBg: string;
  replyBarAccent: string;
  selectionBg: string;
  typingDot: string;
  systemBg: string;
  systemText: string;
  unreadBadge: string;
};

export type BubbleShape = 'rounded' | 'tail' | 'square' | 'pill';
export type BubbleSide = 'right' | 'left';
export type HeaderStyle = 'brand' | 'minimal' | 'colored';
export type TabBarPosition = 'top' | 'bottom';
export type TabBarLabels = 'labels' | 'icons' | 'both';
export type AvatarPosition = 'left' | 'right' | 'hidden';
export type MessageDensity = 'compact' | 'cozy' | 'roomy';
export type ComposerStyle = 'rounded' | 'flat' | 'floating';
export type CheckPosition = 'left' | 'right';
export type DatePillStyle = 'pill' | 'text' | 'hidden';
export type ReplyStyle = 'quote' | 'bar' | 'minimal';
export type SendButtonStyle = 'circle' | 'pill' | 'icon';
export type SystemMsgStyle = 'pill' | 'plain' | 'banner';
export type UnreadBadgeStyle = 'dot' | 'count' | 'none';
/** What the chat wallpaper does when nobody is touching it. */
export type WallpaperAnimation = 'none' | 'aurora' | 'drift' | 'pulse';

/** Positions, shapes & ~40 GB-style knobs. */
export type ThemeLayout = {
  /** Which side YOUR messages sit on (swap = WA-GB classic). */
  myBubbleSide: BubbleSide;
  bubbleShape: BubbleShape;
  /** Corner radius 4–28 when shape is rounded/tail. */
  bubbleRadius: number;
  showTails: boolean;
  /** Message text scale 0.85–1.35 */
  fontScale: number;
  density: MessageDensity;
  avatarPosition: AvatarPosition;
  selectionCheckSide: CheckPosition;
  headerStyle: HeaderStyle;
  /** Where the chats/stories/discover switcher sits. */
  tabBarPosition: TabBarPosition;
  /** Whether that switcher shows icons, labels, or both. */
  tabBarLabels: TabBarLabels;
  /** Which drawing of every icon in the app the theme asks for. */
  iconSet: IconSet;
  /** Icon size multiplier, 0.8–1.4. */
  iconScale: number;
  /** Which typeface the app draws every string in. */
  fontFamily: FontFamilyId;
  /**
   * Collapse dark surfaces to true black, whatever pack is active.
   *
   * Not a palette and not a pack — a switch that runs *over* the theme in
   * force, because someone on an OLED panel wants the power saving without
   * giving up the colours they chose. Ignored in light mode.
   */
  amoledBlack: boolean;
  /** Blur the header, composer and tab bar over what scrolls beneath. */
  glassChrome: boolean;
  /** Blur strength 10–100 when glassChrome is on. */
  glassIntensity: number;
  composerStyle: ComposerStyle;
  /** Pattern overlay on wallpaper */
  wallpaperPattern: boolean;
  /** Max bubble width 60–92 (% of row) */
  bubbleMaxWidth: number;
  // ── Extra personalization knobs ──────────────────────────────────────────
  bubblePaddingH: number;
  bubblePaddingV: number;
  emojiScale: number;
  letterSpacing: number;
  lineHeightExtra: number;
  bubbleShadow: boolean;
  bubbleShadowStrength: number;
  timestampInside: boolean;
  datePillStyle: DatePillStyle;
  replyStyle: ReplyStyle;
  sendButtonStyle: SendButtonStyle;
  attachSide: CheckPosition;
  inputRadius: number;
  listAvatarSize: number;
  showOnlineDot: boolean;
  showHeaderBorder: boolean;
  /** 0–80 darken overlay on photo wallpaper */
  wallpaperDim: number;
  wallpaperBlur: boolean;
  wallpaperAnimation: WallpaperAnimation;
  reactionScale: number;
  swipeReply: boolean;
  selectionHighlight: boolean;
  systemMsgStyle: SystemMsgStyle;
  chatHeaderCompact: boolean;
  fullWidthBubbles: boolean;
  groupSenderBold: boolean;
  metaSize: number;
  enterSends: boolean;
  hapticsOnReact: boolean;
  squircleCorners: boolean;
  linkUnderline: boolean;
  unreadBadgeStyle: UnreadBadgeStyle;
  showTypingDots: boolean;
  boldOutgoing: boolean;
  dimIncoming: boolean;
  largeTimestamps: boolean;
  centerDatePills: boolean;
  gapAfterGroup: number;
};

export type ThemeCategory =
  | 'all'
  | 'official'
  | 'neon'
  | 'pastel'
  | 'minimal'
  | 'nature'
  | 'midnight'
  | 'mine';

export type ThemePack = {
  id: string;
  name: string;
  author: string;
  description: string;
  category: Exclude<ThemeCategory, 'all' | 'mine'>;
  downloads: number;
  likes: number;
  price: 0 | number;
  swatches: string[];
  tokens: {
    light?: Partial<ThemeTokens>;
    dark?: Partial<ThemeTokens>;
  };
  /** Per-scheme chat chrome overrides. */
  chat?: {
    light?: Partial<ChatChrome>;
    dark?: Partial<ChatChrome>;
  };
  layout?: Partial<ThemeLayout>;
  /** Per-slot icon images, replacing the set's glyph. */
  icons?: ThemeIcons;
  /** Advanced CSS vars (parsed on apply / edit). */
  customCss?: string;
  /** Last AI prompt used to generate this pack. */
  aiPrompt?: string;
  isOfficial?: boolean;
  isOwned?: boolean;
  /** Forked from another pack id. */
  forkedFrom?: string;
};

export type SchemePreference = 'system' | 'light' | 'dark';

export type CreateThemeInput = {
  name: string;
  description?: string;
  category: ThemePack['category'];
  mode: ThemeMode | 'both';
  primary: string;
  background: string;
  surface: string;
  text: string;
  secondary?: string;
  chat?: Partial<ChatChrome>;
  layout?: Partial<ThemeLayout>;
  icons?: ThemeIcons;
  customCss?: string;
  aiPrompt?: string;
  /** Update existing owned pack instead of creating. */
  editId?: string;
  /** Fork source id (becomes forkedFrom). */
  forkFromId?: string;
};

// ── Defaults ────────────────────────────────────────────────────────────────

export const DEFAULT_LAYOUT: ThemeLayout = {
  myBubbleSide: 'right',
  bubbleShape: 'tail',
  bubbleRadius: 16,
  showTails: true,
  fontScale: 1,
  density: 'cozy',
  avatarPosition: 'left',
  selectionCheckSide: 'left',
  headerStyle: 'brand',
  tabBarPosition: 'top',
  tabBarLabels: 'labels',
  iconSet: 'outline',
  iconScale: 1,
  // 'system' is not one font among six — it is the only value that leaves
  // `fontFamily` unset, and so the only one that keeps iOS dynamic type.
  fontFamily: 'system',
  amoledBlack: false,
  glassChrome: false,
  glassIntensity: 45,
  composerStyle: 'rounded',
  wallpaperPattern: false,
  bubbleMaxWidth: 82,
  bubblePaddingH: 11,
  bubblePaddingV: 7,
  emojiScale: 1,
  letterSpacing: 0,
  lineHeightExtra: 0,
  bubbleShadow: true,
  bubbleShadowStrength: 0.35,
  timestampInside: true,
  datePillStyle: 'pill',
  replyStyle: 'quote',
  sendButtonStyle: 'circle',
  // 'right' because that is where the composer has always put attach and
  // camera. The knob defaulted to 'left' while the screen ignored it, so the
  // default described a layout the app never rendered.
  attachSide: 'right',
  inputRadius: 22,
  listAvatarSize: 48,
  showOnlineDot: true,
  showHeaderBorder: true,
  wallpaperDim: 35,
  wallpaperBlur: false,
  wallpaperAnimation: 'none',
  reactionScale: 1,
  swipeReply: true,
  selectionHighlight: true,
  systemMsgStyle: 'pill',
  chatHeaderCompact: false,
  fullWidthBubbles: false,
  groupSenderBold: true,
  metaSize: 11,
  enterSends: true,
  hapticsOnReact: true,
  squircleCorners: false,
  linkUnderline: true,
  unreadBadgeStyle: 'count',
  showTypingDots: true,
  boldOutgoing: false,
  dimIncoming: false,
  largeTimestamps: false,
  centerDatePills: true,
  gapAfterGroup: 8,
};

export function defaultChatChrome(scheme: ThemeMode, primary: string): ChatChrome {
  if (scheme === 'dark') {
    return {
      wallpaper: '#131419',
      wallpaperImage: '',
      bubbleMine: primary,
      bubbleTheirs: '#191A21',
      textMine: '#FFFFFF',
      textTheirs: '#ECEDF2',
      metaMine: 'rgba(255,255,255,0.72)',
      metaTheirs: '#6C6E7A',
      datePillBg: '#191A21',
      datePillText: '#9A9CA8',
      composerBg: '#131419',
      inputBg: '#191A21',
      linkMine: '#BFDBFE',
      linkTheirs: primary,
      headerBg: '#191A21',
      headerFg: '#ECEDF2',
      sendBtnBg: primary,
      replyBarBg: '#23242D',
      replyBarAccent: primary,
      selectionBg: `${primary}22`,
      typingDot: '#6C6E7A',
      systemBg: '#191A21',
      systemText: '#9A9CA8',
      unreadBadge: primary,
    };
  }
  return {
    wallpaper: '#EEF1F6',
    wallpaperImage: '',
    bubbleMine: primary,
    bubbleTheirs: '#FFFFFF',
    textMine: '#FFFFFF',
    textTheirs: '#111827',
    metaMine: 'rgba(255,255,255,0.78)',
    metaTheirs: '#9AA3B2',
    datePillBg: '#FFFFFF',
    datePillText: '#6B7280',
    composerBg: '#EEF1F6',
    inputBg: '#FFFFFF',
    linkMine: '#DBEAFE',
    linkTheirs: primary,
    headerBg: primary,
    headerFg: '#FFFFFF',
    sendBtnBg: primary,
    replyBarBg: '#F0F4FF',
    replyBarAccent: primary,
    selectionBg: `${primary}18`,
    typingDot: '#9AA3B2',
    systemBg: '#FFFFFF',
    systemText: '#6B7280',
    unreadBadge: primary,
  };
}

// ── Colour helpers ──────────────────────────────────────────────────────────

/**
 * The same colour at a given opacity.
 *
 * Themes store colour as whatever the person typed — `#0A0`, `#0A0F1E`, an
 * eight-digit hex with alpha already on it, or an `rgb()/rgba()` string — so
 * anything that wants to tint one has to cope with all four. Returns the
 * input untouched when it cannot be parsed, because a slightly-too-opaque
 * panel is a much better failure than a transparent one.
 */
export function withAlpha(color: string, alpha: number): string {
  const a = Math.max(0, Math.min(1, alpha));
  const c = color.trim();

  const hex = /^#([0-9a-f]{3,8})$/i.exec(c);
  if (hex) {
    const h = hex[1];
    let r: number, g: number, b: number;
    if (h.length === 3 || h.length === 4) {
      r = parseInt(h[0] + h[0], 16);
      g = parseInt(h[1] + h[1], 16);
      b = parseInt(h[2] + h[2], 16);
    } else if (h.length === 6 || h.length === 8) {
      r = parseInt(h.slice(0, 2), 16);
      g = parseInt(h.slice(2, 4), 16);
      b = parseInt(h.slice(4, 6), 16);
    } else {
      return color;
    }
    return `rgba(${r},${g},${b},${a})`;
  }

  const rgb = /^rgba?\(([^)]+)\)$/i.exec(c);
  if (rgb) {
    const parts = rgb[1].split(',').map((v) => v.trim());
    if (parts.length >= 3) return `rgba(${parts[0]},${parts[1]},${parts[2]},${a})`;
  }
  return color;
}

// ── AMOLED ──────────────────────────────────────────────────────────────────

/**
 * The three greys true black still needs.
 *
 * A panel saves power on `#000000` because the pixel is *off*; nothing below
 * about #0A reads as lit. But an interface of nothing but off pixels has no
 * edges — every card, input and bubble dissolves into the same void. So the
 * background goes fully off and the things that sit on it are lifted just
 * enough to have a boundary, which costs almost nothing and is the difference
 * between a dark theme and an unusable one.
 */
const AMOLED_BLACK = '#000000';
const AMOLED_SURFACE = '#0A0A0A';
const AMOLED_ELEVATED = '#141414';
const AMOLED_BORDER = '#1C1C1C';
const AMOLED_DIVIDER = '#111111';

/**
 * Flatten a dark palette's surfaces to true black, keeping its colours.
 *
 * Only the *ground* is rewritten — background, surfaces, borders. Primary,
 * text and the semantic accents are left exactly as the pack set them, which
 * is what separates this from being a thirteenth pack: someone who likes
 * Luanda Sunset and owns an OLED phone should get their oranges on black,
 * not somebody else's monochrome.
 */
export function amoledizeTokens(tokens: ThemeTokens): ThemeTokens {
  return {
    ...tokens,
    background: AMOLED_BLACK,
    surfaceMuted: AMOLED_BLACK,
    surface: AMOLED_SURFACE,
    surfaceElevated: AMOLED_ELEVATED,
    border: AMOLED_BORDER,
    divider: AMOLED_DIVIDER,
  };
}

/**
 * The same flattening for chat chrome.
 *
 * `bubbleMine`, `sendBtnBg` and the link colours are deliberately untouched —
 * they carry the theme's accent, and blacking them out would leave a thread
 * with no colour in it at all. `wallpaperImage` survives too: a photo
 * wallpaper is a thing somebody chose, not a surface to be flattened.
 */
export function amoledizeChat(chrome: ChatChrome): ChatChrome {
  return {
    ...chrome,
    wallpaper: AMOLED_BLACK,
    composerBg: AMOLED_BLACK,
    headerBg: AMOLED_BLACK,
    inputBg: AMOLED_SURFACE,
    bubbleTheirs: AMOLED_SURFACE,
    datePillBg: AMOLED_SURFACE,
    systemBg: AMOLED_SURFACE,
    replyBarBg: AMOLED_ELEVATED,
  };
}

function densityGap(d: MessageDensity): number {
  if (d === 'compact') return 2;
  if (d === 'roomy') return 10;
  return 6;
}

export function layoutMetrics(layout: ThemeLayout) {
  const baseFont = Math.round(15 * layout.fontScale);
  return {
    rowGap: densityGap(layout.density) + Math.max(0, layout.gapAfterGroup - 8) * 0.25,
    groupedGap: layout.density === 'compact' ? 1 : 2,
    fontSize: baseFont,
    lineHeight: Math.round(20 * layout.fontScale) + layout.lineHeightExtra,
    maxWidthPct: layout.fullWidthBubbles ? 94 : layout.bubbleMaxWidth,
    bubblePaddingH: layout.bubblePaddingH,
    bubblePaddingV: layout.bubblePaddingV,
    letterSpacing: layout.letterSpacing,
    metaSize: layout.largeTimestamps ? layout.metaSize + 2 : layout.metaSize,
    emojiScale: layout.emojiScale,
    reactionScale: layout.reactionScale,
    shadowOpacity: layout.bubbleShadow ? 0.04 + layout.bubbleShadowStrength * 0.12 : 0,
    inputRadius: layout.inputRadius,
  };
}

/** Border radii for a bubble given shape + mine + last-in-group. */
export function bubbleRadii(
  layout: ThemeLayout,
  mine: boolean,
  isLast: boolean,
  mySide: BubbleSide,
): {
  borderTopLeftRadius: number;
  borderTopRightRadius: number;
  borderBottomLeftRadius: number;
  borderBottomRightRadius: number;
} {
  const r = layout.bubbleRadius;
  if (layout.bubbleShape === 'square') {
    return {
      borderTopLeftRadius: 4,
      borderTopRightRadius: 4,
      borderBottomLeftRadius: 4,
      borderBottomRightRadius: 4,
    };
  }
  if (layout.bubbleShape === 'pill') {
    const p = Math.max(r, 22);
    return {
      borderTopLeftRadius: p,
      borderTopRightRadius: p,
      borderBottomLeftRadius: p,
      borderBottomRightRadius: p,
    };
  }
  // rounded / tail
  const tail = layout.showTails && layout.bubbleShape === 'tail' && isLast ? 4 : r;
  // Tail sits on the outer edge of the bubble relative to alignment.
  const mineOnRight = mySide === 'right';
  if (mine) {
    return {
      borderTopLeftRadius: r,
      borderTopRightRadius: r,
      borderBottomLeftRadius: mineOnRight ? r : tail,
      borderBottomRightRadius: mineOnRight ? tail : r,
    };
  }
  // theirs — opposite outer corner
  return {
    borderTopLeftRadius: r,
    borderTopRightRadius: r,
    borderBottomLeftRadius: mineOnRight ? tail : r,
    borderBottomRightRadius: mineOnRight ? r : tail,
  };
}

// ── Option lists (creator UI) ───────────────────────────────────────────────

export const THEME_CATEGORIES: ThemeCategory[] = [
  'all',
  'official',
  'neon',
  'pastel',
  'minimal',
  'nature',
  'midnight',
  'mine',
];

export const BUBBLE_SHAPES: BubbleShape[] = ['tail', 'rounded', 'pill', 'square'];
export const DENSITIES: MessageDensity[] = ['compact', 'cozy', 'roomy'];
export const HEADER_STYLES: HeaderStyle[] = ['brand', 'minimal', 'colored'];
export const COMPOSER_STYLES: ComposerStyle[] = ['rounded', 'flat', 'floating'];
export const DATE_PILL_STYLES: DatePillStyle[] = ['pill', 'text', 'hidden'];
export const REPLY_STYLES: ReplyStyle[] = ['quote', 'bar', 'minimal'];
export const SEND_STYLES: SendButtonStyle[] = ['circle', 'pill', 'icon'];
export const SYSTEM_STYLES: SystemMsgStyle[] = ['pill', 'plain', 'banner'];

export const WALLPAPER_ANIMATIONS: WallpaperAnimation[] = ['none', 'aurora', 'drift', 'pulse'];

export const TAB_BAR_POSITIONS: TabBarPosition[] = ['top', 'bottom'];
export const TAB_BAR_LABEL_MODES: TabBarLabels[] = ['labels', 'icons', 'both'];

