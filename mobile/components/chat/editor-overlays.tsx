import { Image } from 'expo-image';
import { StyleSheet } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withSpring,
} from 'react-native-reanimated';

import { Text } from '@/components/ui/text';

/**
 * Draggable overlays for the media editor.
 *
 * Text and stickers live in normalised coordinates (0-1 of the canvas), so
 * the same layout survives the canvas being a different size on export
 * than it was on screen.
 */

export type TextOverlay = {
  id: string;
  kind: 'text';
  value: string;
  color: string;
  /** Fractions of canvas width/height, 0-1. */
  x: number;
  y: number;
  scale: number;
  rotation: number;
};

export type StickerOverlay = {
  id: string;
  kind: 'sticker';
  uri: string;
  x: number;
  y: number;
  scale: number;
  rotation: number;
};

export type Overlay = TextOverlay | StickerOverlay;

export type DrawPath = {
  id: string;
  /** SVG path data in canvas pixels. */
  d: string;
  color: string;
  width: number;
};

const STICKER_BASE = 120;

/**
 * One overlay with pan + pinch + rotate. Position is committed back in
 * normalised form when the gesture ends, so re-renders do not fight the
 * live transform.
 */
export function DraggableOverlay({
  overlay,
  canvasW,
  canvasH,
  selected,
  onSelect,
  onCommit,
}: {
  overlay: Overlay;
  canvasW: number;
  canvasH: number;
  selected: boolean;
  onSelect: () => void;
  onCommit: (next: Partial<Overlay>) => void;
}) {
  const tx = useSharedValue(overlay.x * canvasW);
  const ty = useSharedValue(overlay.y * canvasH);
  const scale = useSharedValue(overlay.scale);
  const rot = useSharedValue(overlay.rotation);

  const startX = useSharedValue(0);
  const startY = useSharedValue(0);
  const startScale = useSharedValue(1);
  const startRot = useSharedValue(0);

  const pan = Gesture.Pan()
    .onStart(() => {
      startX.value = tx.value;
      startY.value = ty.value;
    })
    .onUpdate((e) => {
      tx.value = startX.value + e.translationX;
      ty.value = startY.value + e.translationY;
    })
    .onEnd(() => {
      onCommit({ x: tx.value / canvasW, y: ty.value / canvasH });
    });

  const pinch = Gesture.Pinch()
    .onStart(() => {
      startScale.value = scale.value;
    })
    .onUpdate((e) => {
      scale.value = Math.max(0.3, Math.min(4, startScale.value * e.scale));
    })
    .onEnd(() => {
      onCommit({ scale: scale.value });
    });

  const rotate = Gesture.Rotation()
    .onStart(() => {
      startRot.value = rot.value;
    })
    .onUpdate((e) => {
      rot.value = startRot.value + e.rotation;
    })
    .onEnd(() => {
      onCommit({ rotation: rot.value });
    });

  const tap = Gesture.Tap().onEnd(() => {
    scale.value = withSpring(scale.value, { damping: 12 });
    onSelect();
  });

  const gesture = Gesture.Simultaneous(pan, pinch, rotate, tap);

  const style = useAnimatedStyle(() => ({
    transform: [
      { translateX: tx.value },
      { translateY: ty.value },
      { scale: scale.value },
      { rotate: `${rot.value}rad` },
    ],
  }));

  return (
    <GestureDetector gesture={gesture}>
      <Animated.View style={[styles.overlay, style, selected && styles.selected]}>
        {overlay.kind === 'text' ? (
          <Text style={[styles.text, { color: overlay.color }]}>{overlay.value}</Text>
        ) : (
          <Image
            source={{ uri: overlay.uri }}
            style={{ width: STICKER_BASE, height: STICKER_BASE }}
            contentFit="contain"
            autoplay
          />
        )}
      </Animated.View>
    </GestureDetector>
  );
}

const styles = StyleSheet.create({
  overlay: {
    position: 'absolute',
    left: 0,
    top: 0,
    padding: 6,
  },
  selected: {
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.7)',
    borderStyle: 'dashed',
    borderRadius: 6,
  },
  text: {
    fontSize: 30,
    fontWeight: '700',
    textShadowColor: 'rgba(0,0,0,0.55)',
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 4,
  },
});
