import {
  getAppIconName,
  setAlternateAppIcon,
  supportsAlternateIcons,
} from 'expo-alternate-app-icons';
import { useSyncExternalStore } from 'react';

import { Colors } from '@/constants/theme';

import {
  deleteStoredPack,
  listStoredPacks,
  readThemePrefs,
  saveStoredPack,
  writeThemePrefs,
} from './db/themes';
import { pruneThemeImages } from './theme-assets';
import { EMPTY_ICONS, type ThemeIcons } from './theme-icons';
import {
  appIconFromPluginName,
  appIconSpec,
  type AppIconId,
} from './theme-app-icons';
import { loadFontFamily, needsFontLoad } from './theme-font-assets';
import { type FontFamilyId } from './theme-fonts';
import {
  DEFAULT_LAYOUT,
  amoledizeChat,
  amoledizeTokens,
  defaultChatChrome,
  type BubbleShape,
  type ChatChrome,
  type ComposerStyle,
  type CreateThemeInput,
  type HeaderStyle,
  type MessageDensity,
  type SchemePreference,
  type SendButtonStyle,
  type ThemeLayout,
  type ThemeMode,
  type ThemePack,
  type ThemeTokens,
} from './theme-model';
import {
  DEFAULT_PACK_ID,
  hydrateThemeState,
  serializeThemePrefs,
} from './theme-persistence';

/**
 * Theme marketplace + GB-style creator.
 *
 * Layers (bottom → top):
 *   1. Base Colors (light/dark)
 *   2. Active pack tokens / chat / layout
 *   3. Personal overrides (always-on tweaks for the user)
 */

/**
 * The theme vocabulary — types, defaults, geometry — lives in [theme-model]
 * and is re-exported here so every screen keeps one import for "themes".
 */
export * from './theme-model';

// ── Defaults ────────────────────────────────────────────────────────────────

const baseLight = Colors.light as unknown as ThemeTokens;
const baseDark = Colors.dark as unknown as ThemeTokens;

// ── Pack helpers ────────────────────────────────────────────────────────────

function pack(
  partial: Omit<ThemePack, 'swatches'> & { swatches?: string[] },
): ThemePack {
  const primary =
    partial.tokens.light?.primary ??
    partial.tokens.dark?.primary ??
    Colors.light.primary;
  const bg =
    partial.tokens.light?.background ??
    partial.tokens.dark?.background ??
    Colors.light.background;
  const surface =
    partial.tokens.light?.surface ??
    partial.tokens.dark?.surface ??
    Colors.light.surface;
  const text =
    partial.tokens.light?.text ??
    partial.tokens.dark?.text ??
    Colors.light.text;
  return {
    ...partial,
    layout: { ...DEFAULT_LAYOUT, ...partial.layout },
    swatches: partial.swatches ?? [primary, bg, surface, text],
  };
}

