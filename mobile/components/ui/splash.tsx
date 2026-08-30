import { Image } from 'expo-image';
import { useEffect } from 'react';
import { StyleSheet, View } from 'react-native';
import Animated, {
  Easing,
  cancelAnimation,
  interpolate,
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withDelay,
  withRepeat,
  withSequence,
  withSpring,
  withTiming,
} from 'react-native-reanimated';

import { Text } from '@/components/ui/text';
import { Spacing, Typography } from '@/constants/theme';

/**
 * The colour behind the mark, and the plate the logo was drawn on.
 *
 * Hard-coded rather than taken from the theme on purpose: this has to match
 * `splash.backgroundColor` in app.json exactly. The native splash is already
 * on screen when this mounts, and any difference between the two shows as a
 * flash at the handover — which is the thing a splash exists to prevent.
 */
export const SPLASH_BG = '#0D0D16';

const MARK = require('@/assets/images/splash-icon.png');

/**
 * The animated splash.
 *
 * Two splashes run back to back: the native one, which the OS paints before
 * any JavaScript exists, and this one, which takes over the moment React
 * mounts. They share a background colour and the same artwork at the same
 * size, so the handover is invisible and the motion looks like it started on
 * the native frame.
 *
 * It replaces a plain coloured rectangle that covered the app until boot
 * resolved. That rectangle did its job — it hid the onboarding flash — but it
 * gave no sign the app was doing anything, which on a cold start over a slow
 * network is indistinguishable from a hang.
 */
export function AnimatedSplash({
  /** Boot has finished; play the exit and then call onDone. */
  done,
  onDone,
}: {
  done: boolean;
  onDone: () => void;
}) {
  // Entry: the mark settles in rather than appearing. Spring, not timing —
  // the overshoot is what makes it feel like an object rather than a fade.
  const enter = useSharedValue(0);
  // Breathing, while there is nothing else to report.
  const pulse = useSharedValue(0);
  // Exit: the whole screen lifts to reveal the app underneath.
  const exit = useSharedValue(0);

  useEffect(() => {
    enter.value = withSpring(1, { damping: 12, stiffness: 90, mass: 0.9 });
    pulse.value = withDelay(
      420,
      withRepeat(
        withSequence(
          withTiming(1, { duration: 900, easing: Easing.inOut(Easing.quad) }),
          withTiming(0, { duration: 900, easing: Easing.inOut(Easing.quad) }),
        ),
        -1,
        false,
      ),
    );
    return () => {
      cancelAnimation(enter);
      cancelAnimation(pulse);
      cancelAnimation(exit);
    };
  }, [enter, pulse, exit]);

  useEffect(() => {
    if (!done) return;
    // Stop breathing before leaving, or the mark pulses on its way out.
    cancelAnimation(pulse);
    pulse.value = withTiming(0, { duration: 160 });
    exit.value = withDelay(
      120,
      withTiming(1, { duration: 380, easing: Easing.in(Easing.cubic) }, (finished) => {
        // Unmounted from the worklet so the cover is removed on the frame the
        // fade ends. Removing it on a timer instead leaves either a flash of
        // the app under a still-opaque cover, or a dead frame after it.
        if (finished) runOnJS(onDone)();
      }),
    );
  }, [done, exit, pulse, onDone]);

  const screenStyle = useAnimatedStyle(() => ({
    opacity: 1 - exit.value,
  }));

  const markStyle = useAnimatedStyle(() => ({
    opacity: enter.value,
    transform: [
      { scale: interpolate(enter.value, [0, 1], [0.82, 1]) + pulse.value * 0.03 },
      // A hair of lift on the way out, so it leaves rather than dissolves.
      { translateY: interpolate(exit.value, [0, 1], [0, -18]) },
    ],
  }));

  const wordStyle = useAnimatedStyle(() => ({
    opacity: interpolate(enter.value, [0.4, 1], [0, 1], 'clamp') * (1 - exit.value),
    transform: [{ translateY: interpolate(enter.value, [0.4, 1], [10, 0], 'clamp') }],
  }));

  return (
    <Animated.View style={[styles.screen, screenStyle]} pointerEvents="none">
      <Animated.View style={markStyle}>
        <Image source={MARK} style={styles.mark} contentFit="contain" />
      </Animated.View>

      <Animated.View style={[styles.footer, wordStyle]}>
        <Dots />
        <Text style={styles.tagline}>Yo</Text>
      </Animated.View>
    </Animated.View>
  );
}

/**
 * Three dots, staggered — the typing indicator, borrowed.
 *
 * A spinner would say "working"; this says "a conversation is loading",
 * which is both truer and the one visual idea the whole product is built on.
 */
function Dots() {
  return (
    <View style={styles.dots}>
      {[0, 1, 2].map((i) => (
        <Dot key={i} index={i} />
      ))}
    </View>
  );
}

function Dot({ index }: { index: number }) {
  const v = useSharedValue(0);

  useEffect(() => {
    v.value = withDelay(
      // Staggered, not simultaneous: three dots pulsing in unison read as one
      // blinking blob.
      index * 160,
      withRepeat(
        withSequence(
          withTiming(1, { duration: 380, easing: Easing.out(Easing.quad) }),
          withTiming(0, { duration: 520, easing: Easing.in(Easing.quad) }),
        ),
        -1,
        false,
      ),
    );
    return () => cancelAnimation(v);
  }, [index, v]);

  const style = useAnimatedStyle(() => ({
    opacity: interpolate(v.value, [0, 1], [0.25, 1]),
    transform: [{ translateY: interpolate(v.value, [0, 1], [0, -5]) }],
  }));

  return <Animated.View style={[styles.dot, style]} />;
}

const styles = StyleSheet.create({
  screen: {
    ...StyleSheet.absoluteFillObject,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: SPLASH_BG,
  },
  // Matches the native splash's image width so the two frames line up.
  mark: { width: 200, height: 200 },
  footer: {
    position: 'absolute',
    bottom: 72,
    alignItems: 'center',
    gap: Spacing.md,
  },
  dots: { flexDirection: 'row', gap: 7 },
  dot: {
    width: 7,
    height: 7,
    borderRadius: 4,
    backgroundColor: '#818CF8',
  },
  tagline: {
    ...Typography.caption,
    letterSpacing: 2,
    textTransform: 'uppercase',
    color: 'rgba(255,255,255,0.38)',
  },
});
