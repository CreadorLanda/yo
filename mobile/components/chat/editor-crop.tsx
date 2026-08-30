import { Ionicons } from '@expo/vector-icons';
import { Pressable, StyleSheet, View } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, {
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
} from 'react-native-reanimated';

import { Text } from '@/components/ui/text';
import { Spacing, Typography } from '@/constants/theme';

/**
 * Crop frame drawn over the canvas.
 *
 * The rect is kept in canvas pixels while dragging and converted to image
 * pixels only on apply, so the maths stays in one place and a canvas of a
 * different size than the source image cannot skew the result.
 */

export type CropRect = { x: number; y: number; width: number; height: number };

export const ASPECTS: { key: string; label: string; ratio: number | null }[] = [
  { key: 'free', label: '⤢', ratio: null },
  { key: '1:1', label: '1:1', ratio: 1 },
  { key: '4:5', label: '4:5', ratio: 4 / 5 },
  { key: '16:9', label: '16:9', ratio: 16 / 9 },
];

const HANDLE = 28;
const MIN_SIZE = 60;

export function CropOverlay({
  canvasW,
  canvasH,
  aspect,
  onAspect,
  onChange,
}: {
  canvasW: number;
  canvasH: number;
  aspect: number | null;
  onAspect: (key: string, ratio: number | null) => void;
  onChange: (rect: CropRect) => void;
}) {
  const x = useSharedValue(canvasW * 0.1);
  const y = useSharedValue(canvasH * 0.1);
  const w = useSharedValue(canvasW * 0.8);
  const h = useSharedValue(canvasH * 0.8);

  const sx = useSharedValue(0);
  const sy = useSharedValue(0);
  const sw = useSharedValue(0);
  const sh = useSharedValue(0);

  const commit = () => {
    onChange({ x: x.value, y: y.value, width: w.value, height: h.value });
  };

  // Move the whole frame, clamped inside the canvas.
  const move = Gesture.Pan()
    .onStart(() => {
      sx.value = x.value;
      sy.value = y.value;
    })
    .onUpdate((e) => {
      x.value = Math.max(0, Math.min(canvasW - w.value, sx.value + e.translationX));
      y.value = Math.max(0, Math.min(canvasH - h.value, sy.value + e.translationY));
    })
    .onEnd(() => runOnJS(commit)());

  /** Corner drag. dx/dy say which edges this handle owns. */
  const corner = (dx: -1 | 1, dy: -1 | 1) =>
    Gesture.Pan()
      .onStart(() => {
        sx.value = x.value;
        sy.value = y.value;
        sw.value = w.value;
        sh.value = h.value;
      })
      .onUpdate((e) => {
        let nw = sw.value + e.translationX * dx;
        let nh = sh.value + e.translationY * dy;
        nw = Math.max(MIN_SIZE, nw);
        nh = Math.max(MIN_SIZE, nh);

        // With a locked ratio the height follows the width.
        if (aspect) nh = nw / aspect;

        let nx = dx === -1 ? sx.value + (sw.value - nw) : sx.value;
        let ny = dy === -1 ? sy.value + (sh.value - nh) : sy.value;

        // Keep the frame inside the canvas.
        if (nx < 0) {
          nw += nx;
          nx = 0;
        }
        if (ny < 0) {
          nh += ny;
          ny = 0;
        }
        if (nx + nw > canvasW) nw = canvasW - nx;
        if (ny + nh > canvasH) nh = canvasH - ny;
        if (aspect) nh = Math.min(nh, nw / aspect);

        x.value = nx;
        y.value = ny;
        w.value = Math.max(MIN_SIZE, nw);
        h.value = Math.max(MIN_SIZE, nh);
      })
      .onEnd(() => runOnJS(commit)());

  const frame = useAnimatedStyle(() => ({
    left: x.value,
    top: y.value,
    width: w.value,
    height: h.value,
  }));

  // Four shades rather than one cut-out — RN has no mask primitive here.
  const shadeTop = useAnimatedStyle(() => ({ height: y.value }));
  const shadeBottom = useAnimatedStyle(() => ({ top: y.value + h.value }));
  const shadeLeft = useAnimatedStyle(() => ({
    top: y.value,
    height: h.value,
    width: x.value,
  }));
  const shadeRight = useAnimatedStyle(() => ({
    top: y.value,
    height: h.value,
    left: x.value + w.value,
  }));

  return (
    <>
      <View style={StyleSheet.absoluteFill} pointerEvents="box-none">
        <Animated.View style={[styles.shade, styles.shadeH, shadeTop]} pointerEvents="none" />
        <Animated.View style={[styles.shade, styles.shadeH, shadeBottom]} pointerEvents="none" />
        <Animated.View style={[styles.shade, shadeLeft]} pointerEvents="none" />
        <Animated.View style={[styles.shade, shadeRight]} pointerEvents="none" />

        <GestureDetector gesture={move}>
          <Animated.View style={[styles.frame, frame]}>
            <View style={[styles.grid, styles.gridV, { left: '33.33%' }]} />
            <View style={[styles.grid, styles.gridV, { left: '66.66%' }]} />
            <View style={[styles.grid, styles.gridH, { top: '33.33%' }]} />
            <View style={[styles.grid, styles.gridH, { top: '66.66%' }]} />

            <Handle gesture={corner(-1, -1)} style={styles.tl} />
            <Handle gesture={corner(1, -1)} style={styles.tr} />
            <Handle gesture={corner(-1, 1)} style={styles.bl} />
            <Handle gesture={corner(1, 1)} style={styles.br} />
          </Animated.View>
        </GestureDetector>
      </View>

      <View style={styles.aspects}>
        {ASPECTS.map((a) => {
          const active = (a.ratio ?? null) === aspect;
          return (
            <Pressable
              key={a.key}
              onPress={() => onAspect(a.key, a.ratio)}
              style={[styles.aspectBtn, active && styles.aspectActive]}
            >
              {a.key === 'free' ? (
                <Ionicons name="resize-outline" size={16} color="#fff" />
              ) : (
                <Text style={styles.aspectText}>{a.label}</Text>
              )}
            </Pressable>
          );
        })}
      </View>
    </>
  );
}