const MARKETPLACE: ThemePack[] = [
  pack({
    id: 'official-default',
    name: 'Socialize Blue',
    author: 'Yo',
    description: 'The default royal blue — calm, clear, on-brand.',
    category: 'official',
    // Bundled, so there is nothing to count. The 128,400 installs this used
    // to claim were invented, and a made-up number is worse than none.
    downloads: 0,
    likes: 0,
    price: 0,
    isOfficial: true,
    tokens: {},
    layout: { ...DEFAULT_LAYOUT },
  }),
  pack({
    id: 'midnight-ink',
    name: 'Midnight Ink',
    author: 'Studio Noir',
    description: 'Deep charcoal with electric indigo — roomy bubbles.',
    category: 'midnight',
    downloads: 48200,
    likes: 5102,
    price: 0,
    tokens: {
      dark: {
        primary: '#818CF8',
        tint: '#818CF8',
        tabIconSelected: '#818CF8',
        background: '#07080C',
        surface: '#12141C',
        surfaceElevated: '#1A1D28',
        surfaceMuted: '#0C0E14',
        text: '#F1F2F6',
        textSecondary: '#9CA0B0',
        textMuted: '#6B6F80',
        border: '#262A38',
        divider: '#1A1D28',
        onPrimary: '#0B0C10',
      },
      light: {
        primary: '#4F46E5',
        tint: '#4F46E5',
        tabIconSelected: '#4F46E5',
        background: '#F4F5FB',
        surface: '#FFFFFF',
        surfaceElevated: '#FFFFFF',
        surfaceMuted: '#E8EAF5',
        text: '#111827',
        textSecondary: '#5B6178',
        border: '#D8DCEB',
      },
    },
    chat: {
      dark: {
        wallpaper: '#0C0E14',
        bubbleMine: '#818CF8',
        bubbleTheirs: '#1A1D28',
        textMine: '#0B0C10',
        textTheirs: '#F1F2F6',
      },
    },
    layout: { density: 'roomy', bubbleRadius: 18, bubbleMaxWidth: 78 },
  }),
  pack({
    id: 'coral-dawn',
    name: 'Coral Dawn',
    author: 'Lumen Lab',
    description: 'Warm coral primary on soft cream surfaces.',
    category: 'pastel',
    downloads: 33100,
    likes: 4201,
    price: 0,
    tokens: {
      light: {
        primary: '#F97366',
        tint: '#F97366',
        tabIconSelected: '#F97366',
        background: '#FFF8F5',
        surface: '#FFFFFF',
        surfaceMuted: '#FFEDE8',
        surfaceElevated: '#FFFFFF',
        text: '#1C1412',
        textSecondary: '#7A5F58',
        textMuted: '#B39A93',
        border: '#F0D9D2',
        divider: '#F7E8E3',
        onPrimary: '#FFFFFF',
      },
      dark: {
        primary: '#FB8A7E',
        tint: '#FB8A7E',
        tabIconSelected: '#FB8A7E',
        background: '#140E0D',
        surface: '#1F1614',
        surfaceElevated: '#2A1E1B',
        surfaceMuted: '#181210',
        text: '#F8EFEC',
        textSecondary: '#C4A8A0',
        border: '#3A2A26',
        onPrimary: '#1A0F0D',
      },
    },
    layout: { bubbleShape: 'pill', showTails: false, bubbleRadius: 22 },
  }),
  pack({
    id: 'neon-lime',
    name: 'Neon Lime',
    author: 'Arcade Room',
    description: 'Black canvas, acid lime — compact, left-hand mode.',
    category: 'neon',
    downloads: 27500,
    likes: 3800,
    price: 0,
    tokens: {
      dark: {
        primary: '#A3E635',
        tint: '#A3E635',
        tabIconSelected: '#A3E635',
        background: '#050605',
        surface: '#0F120E',
        surfaceElevated: '#171B15',
        surfaceMuted: '#0A0C09',
        text: '#F4FFE8',
        textSecondary: '#A8B896',
        textMuted: '#6E7A60',
        border: '#243020',
        divider: '#171B15',
        onPrimary: '#0A1205',
        success: '#A3E635',
      },
      light: {
        primary: '#65A30D',
        tint: '#65A30D',
        tabIconSelected: '#65A30D',
        background: '#F7FCEF',
        surface: '#FFFFFF',
        surfaceMuted: '#EAF5D8',
        text: '#14200A',
        textSecondary: '#4B5D32',
        border: '#D4E5B5',
        onPrimary: '#FFFFFF',
      },
    },
    chat: {
      dark: {
        wallpaper: '#050605',
        bubbleMine: '#A3E635',
        bubbleTheirs: '#171B15',
        textMine: '#0A1205',
        textTheirs: '#F4FFE8',
      },
    },
    layout: {
      myBubbleSide: 'left',
      density: 'compact',
      bubbleShape: 'square',
      showTails: false,
      bubbleRadius: 8,
      wallpaperPattern: true,
    },
  }),
  pack({
    id: 'ocean-glass',
    name: 'Ocean Glass',
    author: 'North Tide',
    description: 'Teal waters and frosted glass surfaces.',
    category: 'nature',
    downloads: 19800,
    likes: 2400,
    price: 0,
    tokens: {
      light: {
        primary: '#0D9488',
        tint: '#0D9488',
        tabIconSelected: '#0D9488',
        background: '#F0FDFA',
        surface: '#FFFFFF',
        surfaceMuted: '#CCFBF1',
        text: '#042F2E',
        textSecondary: '#0F766E',
        border: '#99F6E4',
        onPrimary: '#FFFFFF',
      },
      dark: {
        primary: '#2DD4BF',
        tint: '#2DD4BF',
        tabIconSelected: '#2DD4BF',
        background: '#042F2E',
        surface: '#0B3D3B',
        surfaceElevated: '#115E59',
        surfaceMuted: '#063836',
        text: '#F0FDFA',
        textSecondary: '#99F6E4',
        border: '#134E4A',
        onPrimary: '#042F2E',
      },
    },
    layout: { bubbleRadius: 14, fontScale: 1.05, bubbleMaxWidth: 86 },
  }),
  pack({
    id: 'paper-minimal',
    name: 'Paper Minimal',
    author: 'Grid & Ink',
    description: 'Almost monochrome. Square bubbles, no tails.',
    category: 'minimal',
    downloads: 41200,
    likes: 6100,
    price: 0,
    tokens: {
      light: {
        primary: '#171717',
        tint: '#171717',
        tabIconSelected: '#171717',
        background: '#FAFAFA',
        surface: '#FFFFFF',
        surfaceMuted: '#F0F0F0',
        text: '#0A0A0A',
        textSecondary: '#525252',
        textMuted: '#A3A3A3',
        border: '#E5E5E5',
        divider: '#F0F0F0',
        onPrimary: '#FFFFFF',
      },
      dark: {
        primary: '#FAFAFA',
        tint: '#FAFAFA',
        tabIconSelected: '#FAFAFA',
        background: '#0A0A0A',
        surface: '#141414',
        surfaceElevated: '#1F1F1F',
        surfaceMuted: '#111111',
        text: '#FAFAFA',
        textSecondary: '#A3A3A3',
        border: '#262626',
        onPrimary: '#0A0A0A',
      },
    },
    layout: {
      bubbleShape: 'square',
      showTails: false,
      bubbleRadius: 6,
      density: 'compact',
      headerStyle: 'minimal',
    },
  }),
  pack({
    id: 'sunset-blvd',
    name: 'Sunset Blvd',
    author: 'Violet Hour',
    description: 'Magenta dusk — large type, floating composer.',
    category: 'neon',
    downloads: 15600,
    likes: 1980,
    price: 0,
    tokens: {
      dark: {
        primary: '#E879F9',
        tint: '#E879F9',
        tabIconSelected: '#E879F9',
        background: '#120814',
        surface: '#1C0F20',
        surfaceElevated: '#2A1530',
        surfaceMuted: '#160A18',
        text: '#FDF4FF',
        textSecondary: '#D8B4E2',
        border: '#3B2044',
        onPrimary: '#1A0A1C',
      },
      light: {
        primary: '#C026D3',
        tint: '#C026D3',
        tabIconSelected: '#C026D3',
        background: '#FDF4FF',
        surface: '#FFFFFF',
        surfaceMuted: '#FAE8FF',
        text: '#3B0764',
        textSecondary: '#86198F',
        border: '#F0ABFC',
        onPrimary: '#FFFFFF',
      },
    },
    layout: {
      fontScale: 1.12,
      composerStyle: 'floating',
      bubbleShape: 'pill',
      showTails: false,
      wallpaperPattern: true,
    },
  }),
  pack({
    id: 'forest-cabin',
    name: 'Forest Cabin',
    author: 'Moss & Pine',
    description: 'Earthy greens — avatars on the right, checks right.',
    category: 'nature',
    downloads: 22100,
    likes: 2900,
    price: 0,
    tokens: {
      light: {
        primary: '#3F6212',
        tint: '#3F6212',
        tabIconSelected: '#3F6212',
        background: '#F7F6F1',
        surface: '#FFFEF9',
        surfaceMuted: '#E8E6DB',
        text: '#1A1F12',
        textSecondary: '#4B5638',
        border: '#D4D0C0',
        onPrimary: '#FFFFFF',
      },
      dark: {
        primary: '#A3B18A',
        tint: '#A3B18A',
        tabIconSelected: '#A3B18A',
        background: '#12150F',
        surface: '#1A1F16',
        surfaceElevated: '#242A1E',
        surfaceMuted: '#151910',
        text: '#ECEDE6',
        textSecondary: '#A8B09A',
        border: '#2E3528',
        onPrimary: '#12150F',
      },
    },
    layout: {
      avatarPosition: 'right',
      selectionCheckSide: 'right',
      bubbleRadius: 12,
    },
  }),
  // ── Bundled packs ─────────────────────────────────────────────────────────
  //
  // These ship with the app: authored by the project, and with no install or
  // like counts to invent. Each one sets shape as well as colour — a theme
  // that only repaints the palette is a filter, not a theme, and the point of
  // the layout knobs is that applying a pack can move the furniture too.
  pack({
    id: 'infinite-blue',
    name: 'Infinite Blue',
    author: 'Yo',
    description: 'Electric blue over a white void. Sharp icons, deep dark.',
    category: 'midnight',
    downloads: 0,
    likes: 0,
    price: 0,
    isOfficial: true,
    tokens: {
      dark: {
        primary: '#3FA9FF',
        tint: '#3FA9FF',
        tabIconSelected: '#3FA9FF',
        background: '#05070D',
        surface: '#0C1119',
        surfaceElevated: '#131A26',
        surfaceMuted: '#080C13',
        text: '#EAF4FF',
        textSecondary: '#8FA6C0',
        textMuted: '#5C7391',
        border: '#1B2634',
        divider: '#121A25',
        onPrimary: '#03080F',
        info: '#7CC4FF',
      },
      light: {
        primary: '#0A84FF',
        tint: '#0A84FF',
        tabIconSelected: '#0A84FF',
        background: '#F7FAFF',
        surface: '#FFFFFF',
        surfaceElevated: '#FFFFFF',
        surfaceMuted: '#EDF3FC',
        text: '#0A1220',
        textSecondary: '#4B5C72',
        textMuted: '#8496AC',
        border: '#DCE6F4',
        divider: '#EAF1FA',
        onPrimary: '#FFFFFF',
      },
    },
    chat: {
      dark: {
        wallpaper: '#05070D',
        bubbleTheirs: '#0F1622',
        bubbleMine: '#0A6ED1',
        textMine: '#F2F9FF',
        headerBg: '#080C13',
        headerFg: '#EAF4FF',
      },
      light: {
        wallpaper: '#EEF4FD',
        bubbleTheirs: '#FFFFFF',
        bubbleMine: '#0A84FF',
      },
    },
    layout: {
      bubbleShape: 'rounded',
      bubbleRadius: 20,
      showTails: false,
      iconSet: 'sharp',
      iconScale: 1.05,
      tabBarLabels: 'both',
      headerStyle: 'minimal',
      density: 'roomy',
      bubbleShadow: false,
    },
  }),
  pack({
    id: 'luanda-sunset',
    name: 'Luanda Sunset',
    author: 'Yo',
    description: 'Amber and terracotta over sand. Tailed bubbles, filled icons.',
    category: 'nature',
    downloads: 0,
    likes: 0,
    price: 0,
    isOfficial: true,
    tokens: {
      light: {
        primary: '#E2622B',
        tint: '#E2622B',
        tabIconSelected: '#E2622B',
        background: '#FFF7EF',
        surface: '#FFFFFF',
        surfaceElevated: '#FFFFFF',
        surfaceMuted: '#FBEBDA',
        text: '#241408',
        textSecondary: '#7C5233',
        textMuted: '#B08A66',
        border: '#EFD9C1',
        divider: '#F7E7D6',
        onPrimary: '#FFFFFF',
        warning: '#D98A17',
      },
      dark: {
        primary: '#F5854A',
        tint: '#F5854A',
        tabIconSelected: '#F5854A',
        background: '#150C06',
        surface: '#22150C',
        surfaceElevated: '#2D1D11',
        surfaceMuted: '#1A0F07',
        text: '#FBEEE2',
        textSecondary: '#C79E7C',
        textMuted: '#8E6D53',
        border: '#3A2618',
        divider: '#241609',
        onPrimary: '#1A0C03',
      },
    },
    chat: {
      light: {
        wallpaper: '#F6E3CE',
        bubbleMine: '#E2622B',
        bubbleTheirs: '#FFFFFF',
      },
      dark: {
        wallpaper: '#160D06',
        bubbleMine: '#B44A1C',
        bubbleTheirs: '#241609',
      },
    },
    layout: {
      bubbleShape: 'tail',
      showTails: true,
      bubbleRadius: 14,
      iconSet: 'filled',
      density: 'cozy',
      headerStyle: 'colored',
    },
  }),
  pack({
    id: 'phosphor',
    name: 'Phosphor',
    author: 'Yo',
    description: 'Green on black, square corners, no shadows. A terminal.',
    category: 'neon',
    downloads: 0,
    likes: 0,
    price: 0,
    isOfficial: true,
    tokens: {
      dark: {
        primary: '#31E981',
        tint: '#31E981',
        tabIconSelected: '#31E981',
        background: '#000000',
        surface: '#080B08',
        surfaceElevated: '#0D120D',
        surfaceMuted: '#050705',
        text: '#CFF5DF',
        textSecondary: '#5FA97C',
        textMuted: '#3C7355',
        border: '#12291C',
        divider: '#0C1B12',
        onPrimary: '#00160A',
        success: '#31E981',
      },
      light: {
        primary: '#0F7A45',
        tint: '#0F7A45',
        tabIconSelected: '#0F7A45',
        background: '#F2F7F3',
        surface: '#FFFFFF',
        surfaceElevated: '#FFFFFF',
        surfaceMuted: '#E4EFE8',
        text: '#06120B',
        textSecondary: '#3D5A48',
        textMuted: '#7A9686',
        border: '#CFE2D6',
        divider: '#E1EDE5',
        onPrimary: '#FFFFFF',
      },
    },
    chat: {
      dark: {
        wallpaper: '#000000',
        bubbleMine: '#0B3B22',
        bubbleTheirs: '#0A0F0B',
        textMine: '#8CF3B8',
        textTheirs: '#CFF5DF',
        headerBg: '#000000',
        headerFg: '#31E981',
        typingDot: '#31E981',
      },
      light: {
        wallpaper: '#E9F2EC',
        bubbleMine: '#0F7A45',
        bubbleTheirs: '#FFFFFF',
      },
    },
    layout: {
      bubbleShape: 'square',
      showTails: false,
      bubbleShadow: false,
      iconSet: 'sharp',
      density: 'compact',
      letterSpacing: 0.3,
      headerStyle: 'minimal',
      composerStyle: 'flat',
      datePillStyle: 'text',
      systemMsgStyle: 'plain',
    },
  }),
  pack({
    id: 'sakura-milk',
    name: 'Sakura Milk',
    author: 'Yo',
    description: 'Soft pink on cream. Pill bubbles, roomy spacing, big type.',
    category: 'pastel',
    downloads: 0,
    likes: 0,
    price: 0,
    isOfficial: true,
    tokens: {
      light: {
        primary: '#E86FA0',
        tint: '#E86FA0',
        tabIconSelected: '#E86FA0',
        background: '#FFF6F9',
        surface: '#FFFFFF',
        surfaceElevated: '#FFFFFF',
        surfaceMuted: '#FCE7EF',
        text: '#2A1520',
        textSecondary: '#8A5C72',
        textMuted: '#BE94A6',
        border: '#F5D8E3',
        divider: '#FBE9F0',
        onPrimary: '#FFFFFF',
      },
      dark: {
        primary: '#F58FB8',
        tint: '#F58FB8',
        tabIconSelected: '#F58FB8',
        background: '#160B11',
        surface: '#22131B',
        surfaceElevated: '#2C1A24',
        surfaceMuted: '#1B0E15',
        text: '#FBEAF1',
        textSecondary: '#CE9FB4',
        textMuted: '#96697C',
        border: '#3A2130',
        divider: '#26141D',
        onPrimary: '#1A0910',
      },
    },
    chat: {
      light: {
        wallpaper: '#FBE8F0',
        bubbleMine: '#E86FA0',
        bubbleTheirs: '#FFFFFF',
      },
      dark: {
        wallpaper: '#180C12',
        bubbleMine: '#B4547B',
        bubbleTheirs: '#241521',
      },
    },
    layout: {
      bubbleShape: 'pill',
      showTails: false,
      bubbleRadius: 24,
      density: 'roomy',
      fontScale: 1.08,
      iconSet: 'outline',
      iconScale: 1.1,
      composerStyle: 'floating',
      inputRadius: 26,
    },
  }),
  pack({
    id: 'amoled-void',
    name: 'AMOLED Void',
    author: 'Yo',
    description: 'True black for OLED panels. Icons at the bottom, labels off.',
    category: 'midnight',
    downloads: 0,
    likes: 0,
    price: 0,
    isOfficial: true,
    tokens: {
      dark: {
        primary: '#FFFFFF',
        tint: '#FFFFFF',
        tabIconSelected: '#FFFFFF',
        background: '#000000',
        surface: '#000000',
        surfaceElevated: '#0A0A0A',
        surfaceMuted: '#000000',
        text: '#F5F5F5',
        textSecondary: '#9A9A9A',
        textMuted: '#5E5E5E',
        border: '#1C1C1C',
        divider: '#141414',
        onPrimary: '#000000',
      },
      light: {
        primary: '#111111',
        tint: '#111111',
        tabIconSelected: '#111111',
        background: '#FFFFFF',
        surface: '#FFFFFF',
        surfaceElevated: '#FFFFFF',
        surfaceMuted: '#F4F4F4',
        text: '#0A0A0A',
        textSecondary: '#5A5A5A',
        textMuted: '#8E8E8E',
        border: '#E4E4E4',
        divider: '#EFEFEF',
        onPrimary: '#FFFFFF',
      },
    },
    chat: {
      dark: {
        wallpaper: '#000000',
        bubbleMine: '#1C1C1C',
        bubbleTheirs: '#0C0C0C',
        textMine: '#F5F5F5',
        headerBg: '#000000',
        headerFg: '#F5F5F5',
        composerBg: '#000000',
        inputBg: '#0C0C0C',
      },
      light: {
        wallpaper: '#F4F4F4',
        bubbleMine: '#111111',
        bubbleTheirs: '#FFFFFF',
      },
    },
    layout: {
      bubbleShape: 'rounded',
      bubbleRadius: 12,
      showTails: false,
      bubbleShadow: false,
      iconSet: 'material',
      tabBarPosition: 'bottom',
      tabBarLabels: 'icons',
      headerStyle: 'minimal',
      showHeaderBorder: false,
    },
  }),
  // The three below are the first packs that change the *typeface* as well as
  // the colours, and the first to use glass, AMOLED and a moving wallpaper.
  // Kept as packs rather than defaults so that everything added in this round
  // is something a person opts into, one tap, and can leave.
  pack({
    id: 'blindfold',
    name: 'Blindfold',
    author: 'Yo',
    description: 'Black, with an unreasonable amount of blue in it. Glass chrome, drifting aurora.',
    category: 'midnight',
    downloads: 0,
    likes: 0,
    price: 0,
    isOfficial: true,
    tokens: {
      dark: {
        primary: '#3AB6FF',
        tint: '#3AB6FF',
        tabIconSelected: '#3AB6FF',
        // `info` is the aurora's second hue — see the chat screen.
        info: '#8B5CF6',
        background: '#000000',
        surface: '#0B0D14',
        surfaceElevated: '#141824',
        surfaceMuted: '#05060A',
        text: '#EAF4FF',
        textSecondary: '#8FA3BD',
        textMuted: '#55637A',
        border: '#1B2130',
        divider: '#12161F',
        onPrimary: '#00121F',
      },
      light: {
        primary: '#1E6FD9',
        tint: '#1E6FD9',
        tabIconSelected: '#1E6FD9',
        info: '#6D3BE0',
        background: '#F4F8FF',
        surface: '#FFFFFF',
        surfaceElevated: '#FFFFFF',
        surfaceMuted: '#E7EFFB',
        text: '#0A1422',
        textSecondary: '#4A5A72',
        textMuted: '#8494AB',
        border: '#D3E0F2',
        divider: '#E7EFFB',
        onPrimary: '#FFFFFF',
      },
    },
    chat: {
      dark: {
        wallpaper: '#000000',
        bubbleMine: '#12365C',
        bubbleTheirs: '#0B0D14',
        textMine: '#EAF4FF',
        headerBg: '#05060A',
        composerBg: '#000000',
        inputBg: '#0B0D14',
      },
      light: {
        wallpaper: '#E7EFFB',
        bubbleMine: '#1E6FD9',
        bubbleTheirs: '#FFFFFF',
      },
    },
    layout: {
      fontFamily: 'space',
      amoledBlack: true,
      glassChrome: true,
      glassIntensity: 60,
      wallpaperAnimation: 'aurora',
      bubbleShape: 'rounded',
      bubbleRadius: 18,
      showTails: false,
      bubbleShadow: false,
      iconSet: 'sharp',
      headerStyle: 'minimal',
      showHeaderBorder: false,
      composerStyle: 'floating',
      letterSpacing: 0.2,
    },
  }),
  pack({
    id: 'paper-ink',
    name: 'Paper & Ink',
    author: 'Yo',
    description: 'A serif, a warm page and no shadows. Reads like something printed.',
    category: 'minimal',
    downloads: 0,
    likes: 0,
    price: 0,
    isOfficial: true,
    tokens: {
      light: {
        primary: '#8A6A3E',
        tint: '#8A6A3E',
        tabIconSelected: '#8A6A3E',
        background: '#FBF6EC',
        surface: '#FFFDF8',
        surfaceElevated: '#FFFDF8',
        surfaceMuted: '#F2EADA',
        text: '#231D14',
        textSecondary: '#6B5C46',
        textMuted: '#9C8E77',
        border: '#E4D8C2',
        divider: '#EFE6D5',
        onPrimary: '#FFFDF8',
      },
      dark: {
        primary: '#D8B679',
        tint: '#D8B679',
        tabIconSelected: '#D8B679',
        background: '#14110C',
        surface: '#1D1913',
        surfaceElevated: '#26211A',
        surfaceMuted: '#100E09',
        text: '#F2E9D8',
        textSecondary: '#B0A48C',
        textMuted: '#7A7060',
        border: '#2E2820',
        divider: '#221D17',
        onPrimary: '#1A1509',
      },
    },
    chat: {
      light: {
        wallpaper: '#F2EADA',
        bubbleMine: '#8A6A3E',
        bubbleTheirs: '#FFFDF8',
      },
      dark: {
        wallpaper: '#100E09',
        bubbleMine: '#4A3B22',
        bubbleTheirs: '#1D1913',
        textMine: '#F2E9D8',
      },
    },
    layout: {
      fontFamily: 'lora',
      bubbleShape: 'square',
      bubbleShadow: false,
      showTails: false,
      density: 'roomy',
      iconSet: 'outline',
      headerStyle: 'minimal',
      composerStyle: 'flat',
      lineHeightExtra: 3,
      datePillStyle: 'text',
      unreadBadgeStyle: 'dot',
    },
  }),
  pack({
    id: 'bubblegum',
    name: 'Bubblegum',
    author: 'Yo',
    description: 'Round everything. Nunito, pastel glass, and a wallpaper that breathes.',
    category: 'pastel',
    downloads: 0,
    likes: 0,
    price: 0,
    isOfficial: true,
    tokens: {
      light: {
        primary: '#C86BE0',
        tint: '#C86BE0',
        tabIconSelected: '#C86BE0',
        info: '#6BC5E0',
        background: '#FFF5FD',
        surface: '#FFFFFF',
        surfaceElevated: '#FFFFFF',
        surfaceMuted: '#FCE9FA',
        text: '#2C1B31',
        textSecondary: '#6E5273',
        textMuted: '#A78CAB',
        border: '#F3D7EF',
        divider: '#FAE6F7',
        onPrimary: '#FFFFFF',
      },
      dark: {
        primary: '#E79BF5',
        tint: '#E79BF5',
        tabIconSelected: '#E79BF5',
        info: '#8ED8EF',
        background: '#160F1A',
        surface: '#211628',
        surfaceElevated: '#2C1F34',
        surfaceMuted: '#110B14',
        text: '#F7E9FA',
        textSecondary: '#BFA3C7',
        textMuted: '#8A7191',
        border: '#33243B',
        divider: '#261A2D',
        onPrimary: '#2A0F33',
      },
    },
    chat: {
      light: {
        wallpaper: '#FCE9FA',
        bubbleMine: '#C86BE0',
        bubbleTheirs: '#FFFFFF',
      },
      dark: {
        wallpaper: '#110B14',
        bubbleMine: '#5C2E69',
        bubbleTheirs: '#211628',
        textMine: '#F7E9FA',
      },
    },
    layout: {
      fontFamily: 'nunito',
      glassChrome: true,
      glassIntensity: 35,
      wallpaperAnimation: 'pulse',
      bubbleShape: 'pill',
      bubbleRadius: 24,
      showTails: false,
      bubbleShadow: true,
      bubbleShadowStrength: 0.5,
      iconSet: 'filled',
      composerStyle: 'floating',
      inputRadius: 26,
      density: 'cozy',
    },
  }),
  // Three pastiches. Each is a whole interface somebody already has muscle
  // memory for, which is a harder brief than a palette: being wrong by a
  // corner radius is the difference between "that's it" and "that's nearly
  // it". The product each one evokes is named in the description rather than
  // the title, so search finds them without the app shipping somebody else's
  // trademark as the name of a feature.
  pack({
    id: 'cupertino',
    name: 'Cupertino',
    author: 'Yo',
    description:
      'iOS 26. Liquid glass chrome, iMessage blue, tall corners, and the system font it was drawn for.',
    category: 'minimal',
    downloads: 0,
    likes: 0,
    price: 0,
    isOfficial: true,
    tokens: {
      light: {
        primary: '#007AFF',
        onPrimary: '#FFFFFF',
        background: '#F2F2F7',
        surface: '#FFFFFF',
        surfaceElevated: '#FFFFFF',
        surfaceMuted: '#E5E5EA',
        text: '#000000',
        textSecondary: '#6C6C70',
        textMuted: '#8E8E93',
        border: '#C6C6C8',
        divider: '#E5E5EA',
        tint: '#007AFF',
        icon: '#8E8E93',
        tabIconDefault: '#8E8E93',
        tabIconSelected: '#007AFF',
        success: '#34C759',
        warning: '#FF9500',
        danger: '#FF3B30',
        info: '#5856D6',
      },
      dark: {
        primary: '#0A84FF',
        onPrimary: '#FFFFFF',
        background: '#000000',
        surface: '#1C1C1E',
        surfaceElevated: '#2C2C2E',
        surfaceMuted: '#000000',
        text: '#FFFFFF',
        textSecondary: '#98989F',
        textMuted: '#8E8E93',
        border: '#38383A',
        divider: '#2C2C2E',
        tint: '#0A84FF',
        icon: '#98989F',
        tabIconDefault: '#8E8E93',
        tabIconSelected: '#0A84FF',
        success: '#30D158',
        warning: '#FF9F0A',
        danger: '#FF453A',
        info: '#5E5CE6',
      },
    },
    chat: {
      light: {
        wallpaper: '#FFFFFF',
        bubbleMine: '#007AFF',
        bubbleTheirs: '#E9E9EB',
        textMine: '#FFFFFF',
        textTheirs: '#000000',
        metaTheirs: '#8E8E93',
        headerBg: '#F2F2F7',
        headerFg: '#000000',
        composerBg: '#F2F2F7',
        inputBg: '#FFFFFF',
        systemBg: '#FFFFFF',
        systemText: '#8E8E93',
      },
      dark: {
        wallpaper: '#000000',
        bubbleMine: '#0A84FF',
        bubbleTheirs: '#26262A',
        textMine: '#FFFFFF',
        textTheirs: '#FFFFFF',
        metaTheirs: '#8E8E93',
        headerBg: '#1C1C1E',
        headerFg: '#FFFFFF',
        composerBg: '#000000',
        inputBg: '#1C1C1E',
        systemBg: '#000000',
        systemText: '#8E8E93',
      },
    },
    layout: {
      // Not a bundled family, on purpose. On an iPhone the system font *is*
      // the one this is imitating, so naming a face would swap San Francisco
      // for a lookalike and lose dynamic type doing it.
      fontFamily: 'system',
      glassChrome: true,
      glassIntensity: 75,
      bubbleShape: 'tail',
      bubbleRadius: 18,
      showTails: true,
      bubbleShadow: false,
      squircleCorners: true,
      composerStyle: 'rounded',
      inputRadius: 20,
      sendButtonStyle: 'circle',
      tabBarPosition: 'bottom',
      tabBarLabels: 'both',
      headerStyle: 'minimal',
      showHeaderBorder: false,
      iconSet: 'outline',
      datePillStyle: 'text',
      centerDatePills: true,
      listAvatarSize: 50,
      density: 'cozy',
      metaSize: 11,
    },
  }),
  pack({
    id: 'aero',
    name: 'Aero',
    author: 'Yo',
    description:
      'Windows 7. Translucent blue chrome, a glow on every edge, and corners barely rounded at all.',
    category: 'retro',
    downloads: 0,
    likes: 0,
    price: 0,
    isOfficial: true,
    tokens: {
      light: {
        primary: '#1B72C4',
        onPrimary: '#FFFFFF',
        background: '#E8F1FB',
        surface: '#FFFFFF',
        surfaceElevated: '#FFFFFF',
        surfaceMuted: '#D3E4F6',
        text: '#10283F',
        textSecondary: '#3F5F80',
        textMuted: '#7593B2',
        border: '#9FC0E0',
        divider: '#D3E4F6',
        tint: '#1B72C4',
        icon: '#3F5F80',
        tabIconDefault: '#7593B2',
        tabIconSelected: '#1B72C4',
        success: '#4E9A06',
        warning: '#F0A30A',
        danger: '#C42B1C',
        info: '#00A2E8',
      },
      dark: {
        primary: '#4FB3F0',
        onPrimary: '#04141F',
        background: '#0A1622',
        surface: '#12283C',
        surfaceElevated: '#1B3A54',
        surfaceMuted: '#071019',
        text: '#E4F1FB',
        textSecondary: '#9FC0DC',
        textMuted: '#6B8CA8',
        border: '#224764',
        divider: '#16324A',
        tint: '#4FB3F0',
        icon: '#9FC0DC',
        tabIconDefault: '#6B8CA8',
        tabIconSelected: '#4FB3F0',
        success: '#73C936',
        warning: '#FFC83D',
        danger: '#FF6B5E',
        info: '#33C7FF',
      },
    },
    chat: {
      light: {
        wallpaper: '#D3E4F6',
        bubbleMine: '#1B72C4',
        bubbleTheirs: '#FFFFFF',
        textMine: '#FFFFFF',
        textTheirs: '#10283F',
        headerBg: '#1B72C4',
        headerFg: '#FFFFFF',
        composerBg: '#E8F1FB',
        inputBg: '#FFFFFF',
        datePillBg: '#FFFFFF',
        datePillText: '#3F5F80',
      },
      dark: {
        wallpaper: '#071019',
        bubbleMine: '#1B4E77',
        bubbleTheirs: '#12283C',
        textMine: '#E4F1FB',
        textTheirs: '#E4F1FB',
        headerBg: '#12283C',
        headerFg: '#E4F1FB',
        composerBg: '#0A1622',
        inputBg: '#12283C',
      },
    },
    layout: {
      fontFamily: 'inter',
      // Aero *was* the glass. Switch it off and what is left is a blue theme
      // with nothing of the thing it is imitating.
      glassChrome: true,
      glassIntensity: 50,
      // The light that used to sweep across the window chrome.
      wallpaperAnimation: 'drift',
      bubbleShape: 'rounded',
      bubbleRadius: 6,
      showTails: false,
      bubbleShadow: true,
      bubbleShadowStrength: 0.6,
      squircleCorners: false,
      composerStyle: 'flat',
      inputRadius: 4,
      sendButtonStyle: 'pill',
      headerStyle: 'colored',
      showHeaderBorder: true,
      tabBarPosition: 'top',
      tabBarLabels: 'both',
      iconSet: 'filled',
      density: 'compact',
      listAvatarSize: 40,
      linkUnderline: true,
    },
  }),
  pack({
    id: 'butterfly',
    name: 'Butterfly',
    author: 'Yo',
    description:
      'MSN Messenger, 2005. Green for online, a blue title bar, square corners, and a banner for every nudge.',
    category: 'retro',
    downloads: 0,
    likes: 0,
    price: 0,
    isOfficial: true,
    tokens: {
      light: {
        // Deeper than the green everybody remembers: that one is a logo
        // colour, and it fails contrast the moment white text sits on it.
        primary: '#4C8C00',
        onPrimary: '#FFFFFF',
        background: '#EDF4FB',
        surface: '#FFFFFF',
        surfaceElevated: '#FFFFFF',
        surfaceMuted: '#DCE8F5',
        text: '#14212E',
        textSecondary: '#465A6E',
        textMuted: '#7C8FA3',
        border: '#A8C3DE',
        divider: '#DCE8F5',
        tint: '#4C8C00',
        icon: '#465A6E',
        tabIconDefault: '#7C8FA3',
        tabIconSelected: '#4C8C00',
        success: '#4C8C00',
        warning: '#F08A00',
        danger: '#CC3300',
        info: '#0067B8',
      },
      dark: {
        primary: '#8FD400',
        onPrimary: '#132000',
        background: '#0E1520',
        surface: '#18222F',
        surfaceElevated: '#22303F',
        surfaceMuted: '#0A1018',
        text: '#E8F0F8',
        textSecondary: '#A3B6C8',
        textMuted: '#6F8398',
        border: '#2A3A4C',
        divider: '#1D2836',
        tint: '#8FD400',
        icon: '#A3B6C8',
        tabIconDefault: '#6F8398',
        tabIconSelected: '#8FD400',
        success: '#8FD400',
        warning: '#FFA940',
        danger: '#FF6B4A',
        info: '#4CADFF',
      },
    },
    chat: {
      light: {
        // The log was white, and the two of you were told apart by the colour
        // of your name rather than by a shape drawn around the words.
        wallpaper: '#FFFFFF',
        bubbleMine: '#E4F0CF',
        bubbleTheirs: '#FFFFFF',
        textMine: '#14212E',
        textTheirs: '#14212E',
        metaMine: '#6F8A45',
        metaTheirs: '#7C8FA3',
        headerBg: '#0067B8',
        headerFg: '#FFFFFF',
        composerBg: '#EDF4FB',
        inputBg: '#FFFFFF',
        systemBg: '#FFF6E0',
        systemText: '#8A6D00',
        unreadBadge: '#F08A00',
      },
      dark: {
        wallpaper: '#0A1018',
        bubbleMine: '#2A3D14',
        bubbleTheirs: '#18222F',
        textMine: '#E8F0F8',
        textTheirs: '#E8F0F8',
        headerBg: '#18222F',
        headerFg: '#E8F0F8',
        composerBg: '#0E1520',
        inputBg: '#18222F',
        systemBg: '#2A2413',
        systemText: '#FFC83D',
        unreadBadge: '#FFA940',
      },
    },
    layout: {
      fontFamily: 'inter',
      glassChrome: false,
      bubbleShape: 'square',
      bubbleRadius: 4,
      showTails: false,
      bubbleShadow: false,
      squircleCorners: false,
      // A log, not a thread: rows run nearly the full width and sit close
      // together, and the sender's name does the work the bubble does now.
      density: 'compact',
      bubbleMaxWidth: 92,
      groupSenderBold: true,
      timestampInside: false,
      datePillStyle: 'text',
      systemMsgStyle: 'banner',
      composerStyle: 'flat',
      inputRadius: 4,
      sendButtonStyle: 'pill',
      headerStyle: 'colored',
      showHeaderBorder: true,
      tabBarPosition: 'top',
      tabBarLabels: 'both',
      iconSet: 'filled',
      avatarPosition: 'left',
      listAvatarSize: 40,
      linkUnderline: true,
      metaSize: 10,
    },
  }),
];

