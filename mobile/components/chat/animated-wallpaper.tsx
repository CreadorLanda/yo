import { useEffect, useState } from 'react';
import { AccessibilityInfo, StyleSheet, View } from 'react-native';
import Animated, {
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withTiming,
  interpolate,
} from 'react-native-reanimated';

import { withAlpha, type WallpaperAnimation } from '@/data/theme-model';

/**
 * A wallpaper that moves.
 *
 * Soft blobs of the theme's own colours, drifting behind the thread — no
 * gradient library and no Skia canvas, because this sits under a scrolling
 * list for as long as the chat is open and has to cost nothing. Two or three
 * views at low opacity with a very large corner radius read as a glow, and
 * animate on the UI thread through Reanimated without a re-render.
 *
 * Opacity is kept deliberately low. This is behind text people are reading;
 * a background that competes with the messages is a background that has to be
 * turned off, and nobody turns it back on.
 */
export function AnimatedWallpaper({
  animation,
  tint,
  accent,
}: {
  animation: WallpaperAnimation;
  /** Usually the theme's primary. */
  tint: string;
  /** A second colour so the motion is visible without being loud. */
  accent: string;
}) {
  const progress = useSharedValue(0);
  // Motion behind text is exactly what someone who asked the OS to stop
  // animating things asked it to stop. Honour that: the colours stay, the
  // movement goes.
  const [reduceMotion, setReduceMotion] = useState(false);

  useEffect(() => {
    let alive = true;
    AccessibilityInfo.isReduceMotionEnabled()
      .then((on) => {
        if (alive) setReduceMotion(on);
      })
      .catch(() => {});
    const sub = AccessibilityInfo.addEventListener('reduceMotionChanged', (on) =>
      setReduceMotion(on),
    );
    return () => {
      alive = false;
      sub.remove();
    };
  }, []);

  useEffect(() => {
    if (animation === 'none' || reduceMotion) {
      progress.value = 0;
      return;
    }
    progress.value = 0;
    progress.value = withRepeat(
      withTiming(1, {
        // Slow enough to be noticed only if you look for it. Anything faster
        // behind a chat thread is a distraction, not a theme.
        duration: animation === 'pulse' ? 6000 : 14000,
        easing: Easing.inOut(Easing.ease),
      }),
      -1,
      true,
    );
  }, [animation, reduceMotion, progress]);

  const blobA = useAnimatedStyle(() => ({
    transform: [
      { translateX: interpolate(progress.value, [0, 1], [-70, 60]) },
      { translateY: interpolate(progress.value, [0, 1], [-40, 50]) },
      { scale: interpolate(progress.value, [0, 1], [1, 1.25]) },
    ],
  }));

  const blobB = useAnimatedStyle(() => ({
    transform: [
      { translateX: interpolate(progress.value, [0, 1], [60, -50]) },
      { translateY: interpolate(progress.value, [0, 1], [40, -60]) },
      { scale: interpolate(progress.value, [0, 1], [1.2, 0.95]) },
    ],
  }));

  const band = useAnimatedStyle(() => ({
    transform: [
      { rotate: '-24deg' },
      { translateY: interpolate(progress.value, [0, 1], [-160, 160]) },
    ],
  }));

  const pulse = useAnimatedStyle(() => ({
    opacity: interpolate(progress.value, [0, 1], [0.5, 1]),
    transform: [{ scale: interpolate(progress.value, [0, 1], [0.85, 1.15]) }],
  }));

  if (animation === 'none') return null;

  if (animation === 'drift') {
    return (
      <View pointerEvents="none" style={styles.layer}>
        <Animated.View
          style={[styles.band, { backgroundColor: withAlpha(tint, 0.16) }, band]}
        />
      </View>
    );
  }

  if (animation === 'pulse') {
    return (
      <View pointerEvents="none" style={styles.layer}>
        <Animated.View
          style={[styles.centreBlob, { backgroundColor: withAlpha(tint, 0.14) }, pulse]}
        />
      </View>
    );
  }

  // aurora
  return (
    <View pointerEvents="none" style={styles.layer}>
      <Animated.View
        style={[styles.blob, styles.blobTopLeft, { backgroundColor: withAlpha(tint, 0.18) }, blobA]}
      />
      <Animated.View
        style={[
          styles.blob,
          styles.blobBottomRight,
          { backgroundColor: withAlpha(accent, 0.16) },
          blobB,
        ]}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  // `overflow: hidden` so a blob that wanders off does not widen the screen.
  layer: { ...StyleSheet.absoluteFillObject, overflow: 'hidden' },
  blob: {
    position: 'absolute',
    width: 320,
    height: 320,
    borderRadius: 160,
  },
  blobTopLeft: { top: -80, left: -90 },
  blobBottomRight: { bottom: -70, right: -80 },
  band: {
    position: 'absolute',
    left: -120,
    right: -120,
    height: 220,
    top: '38%',
    borderRadius: 110,
  },
  centreBlob: {
    position: 'absolute',
    alignSelf: 'center',
    top: '28%',
    width: 300,
    height: 300,
    borderRadius: 150,
  },
});
