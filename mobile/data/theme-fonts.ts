/**
 * Themeable typefaces.
 *
 * Same trick as [theme-icons]: name the *intent*, let the theme pick the
 * drawing. A screen asks for weight 600 and gets whichever face of whichever
 * family is in force, rather than hard-coding `Inter_600SemiBold` in 41 files
 * that between them already say `fontWeight` 300-odd times.
 *
 * Why a weight → face table at all, when React Native has `fontWeight`: on
 * iOS a bundled family exposes one face per registered name, and on Android
 * `fontWeight` against a custom family is ignored outright — ask for 600 and
 * you get the regular face, or a synthetic smear of it. The only portable way
 * to get bold text out of a bundled font is to name the bold face. So the
 * app keeps writing `fontWeight`, and [theme-typography] rewrites it.
 *
 * Pure on purpose — no `require` of a .ttf here, so this file can be reasoned
 * about and tested without a bundler. The bytes live in [theme-font-assets].
 */

export type FontFamilyId = 'system' | 'inter' | 'nunito' | 'lora' | 'space' | 'jetbrains';

/** The four weights bundled per family. */
export type FontWeightKey = '400' | '500' | '600' | '700';

export const FONT_WEIGHTS: FontWeightKey[] = ['400', '500', '600', '700'];

export type FontFamilySpec = {
  id: FontFamilyId;
  /** Shown in the picker. A typeface name is a proper noun — not translated. */
  label: string;
  /**
   * Registered face name per weight, which is also the export name in the
   * `@expo-google-fonts` package. Empty for `system`, which has no faces to
   * register because it is whatever the OS already draws with.
   */
  faces: Record<FontWeightKey, string>;
};

export const FONT_FAMILIES: FontFamilySpec[] = [
  {
    id: 'system',
    label: 'System',
    faces: { '400': '', '500': '', '600': '', '700': '' },
  },
  {
    id: 'inter',
    label: 'Inter',
    faces: {
      '400': 'Inter_400Regular',
      '500': 'Inter_500Medium',
      '600': 'Inter_600SemiBold',
      '700': 'Inter_700Bold',
    },
  },
  {
    id: 'nunito',
    label: 'Nunito',
    faces: {
      '400': 'Nunito_400Regular',
      '500': 'Nunito_500Medium',
      '600': 'Nunito_600SemiBold',
      '700': 'Nunito_700Bold',
    },
  },
  {
    id: 'lora',
    label: 'Lora',
    faces: {
      '400': 'Lora_400Regular',
      '500': 'Lora_500Medium',
      '600': 'Lora_600SemiBold',
      '700': 'Lora_700Bold',
    },
  },
  {
    id: 'space',
    label: 'Space Grotesk',
    faces: {
      '400': 'SpaceGrotesk_400Regular',
      '500': 'SpaceGrotesk_500Medium',
      '600': 'SpaceGrotesk_600SemiBold',
      '700': 'SpaceGrotesk_700Bold',
    },
  },
  {
    id: 'jetbrains',
    label: 'JetBrains Mono',
    faces: {
      '400': 'JetBrainsMono_400Regular',
      '500': 'JetBrainsMono_500Medium',
      '600': 'JetBrainsMono_600SemiBold',
      '700': 'JetBrainsMono_700Bold',
    },
  },
];

export const FONT_FAMILY_IDS: FontFamilyId[] = FONT_FAMILIES.map((f) => f.id);

export function fontFamilySpec(id: FontFamilyId): FontFamilySpec {
  return FONT_FAMILIES.find((f) => f.id === id) ?? FONT_FAMILIES[0];
}

/**
 * Snap any React Native `fontWeight` onto one of the four bundled weights.
 *
 * The style prop accepts numbers, numeric strings, `'normal'`, `'bold'` and
 * the nine hundreds — of which we bundle four. Anything lighter than regular
 * rounds up rather than down: a family without a light face rendering 300 as
 * 400 is a shade too heavy, while rendering it as 700 is a different design.
 */
export function nearestWeight(weight: unknown): FontWeightKey {
  if (weight === 'bold') return '700';
  if (weight === 'normal' || weight === undefined || weight === null) return '400';
  const n = typeof weight === 'number' ? weight : Number(weight);
  if (!Number.isFinite(n)) return '400';
  if (n >= 700) return '700';
  if (n >= 600) return '600';
  if (n >= 500) return '500';
  return '400';
}

/**
 * The face to draw with, or `null` to leave the platform font alone.
 *
 * `null` rather than a name is the whole contract: `system` must not set
 * `fontFamily` at all, because the OS default is not a font you can name —
 * on iOS it is San Francisco with the dynamic-type metrics attached, and
 * naming it flattens exactly the accessibility behaviour people rely on.
 */
export function resolveFontFace(id: FontFamilyId, weight: unknown): string | null {
  const spec = fontFamilySpec(id);
  const face = spec.faces[nearestWeight(weight)];
  return face || null;
}