// ── State ───────────────────────────────────────────────────────────────────

let catalog: ThemePack[] = MARKETPLACE;
let installed = new Set<string>([DEFAULT_PACK_ID]);
let liked = new Set<string>();
let activeThemeId = DEFAULT_PACK_ID;
let schemePref: SchemePreference = 'system';
/** Always-on personal tweaks (GB “customize current theme”). */
let personalLayout: Partial<ThemeLayout> = {};
let personalChat: { light?: Partial<ChatChrome>; dark?: Partial<ChatChrome> } = {};
/** Icon images the person set outside any pack. */
let personalIcons: ThemeIcons = {};
/** The launcher icon. Not part of any pack — see [theme-app-icons]. */
let appIcon: AppIconId = 'default';
/** Bumps on every store mutation so hooks re-render even when object identity is stable. */
let storeRev = 0;
/**
 * The typeface in force, cached rather than derived on read.
 *
 * Every `<Text>` in the app subscribes to this one value, so its getter runs
 * on the order of a thousand times per screen. `getResolvedLayout()` builds a
 * ~55-key object each call; doing that per text node per render is how a font
 * picker turns into a frame-rate bug. It only changes when the store does, so
 * it is recomputed there — once — in [emit].
 */
let resolvedFontFamily: FontFamilyId = DEFAULT_LAYOUT.fontFamily;
const listeners = new Set<() => void>();