function Handle({
  gesture,
  style,
}: {
  gesture: ReturnType<typeof Gesture.Pan>;
  style: object;
}) {
  return (
    <GestureDetector gesture={gesture}>
      <View style={[styles.handleHit, style]}>
        <View style={styles.handleDot} />
      </View>
    </GestureDetector>
  );
}

const styles = StyleSheet.create({
  shade: { position: 'absolute', backgroundColor: 'rgba(0,0,0,0.55)' },
  shadeH: { left: 0, right: 0 },
  frame: { position: 'absolute', borderWidth: 1.5, borderColor: '#fff' },
  grid: { position: 'absolute', backgroundColor: 'rgba(255,255,255,0.35)' },
  gridV: { top: 0, bottom: 0, width: StyleSheet.hairlineWidth },
  gridH: { left: 0, right: 0, height: StyleSheet.hairlineWidth },
  handleHit: {
    position: 'absolute',
    width: HANDLE,
    height: HANDLE,
    alignItems: 'center',
    justifyContent: 'center',
  },
  handleDot: { width: 14, height: 14, borderRadius: 7, backgroundColor: '#fff' },
  tl: { left: -HANDLE / 2, top: -HANDLE / 2 },
  tr: { right: -HANDLE / 2, top: -HANDLE / 2 },
  bl: { left: -HANDLE / 2, bottom: -HANDLE / 2 },
  br: { right: -HANDLE / 2, bottom: -HANDLE / 2 },
  aspects: {
    flexDirection: 'row',
    justifyContent: 'center',
    gap: Spacing.sm,
    paddingVertical: Spacing.sm,
  },
  aspectBtn: {
    minWidth: 46,
    height: 32,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(255,255,255,0.14)',
  },
  aspectActive: { backgroundColor: 'rgba(255,255,255,0.4)' },
  aspectText: { ...Typography.caption, color: '#fff', fontWeight: '600' },
});
