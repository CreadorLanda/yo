import {
  StyleSheet,
  Text as RNText,
  TextInput as RNTextInput,
  type StyleProp,
  type TextProps,
  type TextInputProps,
  type TextStyle,
} from 'react-native';

import { resolveFontFace, type FontFamilyId } from '@/data/theme-fonts';
import { useThemeFontFamily } from '@/data/theme-store';

/**
 * `Text` and `TextInput`, with the theme's typeface already on them.
 *
 * A drop-in for the React Native pair — same props, same refs — so a screen
 * changes its import and nothing else. That indirection is the whole reason
 * this file exists: React Native 0.81 exposes `Text` through a getter with no
 * setter and builds it as a plain function component, so there is no longer
 * anywhere to patch a default font in globally. The font has to arrive at the
 * call sites, and a wrapper is the only way to get it there without writing
 * `fontFamily` into all 41 files that set a `fontWeight`.
 *
 * Two things happen to the style, and only when a family is actually chosen:
 *
 *  - `fontWeight` is translated into a named face, because a bundled family
 *    does not respond to numeric weight — see [theme-fonts].
 *  - the weight is then dropped. Left in place, iOS applies its own synthetic
 *    emboldening *on top of* a face that is already bold, and the result is
 *    the smeared too-heavy text that gives custom fonts a bad name.
 *
 * On the default `system` family neither happens and the style is passed
 * straight through, untouched and un-flattened. That is deliberate: it is the
 * setting almost everybody is on, it keeps this wrapper free at the point of
 * use, and naming a font is what would cost iOS its dynamic-type metrics.
 */

function withFace(
  style: StyleProp<TextStyle>,
  family: FontFamilyId,
): StyleProp<TextStyle> {
  if (family === 'system') return style;
  const flat = StyleSheet.flatten(style) ?? {};
  // A caller that named a face meant it — the theme does not get to overrule
  // a deliberate choice. This is what lets the theme editor preview a font
  // that is not the one currently in force.
  if (flat.fontFamily) return style;
  const face = resolveFontFace(family, flat.fontWeight);
  if (!face) return style;
  return { ...flat, fontFamily: face, fontWeight: undefined };
}

export type ThemedTextProps = TextProps & {
  ref?: React.Ref<React.ComponentRef<typeof RNText>>;
  /**
   * Draw in this family instead of the one in force. For previewing a theme
   * that has not been applied — nothing else should need it.
   */
  font?: FontFamilyId;
};

export function Text({ style, font, ...rest }: ThemedTextProps) {
  const active = useThemeFontFamily();
  return <RNText {...rest} style={withFace(style, font ?? active)} />;
}

/**
 * What a `ref` on `<TextInput>` hands back — still the native handle, so
 * `.focus()`, `.blur()` and `.clear()` work exactly as before. Exported
 * because the name `TextInput` now refers to the wrapper, and a wrapper is a
 * function: `useRef<TextInput>` no longer type-checks where it used to.
 */
export type TextInputHandle = React.ComponentRef<typeof RNTextInput>;

export type ThemedTextInputProps = TextInputProps & {
  ref?: React.Ref<TextInputHandle>;
  font?: FontFamilyId;
};

export function TextInput({ style, font, ...rest }: ThemedTextInputProps) {
  const active = useThemeFontFamily();
  return <RNTextInput {...rest} style={withFace(style, font ?? active)} />;
}