/**
 * Whether the stored state has been read back yet.
 *
 * Until it has, this module holds defaults that nobody chose — and writing
 * those over the real ones is how a person loses their theme by opening the
 * app and tapping nothing. Persistence stays off until there is something
 * worth persisting.
 */
let hydrated = false;
let booting: Promise<void> | null = null;

function persistPrefs() {
  if (!hydrated) return;
  writeThemePrefs(
    serializeThemePrefs({
      activeThemeId,
      installed: [...installed],
      liked: [...liked],
      schemePreference: schemePref,
      personalLayout,
      personalChat,
      personalIcons,
      appIcon,
    }),
  ).catch(() => {});
}

/** An owned pack, written whole. Bundled packs ship with the app and are not stored. */
function persistPack(theme: ThemePack) {
  if (!hydrated || !theme.isOwned) return;
  saveStoredPack(theme.id, JSON.stringify(theme)).catch(() => {});
}

/**
 * Every mutation goes through here, so persistence cannot be forgotten by
 * whoever adds the next action — which is exactly how the previous version
 * ended up storing nothing at all.
 */
function emit() {
  storeRev += 1;
  resolvedFontFamily = getResolvedLayout().fontFamily;
  // A face has to be registered before a style may name it, and nothing
  // re-renders on its own when one finishes loading. So: register on the way
  // past, and emit again when it lands. The frame in between draws in the
  // system font, which is the honest fallback and not a hole.
  if (needsFontLoad(resolvedFontFamily)) {
    const pending = resolvedFontFamily;
    loadFontFamily(pending).then((ok) => {
      if (ok) emit();
    });
  }
  persistPrefs();
  listeners.forEach((l) => l());
}

