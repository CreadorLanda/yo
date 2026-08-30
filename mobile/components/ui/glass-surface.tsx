import { BlurView } from 'expo-blur';
import { StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';

import { withAlpha } from '@/data/theme-model';
import { useTheme } from '@/hooks/use-theme';

/**
 * A panel that is either a solid colour or frosted glass, depending on the
 * theme's `glassChrome` knob.
 *
 * The two cases are one component rather than a conditional at each call site
 * because they must stay interchangeable: every surface that can be glass has
 * to be *opaque* when it is not, or the layout underneath shows through a
 * design that never accounted for it.
 *
 * Frosted means two layers, not one. A `BlurView` alone samples whatever is
 * behind it and returns it blurred — which, over a busy thread, is unreadable
 * behind text. So the blur is topped with the surface colour at partial
 * opacity: enough to hold contrast for the label on it, little enough that
 * the movement underneath still reads. Blur strength is the theme's; the tint
 * opacity is derived from it, because a heavier blur wants less colour on top
 * to say the same thing.
 */
export function GlassSurface({
  color,
  style,
  children,
  pointerEvents,
}: {
  /** The colour this surface would be if it were solid. */
  color: string;
  style?: StyleProp<ViewStyle>;
  children?: React.ReactNode;
  pointerEvents?: 'auto' | 'none' | 'box-none' | 'box-only';
}) {
  const { layout, isDark } = useTheme();

  if (!layout.glassChrome) {
    return (
      <View pointerEvents={pointerEvents} style={[style, { backgroundColor: color }]}>
        {children}
      </View>
    );
  }

  const intensity = Math.max(10, Math.min(100, layout.glassIntensity));
  // 45 → 0.55, 100 → 0.30. Never fully clear: a bar you cannot read is not a
  // style choice, it is a bug with a name.
  const tint = 0.72 - (intensity / 100) * 0.42;

  return (
    <View pointerEvents={pointerEvents} style={[style, styles.clip]}>
      <BlurView
        intensity={intensity}
        tint={isDark ? 'dark' : 'light'}
        style={StyleSheet.absoluteFill}
      />
      <View
        pointerEvents="none"
        style={[StyleSheet.absoluteFill, { backgroundColor: withAlpha(color, tint) }]}
      />
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  // Without this the blur paints past a rounded corner, because it is a
  // sibling of the content rather than a background on it.
  clip: { overflow: 'hidden', backgroundColor: 'transparent' },
});