/**
 * Read the stored theme back. Idempotent, and safe to call before login.
 *
 * A failure here is cosmetic — the app opens on the default theme rather than
 * the chosen one — so it is warned about and swallowed. It must never be the
 * reason a messenger will not start.
 */
export async function bootstrapThemes(): Promise<void> {
  if (booting) return booting;
  booting = (async () => {
    try {
      const [prefs, packs] = await Promise.all([readThemePrefs(), listStoredPacks()]);
      const state = hydrateThemeState(
        { prefs, packs },
        {
          layout: DEFAULT_LAYOUT,
          chrome: {
            light: defaultChatChrome('light', Colors.light.primary),
            dark: defaultChatChrome('dark', Colors.dark.primary),
          },
          icons: EMPTY_ICONS,
          bundledIds: MARKETPLACE.map((m) => m.id),
        },
      );
      // Owned packs first: the person's own work is what they scroll for.
      catalog = [...state.ownedPacks, ...MARKETPLACE];
      installed = new Set(state.installed);
      liked = new Set(state.liked);
      activeThemeId = state.activeThemeId;
      schemePref = state.schemePreference;
      personalLayout = state.personalLayout;
      personalChat = state.personalChat;
      personalIcons = state.personalIcons;
      // The OS is the authority on which icon is actually installed: a
      // rebuild, or a restore onto a new device, can leave the stored value
      // describing an icon that is not on the home screen. Ask, and only fall
      // back to what was stored when there is nothing to ask.
      appIcon = state.appIcon;
      if (supportsAlternateIcons) {
        try {
          appIcon = appIconFromPluginName(getAppIconName());
        } catch {
          // Keep the stored value.
        }
      }
      hydrated = true;
      // Before the first emit, not after. This is the one moment the splash
      // is still up, so a stored typeface can be registered without anybody
      // watching the app repaint in a font they did not choose.
      await loadFontFamily(getResolvedLayout().fontFamily);
      emit();
      // Now — and only now — is the full set of live image references known,
      // so anything left over from a deleted theme can go. Sweeping earlier
      // would delete the wallpaper of a pack that had not been read yet.
      pruneThemeImages(referencedImages()).catch(() => {});
    } catch (err) {
      console.warn('themes: could not restore stored theme', err);
    }
  })();
  return booting;
}

/** Every image any theme currently points at: wallpapers and custom icons. */
function referencedImages(): string[] {
  const uris: string[] = [];
  const schemes: ThemeMode[] = ['light', 'dark'];
  for (const theme of catalog) {
    for (const scheme of schemes) {
      const wallpaper = theme.chat?.[scheme]?.wallpaperImage;
      if (wallpaper) uris.push(wallpaper);
    }
    for (const uri of Object.values(theme.icons ?? {})) if (uri) uris.push(uri);
  }
  for (const scheme of schemes) {
    const wallpaper = personalChat[scheme]?.wallpaperImage;
    if (wallpaper) uris.push(wallpaper);
  }
  for (const uri of Object.values(personalIcons)) if (uri) uris.push(uri);
  return uris;
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

// ── Selectors ───────────────────────────────────────────────────────────────

export function useThemeCatalog(): ThemePack[] {
  return useSyncExternalStore(subscribe, () => catalog);
}

export function useInstalledThemeIds(): Set<string> {
  return useSyncExternalStore(subscribe, () => installed);
}

export function useActiveThemeId(): string {
  return useSyncExternalStore(subscribe, () => activeThemeId);
}

export function useLikedThemeIds(): Set<string> {
  return useSyncExternalStore(subscribe, () => liked);
}

export function useSchemePreference(): SchemePreference {
  return useSyncExternalStore(subscribe, () => schemePref);
}

export function usePersonalLayout(): Partial<ThemeLayout> {
  return useSyncExternalStore(subscribe, () => personalLayout);
}

/** Subscribe to any theme-store change (packs, chrome, personal overrides). */
export function useThemeStoreRev(): number {
  return useSyncExternalStore(subscribe, () => storeRev);
}

/**
 * The typeface every `<Text>` draws with.
 *
 * Its own selector rather than a read off [useTheme] so a text node
 * subscribes to the one value it cares about, and is not re-rendered by
 * somebody changing a bubble colour.
 */
export function useThemeFontFamily(): FontFamilyId {
  return useSyncExternalStore(subscribe, () => resolvedFontFamily);
}

export function getActivePack(): ThemePack | undefined {
  return catalog.find((p) => p.id === activeThemeId);
}

export function getPackById(id: string): ThemePack | undefined {
  return catalog.find((p) => p.id === id);
}

function packColors(scheme: ThemeMode): ThemeTokens {
  const base = scheme === 'dark' ? baseDark : baseLight;
  const packActive = getActivePack();
  if (!packActive) return { ...base };
  const override = packActive.tokens[scheme] ?? {};
  const cssTokens = packActive.customCss ? parseThemeCss(packActive.customCss).tokens : {};
  const merged = { ...base, ...override, ...cssTokens };
  if ((override.primary || cssTokens.primary) && !merged.tint) {
    merged.tint = merged.primary;
  }
  if ((override.primary || cssTokens.primary) && !override.tabIconSelected && !cssTokens.tabIconSelected) {
    merged.tabIconSelected = merged.primary;
  }
  return merged;
}

function packChrome(scheme: ThemeMode): ChatChrome {
  const colors = getResolvedColors(scheme);
  const base = defaultChatChrome(scheme, colors.primary);
  // Prefer token surfaces when pack doesn't set chrome.
  const fromTokens: Partial<ChatChrome> = {
    wallpaper: colors.surfaceMuted,
    bubbleMine: colors.primary,
    bubbleTheirs: colors.surface,
    textMine: colors.onPrimary,
    textTheirs: colors.text,
    metaMine: scheme === 'dark' ? 'rgba(255,255,255,0.72)' : 'rgba(255,255,255,0.78)',
    metaTheirs: colors.textMuted,
    datePillBg: colors.surface,
    datePillText: colors.textSecondary,
    composerBg: colors.surfaceMuted,
    inputBg: colors.surface,
    linkMine: colors.onPrimary,
    linkTheirs: colors.primary,
    headerBg: scheme === 'dark' ? colors.surface : colors.primary,
    headerFg: scheme === 'dark' ? colors.text : colors.onPrimary,
    sendBtnBg: colors.primary,
    replyBarBg: colors.surfaceMuted,
    replyBarAccent: colors.primary,
    selectionBg: `${colors.primary}18`,
    typingDot: colors.textMuted,
    systemBg: colors.surface,
    systemText: colors.textSecondary,
    unreadBadge: colors.primary,
  };
  const packActive = getActivePack();
  const packChat = packActive?.chat?.[scheme] ?? {};
  const personal = personalChat[scheme] ?? {};
  // CSS overrides win over pack (but personal still on top).
  const cssLayer: ParsedThemeCss = packActive?.customCss
    ? parseThemeCss(packActive.customCss)
    : { tokens: {}, chat: {}, layout: {} };
  return {
    ...base,
    ...fromTokens,
    ...packChat,
    ...cssLayer.chat,
    ...personal,
  };
}

/**
 * The palette in force.
 *
 * AMOLED runs last and only in dark, because it is a switch over whatever
 * theme is active rather than a theme of its own — see [amoledizeTokens].
 */
export function getResolvedColors(scheme: ThemeMode): ThemeTokens {
  const colors = packColors(scheme);
  if (scheme !== 'dark' || !getResolvedLayout().amoledBlack) return colors;
  return amoledizeTokens(colors);
}

/** The chat chrome in force, with the same AMOLED pass over the top. */
export function getResolvedChat(scheme: ThemeMode): ChatChrome {
  const chrome = packChrome(scheme);
  if (scheme !== 'dark' || !getResolvedLayout().amoledBlack) return chrome;
  return amoledizeChat(chrome);
}

/**
 * The icon images in force: the active pack's, with the person's own on top.
 *
 * Same layering as colour, and for the same reason — someone who replaced the
 * send icon expects it to stay replaced when they try on a new theme.
 */
export function getResolvedIcons(): ThemeIcons {
  const packIcons = getActivePack()?.icons ?? {};
  return { ...packIcons, ...personalIcons };
}

export function getResolvedLayout(): ThemeLayout {
  const packActive = getActivePack();
  const cssLayer: ParsedThemeCss = packActive?.customCss
    ? parseThemeCss(packActive.customCss)
    : { tokens: {}, chat: {}, layout: {} };
  return {
    ...DEFAULT_LAYOUT,
    ...packActive?.layout,
    ...cssLayer.layout,
    ...personalLayout,
  };
}

// ── Actions ─────────────────────────────────────────────────────────────────

export function setSchemePreference(pref: SchemePreference) {
  schemePref = pref;
  emit();
}

export function setPersonalLayout(patch: Partial<ThemeLayout>) {
  personalLayout = { ...personalLayout, ...patch };
  emit();
}

export function setPersonalChat(scheme: ThemeMode, patch: Partial<ChatChrome>) {
  personalChat = {
    ...personalChat,
    [scheme]: { ...personalChat[scheme], ...patch },
  };
  emit();
}

/** The launcher icon in force. */
export function useAppIcon(): AppIconId {
  return useSyncExternalStore(subscribe, () => appIcon);
}

/** Whether this build can change it at all — false in Expo Go and on web. */
export function canChangeAppIcon(): boolean {
  return supportsAlternateIcons;
}

/**
 * Ask the OS to swap the launcher icon.
 *
 * Recorded only once the swap has actually happened. iOS puts a system
 * dialog in front of this that the person can decline, and there is no
 * alternate-icon support at all without a native build — in both cases the
 * icon on the home screen is unchanged, so storing the new choice would
 * leave the app claiming an icon nobody has.
 */
export async function setAppIcon(id: AppIconId): Promise<boolean> {
  if (!supportsAlternateIcons) return false;
  if (id === appIcon) return true;
  try {
    await setAlternateAppIcon(appIconSpec(id).pluginName);
  } catch (err) {
    console.warn('themes: could not change the app icon', err);
    return false;
  }
  appIcon = id;
  emit();
  return true;
}

export function setPersonalIcons(patch: ThemeIcons) {
  personalIcons = { ...personalIcons, ...patch };
  emit();
}

export function clearPersonalOverrides() {
  personalLayout = {};
  personalChat = {};
  personalIcons = {};
  emit();
}

export function installTheme(id: string) {
  installed = new Set(installed).add(id);
  emit();
}

export function uninstallTheme(id: string) {
  if (id === DEFAULT_PACK_ID) return;
  const next = new Set(installed);
  next.delete(id);
  installed = next;
  if (activeThemeId === id) activeThemeId = DEFAULT_PACK_ID;
  emit();
}

export function applyTheme(id: string) {
  if (!installed.has(id) && !catalog.find((p) => p.id === id)?.isOwned) {
    installTheme(id);
  }
  installed = new Set(installed).add(id);
  activeThemeId = id;
  emit();
}

export function toggleLikeTheme(id: string) {
  const next = new Set(liked);
  const p = catalog.find((c) => c.id === id);
  if (next.has(id)) {
    next.delete(id);
    if (p) p.likes = Math.max(0, p.likes - 1);
  } else {
    next.add(id);
    if (p) p.likes += 1;
  }
  liked = next;
  catalog = [...catalog];
  emit();
}

function deriveTokens(
  mode: ThemeMode,
  primary: string,
  background: string,
  surface: string,
  text: string,
  secondary?: string,
): Partial<ThemeTokens> {
  const isDark = mode === 'dark';
  return {
    primary,
    tint: primary,
    tabIconSelected: primary,
    onPrimary: isDark ? background : '#FFFFFF',
    background,
    surface,
    surfaceElevated: surface,
    surfaceMuted:
      secondary ??
      (isDark ? blend(background, '#FFFFFF', 0.06) : blend(background, '#000000', 0.04)),
    text,
    textSecondary: isDark ? blend(text, background, 0.35) : blend(text, background, 0.4),
    textMuted: isDark ? blend(text, background, 0.55) : blend(text, background, 0.55),
    border: isDark ? blend(background, '#FFFFFF', 0.12) : blend(background, '#000000', 0.1),
    divider: isDark ? blend(background, '#FFFFFF', 0.08) : blend(background, '#000000', 0.06),
    icon: isDark ? blend(text, background, 0.35) : blend(text, background, 0.4),
    tabIconDefault: isDark ? blend(text, background, 0.5) : blend(text, background, 0.5),
  };
}

function blend(a: string, b: string, t: number): string {
  const pa = hexToRgb(a);
  const pb = hexToRgb(b);
  if (!pa || !pb) return a;
  const r = Math.round(pa.r + (pb.r - pa.r) * t);
  const g = Math.round(pa.g + (pb.g - pa.g) * t);
  const bl = Math.round(pa.b + (pb.b - pa.b) * t);
  return `#${[r, g, bl].map((n) => n.toString(16).padStart(2, '0')).join('')}`;
}

function hexToRgb(hex: string) {
  const h = hex.replace('#', '');
  if (h.length !== 6) return null;
  return {
    r: parseInt(h.slice(0, 2), 16),
    g: parseInt(h.slice(2, 4), 16),
    b: parseInt(h.slice(4, 6), 16),
  };
}

function buildTokens(input: CreateThemeInput) {
  const light =
    input.mode === 'dark'
      ? deriveTokens('light', input.primary, '#F7F9FC', '#FFFFFF', '#111827')
      : deriveTokens(
          'light',
          input.primary,
          input.background,
          input.surface,
          input.text,
          input.secondary,
        );
  const dark =
    input.mode === 'light'
      ? deriveTokens(
          'dark',
          input.primary,
          blend(input.background, '#000000', 0.85),
          blend(input.surface, '#000000', 0.75),
          blend(input.text, '#FFFFFF', 0.9),
        )
      : deriveTokens(
          'dark',
          input.primary,
          input.mode === 'both' ? blend(input.background, '#000000', 0.85) : input.background,
          input.mode === 'both' ? blend(input.surface, '#000000', 0.75) : input.surface,
          input.mode === 'both' ? blend(input.text, '#FFFFFF', 0.9) : input.text,
          input.secondary,
        );

  if (input.mode === 'dark') {
    return {
      dark: deriveTokens(
        'dark',
        input.primary,
        input.background,
        input.surface,
        input.text,
        input.secondary,
      ),
      light,
    };
  }
  return { light, dark };
}

function buildChatFromInput(
  input: CreateThemeInput,
  tokens: { light?: Partial<ThemeTokens>; dark?: Partial<ThemeTokens> },
): ThemePack['chat'] {
  const chat = input.chat ?? {};
  const lightPrimary = tokens.light?.primary ?? input.primary;
  const darkPrimary = tokens.dark?.primary ?? input.primary;
  return {
    light: {
      ...defaultChatChrome('light', lightPrimary),
      bubbleMine: chat.bubbleMine ?? lightPrimary,
      bubbleTheirs: chat.bubbleTheirs,
      wallpaper: chat.wallpaper,
      textMine: chat.textMine,
      textTheirs: chat.textTheirs,
      ...chat,
    },
    dark: {
      ...defaultChatChrome('dark', darkPrimary),
      bubbleMine: chat.bubbleMine ?? darkPrimary,
      bubbleTheirs: chat.bubbleTheirs,
      wallpaper: chat.wallpaper,
      textMine: chat.textMine,
      textTheirs: chat.textTheirs,
      ...chat,
    },
  };
}

/** Create a new owned pack, or update an existing owned one. */
export function createThemePack(input: CreateThemeInput): ThemePack {
  const tokens = buildTokens(input);
  const chat = buildChatFromInput(input, tokens);
  const layout: ThemeLayout = { ...DEFAULT_LAYOUT, ...input.layout };

  // CSS layer merges into layout/chat if provided.
  const cssParsed: ParsedThemeCss = input.customCss
    ? parseThemeCss(input.customCss)
    : { tokens: {}, chat: {}, layout: {} };
  const finalLayout: ThemeLayout = {
    ...layout,
    ...cssParsed.layout,
  };
  const finalChat: ThemePack['chat'] = {
    light: { ...chat?.light, ...cssParsed.chat },
    dark: { ...chat?.dark, ...cssParsed.chat },
  };

  if (input.editId) {
    const existing = catalog.find((c) => c.id === input.editId);
    if (existing?.isOwned) {
      existing.name = input.name.trim().slice(0, 40) || existing.name;
      existing.description = input.description?.trim() || existing.description;
      existing.category = input.category;
      existing.tokens = {
        light: { ...tokens.light, ...cssParsed.tokens },
        dark: { ...tokens.dark, ...cssParsed.tokens },
      };
      existing.chat = finalChat;
      existing.layout = finalLayout;
      existing.customCss = input.customCss;
      existing.aiPrompt = input.aiPrompt;
      existing.swatches = [
        input.primary,
        input.background,
        input.surface,
        input.text,
      ];
      existing.icons = input.icons ?? existing.icons;
      catalog = [...catalog];
      activeThemeId = existing.id;
      installed = new Set(installed).add(existing.id);
      persistPack(existing);
      emit();
      return existing;
    }
  }

  const id = `theme_${Date.now().toString(36)}`;
  const theme = pack({
    id,
    name: input.name.trim().slice(0, 40) || 'My theme',
    author: 'You',
    description: input.description?.trim() || 'Custom theme from the creator.',
    category: input.category,
    downloads: input.forkFromId ? 0 : 1,
    likes: 0,
    price: 0,
    isOwned: true,
    forkedFrom: input.forkFromId,
    tokens: {
      light: { ...tokens.light, ...cssParsed.tokens },
      dark: { ...tokens.dark, ...cssParsed.tokens },
    },
    chat: finalChat,
    layout: finalLayout,
    customCss: input.customCss,
    aiPrompt: input.aiPrompt,
    swatches: [input.primary, input.background, input.surface, input.text],
  });

  catalog = [theme, ...catalog];
  installed = new Set(installed).add(id);
  activeThemeId = id;
  persistPack(theme);
  emit();
  return theme;
}

/** Duplicate any pack into an owned editable copy. */
export function forkTheme(id: string, nameSuffix = ' (edit)'): ThemePack | null {
  const source = catalog.find((c) => c.id === id);
  if (!source) return null;
  const newId = `theme_${Date.now().toString(36)}`;
  const forked = pack({
    id: newId,
    name: `${source.name}${nameSuffix}`.slice(0, 40),
    author: 'You',
    description: source.description,
    category: source.category,
    downloads: 0,
    likes: 0,
    price: 0,
    isOwned: true,
    forkedFrom: source.id,
    tokens: {
      light: source.tokens.light ? { ...source.tokens.light } : undefined,
      dark: source.tokens.dark ? { ...source.tokens.dark } : undefined,
    },
    chat: source.chat
      ? {
          light: source.chat.light ? { ...source.chat.light } : undefined,
          dark: source.chat.dark ? { ...source.chat.dark } : undefined,
        }
      : undefined,
    layout: { ...DEFAULT_LAYOUT, ...source.layout },
    swatches: [...source.swatches],
  });
  catalog = [forked, ...catalog];
  installed = new Set(installed).add(newId);
  activeThemeId = newId;
  persistPack(forked);
  emit();
  return forked;
}

/** Patch layout/chat on an owned pack in place (live editor). */
export function updateOwnedTheme(
  id: string,
  patch: {
    name?: string;
    description?: string;
    category?: ThemePack['category'];
    tokens?: ThemePack['tokens'];
    chat?: ThemePack['chat'];
    layout?: Partial<ThemeLayout>;
    icons?: ThemeIcons;
    swatches?: string[];
  },
) {
  const p = catalog.find((c) => c.id === id);
  if (!p?.isOwned) return;
  if (patch.name) p.name = patch.name.slice(0, 40);
  if (patch.description !== undefined) p.description = patch.description;
  if (patch.category) p.category = patch.category;
  if (patch.tokens) p.tokens = patch.tokens;
  if (patch.chat) p.chat = patch.chat;
  if (patch.layout) p.layout = { ...DEFAULT_LAYOUT, ...p.layout, ...patch.layout };
  if (patch.swatches) p.swatches = patch.swatches;
  if (patch.icons) p.icons = { ...p.icons, ...patch.icons };
  catalog = [...catalog];
  persistPack(p);
  emit();
}

export function publishThemeToMarketplace(id: string) {
  const p = catalog.find((c) => c.id === id);
  if (!p || !p.isOwned) return;
  p.downloads = Math.max(p.downloads, 1);
  catalog = [...catalog];
  persistPack(p);
  emit();
}

export function deleteOwnedTheme(id: string) {
  const p = catalog.find((c) => c.id === id);
  if (!p?.isOwned) return;
  catalog = catalog.filter((c) => c.id !== id);
  const next = new Set(installed);
  next.delete(id);
  installed = next;
  if (activeThemeId === id) activeThemeId = DEFAULT_PACK_ID;
  deleteStoredPack(id).catch(() => {});
  emit();
}

export const CSS_THEME_TEMPLATE = `/* Socialize theme CSS — custom properties */
:root {
  --primary: #4F46E5;
  --background: #0E0F13;
  --surface: #191A21;
  --text: #ECEDF2;
  --wallpaper: #131419;
  --bubble-mine: #4F46E5;
  --bubble-theirs: #191A21;
  --text-mine: #FFFFFF;
  --text-theirs: #ECEDF2;
  --my-side: right;          /* left | right */
  --bubble-shape: tail;      /* tail | rounded | pill | square */
  --bubble-radius: 16;
  --font-scale: 1;
  --density: cozy;           /* compact | cozy | roomy */
  --bubble-max-width: 82;
  --wallpaper-dim: 35;
  --bubble-padding-h: 11;
  --bubble-padding-v: 7;
  --emoji-scale: 1;
  --letter-spacing: 0;
  --show-tails: true;
  --bubble-shadow: true;
  --wallpaper-pattern: false;
  --send-button: circle;     /* circle | pill | icon */
  --composer: rounded;       /* rounded | flat | floating */
}
`;

export type ParsedThemeCss = {
  tokens: Partial<ThemeTokens>;
  chat: Partial<ChatChrome>;
  layout: Partial<ThemeLayout>;
};

/** Parse a CSS custom-properties block into theme layers. */
export function parseThemeCss(css: string): ParsedThemeCss {
  const tokens: Partial<ThemeTokens> = {};
  const chat: Partial<ChatChrome> = {};
  const layout: Partial<ThemeLayout> = {};
  const re = /--([a-z0-9-]+)\s*:\s*([^;]+);/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(css)) !== null) {
    const key = m[1].toLowerCase();
    const raw = m[2].trim().replace(/^['"]|['"]$/g, '');
    const num = Number(raw);
    const bool = raw === 'true' ? true : raw === 'false' ? false : undefined;

    switch (key) {
      case 'primary':
        tokens.primary = raw;
        tokens.tint = raw;
        tokens.tabIconSelected = raw;
        break;
      case 'background':
        tokens.background = raw;
        break;
      case 'surface':
        tokens.surface = raw;
        break;
      case 'surface-muted':
        tokens.surfaceMuted = raw;
        break;
      case 'text':
        tokens.text = raw;
        break;
      case 'text-secondary':
        tokens.textSecondary = raw;
        break;
      case 'on-primary':
        tokens.onPrimary = raw;
        break;
      case 'border':
        tokens.border = raw;
        break;
      case 'wallpaper':
        chat.wallpaper = raw;
        break;
      case 'wallpaper-image':
        chat.wallpaperImage = raw;
        break;
      case 'bubble-mine':
        chat.bubbleMine = raw;
        break;
      case 'bubble-theirs':
        chat.bubbleTheirs = raw;
        break;
      case 'text-mine':
        chat.textMine = raw;
        break;
      case 'text-theirs':
        chat.textTheirs = raw;
        break;
      case 'composer-bg':
        chat.composerBg = raw;
        break;
      case 'input-bg':
        chat.inputBg = raw;
        break;
      case 'send-btn':
        chat.sendBtnBg = raw;
        break;
      case 'my-side':
        if (raw === 'left' || raw === 'right') layout.myBubbleSide = raw;
        break;
      case 'bubble-shape':
        if (['tail', 'rounded', 'pill', 'square'].includes(raw)) {
          layout.bubbleShape = raw as BubbleShape;
        }
        break;
      case 'bubble-radius':
        if (!Number.isNaN(num)) layout.bubbleRadius = clamp(num, 4, 28);
        break;
      case 'font-scale':
        if (!Number.isNaN(num)) layout.fontScale = clamp(num, 0.85, 1.35);
        break;
      case 'density':
        if (['compact', 'cozy', 'roomy'].includes(raw)) {
          layout.density = raw as MessageDensity;
        }
        break;
      case 'bubble-max-width':
        if (!Number.isNaN(num)) layout.bubbleMaxWidth = clamp(num, 60, 94);
        break;
      case 'wallpaper-dim':
        if (!Number.isNaN(num)) layout.wallpaperDim = clamp(num, 0, 80);
        break;
      case 'bubble-padding-h':
        if (!Number.isNaN(num)) layout.bubblePaddingH = clamp(num, 6, 22);
        break;
      case 'bubble-padding-v':
        if (!Number.isNaN(num)) layout.bubblePaddingV = clamp(num, 4, 18);
        break;
      case 'emoji-scale':
        if (!Number.isNaN(num)) layout.emojiScale = clamp(num, 0.8, 1.6);
        break;
      case 'letter-spacing':
        if (!Number.isNaN(num)) layout.letterSpacing = clamp(num, -0.5, 1.5);
        break;
      case 'show-tails':
        if (bool !== undefined) layout.showTails = bool;
        break;
      case 'bubble-shadow':
        if (bool !== undefined) layout.bubbleShadow = bool;
        break;
      case 'wallpaper-pattern':
        if (bool !== undefined) layout.wallpaperPattern = bool;
        break;
      case 'full-width':
        if (bool !== undefined) layout.fullWidthBubbles = bool;
        break;
      case 'send-button':
        if (['circle', 'pill', 'icon'].includes(raw)) {
          layout.sendButtonStyle = raw as SendButtonStyle;
        }
        break;
      case 'composer':
        if (['rounded', 'flat', 'floating'].includes(raw)) {
          layout.composerStyle = raw as ComposerStyle;
        }
        break;
      case 'header-style':
        if (['brand', 'minimal', 'colored'].includes(raw)) {
          layout.headerStyle = raw as HeaderStyle;
        }
        break;
      default:
        break;
    }
  }
  return { tokens, chat, layout };
}

function clamp(n: number, min: number, max: number) {
  return Math.min(max, Math.max(min, n));
}

export type AiThemeDraft = {
  name: string;
  description: string;
  category: ThemePack['category'];
  primary: string;
  background: string;
  surface: string;
  text: string;
  mode: ThemeMode | 'both';
  chat: Partial<ChatChrome>;
  layout: Partial<ThemeLayout>;
  customCss: string;
};

/**
 * Client-side "AI" theme generator — maps natural language to a full draft.
 * (Offline heuristic until a real model is wired on the backend.)
 */
export function generateThemeFromAiPrompt(prompt: string): AiThemeDraft {
  const p = prompt.toLowerCase();
  const dark =
    /\b(dark|noite|night|black|preto|midnight|cyber|néon|neon)\b/.test(p) &&
    !/\b(light|claro|day|dia)\b/.test(p);
  const light = /\b(light|claro|pastel|cream|soft|dia)\b/.test(p);

  let primary = '#4F46E5';
  let background = dark ? '#0E0F13' : '#F7F9FC';
  let surface = dark ? '#191A21' : '#FFFFFF';
  let text = dark ? '#ECEDF2' : '#111827';
  let category: ThemePack['category'] = 'minimal';
  let name = 'AI Theme';
  const layout: Partial<ThemeLayout> = { ...DEFAULT_LAYOUT };
  const chat: Partial<ChatChrome> = {};

  if (/\b(neon|néon|cyber|synth|vapor)\b/.test(p)) {
    primary = '#A3E635';
    background = '#050605';
    surface = '#0F120E';
    text = '#F4FFE8';
    category = 'neon';
    name = 'Neon Pulse';
    layout.bubbleShape = 'square';
    layout.showTails = false;
    layout.wallpaperPattern = true;
    layout.bubbleShadow = true;
    layout.bubbleShadowStrength = 0.8;
  } else if (/\b(pastel|soft|blush|peach|coral)\b/.test(p)) {
    primary = '#F97366';
    background = '#FFF8F5';
    surface = '#FFFFFF';
    text = '#1C1412';
    category = 'pastel';
    name = 'Soft Pastel';
    layout.bubbleShape = 'pill';
    layout.showTails = false;
    layout.fontScale = 1.05;
  } else if (/\b(ocean|sea|teal|água|agua|wave)\b/.test(p)) {
    primary = '#0D9488';
    background = '#F0FDFA';
    surface = '#FFFFFF';
    text = '#042F2E';
    category = 'nature';
    name = 'Ocean Drift';
    layout.bubbleRadius = 14;
    layout.composerStyle = 'floating';
  } else if (/\b(forest|green|moss|nature|floresta)\b/.test(p)) {
    primary = '#3F6212';
    background = '#F7F6F1';
    surface = '#FFFEF9';
    text = '#1A1F12';
    category = 'nature';
    name = 'Forest Cabin';
    layout.avatarPosition = 'right';
  } else if (/\b(midnight|ink|noir|preto|black)\b/.test(p)) {
    primary = '#818CF8';
    background = '#07080C';
    surface = '#12141C';
    text = '#F1F2F6';
    category = 'midnight';
    name = 'Midnight Ink';
    layout.density = 'roomy';
    layout.bubbleRadius = 18;
  } else if (/\b(minimal|paper|mono|clean|limpo)\b/.test(p)) {
    primary = '#171717';
    background = '#FAFAFA';
    surface = '#FFFFFF';
    text = '#0A0A0A';
    category = 'minimal';
    name = 'Paper Minimal';
    layout.bubbleShape = 'square';
    layout.showTails = false;
    layout.headerStyle = 'minimal';
    layout.density = 'compact';
  } else if (/\b(pink|magenta|sunset|rosa|roxo|purple|violet)\b/.test(p)) {
    primary = '#E879F9';
    background = '#120814';
    surface = '#1C0F20';
    text = '#FDF4FF';
    category = 'neon';
    name = 'Sunset Blvd';
    layout.fontScale = 1.12;
    layout.bubbleShape = 'pill';
    layout.composerStyle = 'floating';
  }

  if (/\b(left|esquerda|canhoto|left-hand)\b/.test(p)) {
    layout.myBubbleSide = 'left';
  }
  if (/\b(right|direita)\b/.test(p)) layout.myBubbleSide = 'right';
  if (/\b(compact|denso|tight)\b/.test(p)) layout.density = 'compact';
  if (/\b(roomy|espaçoso|espacoso|large gap)\b/.test(p)) layout.density = 'roomy';
  if (/\b(big text|texto grande|large text|huge)\b/.test(p)) layout.fontScale = 1.25;
  if (/\b(small text|texto pequeno|tiny)\b/.test(p)) layout.fontScale = 0.9;
  if (/\b(no tail|sem cauda|square)\b/.test(p)) {
    layout.showTails = false;
    layout.bubbleShape = 'square';
  }
  if (/\b(pill|pílula|pilula)\b/.test(p)) {
    layout.bubbleShape = 'pill';
    layout.showTails = false;
  }
  if (/\b(full.?width|largura total)\b/.test(p)) layout.fullWidthBubbles = true;
  if (/\b(shadow|sombra)\b/.test(p)) {
    layout.bubbleShadow = true;
    layout.bubbleShadowStrength = 0.7;
  }
  if (/\b(no shadow|sem sombra)\b/.test(p)) layout.bubbleShadow = false;
  if (/\b(floating composer|compositor flutuante)\b/.test(p)) {
    layout.composerStyle = 'floating';
  }
  if (/\b(bold|negrito)\b/.test(p)) layout.boldOutgoing = true;
  if (/\b(dim|apagado)\b/.test(p)) layout.dimIncoming = true;

  chat.bubbleMine = primary;
  chat.bubbleTheirs = surface;
  chat.wallpaper = dark || (!light && background.startsWith('#0')) ? background : background;
  chat.textMine = dark || primary === '#A3E635' || primary === '#FAFAFA' || primary === '#E879F9' || primary === '#818CF8'
    ? (primary === '#A3E635' || primary === '#FAFAFA' ? background : '#FFFFFF')
    : '#FFFFFF';
  chat.textTheirs = text;
  chat.sendBtnBg = primary;

  const mode: ThemeMode | 'both' = dark && !light ? 'dark' : light && !dark ? 'light' : 'both';

  const customCss = `/* AI generated from: ${prompt.slice(0, 80)} */
:root {
  --primary: ${primary};
  --background: ${background};
  --surface: ${surface};
  --text: ${text};
  --wallpaper: ${chat.wallpaper};
  --bubble-mine: ${chat.bubbleMine};
  --bubble-theirs: ${chat.bubbleTheirs};
  --text-mine: ${chat.textMine};
  --text-theirs: ${chat.textTheirs};
  --my-side: ${layout.myBubbleSide ?? 'right'};
  --bubble-shape: ${layout.bubbleShape ?? 'tail'};
  --bubble-radius: ${layout.bubbleRadius ?? 16};
  --font-scale: ${layout.fontScale ?? 1};
  --density: ${layout.density ?? 'cozy'};
  --show-tails: ${layout.showTails ?? true};
  --bubble-shadow: ${layout.bubbleShadow ?? true};
  --composer: ${layout.composerStyle ?? 'rounded'};
}
`;

  return {
    name,
    description: prompt.trim().slice(0, 120) || 'Generated theme',
    category,
    primary,
    background,
    surface,
    text,
    mode,
    chat,
    layout,
    customCss,
  };
}
