import { Ionicons } from '@expo/vector-icons';
import { useEffect } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, { runOnJS, useAnimatedStyle, useSharedValue, withSpring } from 'react-native-reanimated';

import { Text } from '@/components/ui/text';
import { Radii } from '@/constants/theme';

/**
 * The pieces of the call screen that are about looks rather than calls:
 * round controls, avatar tiles and the draggable picture of yourself.
 */

export const CALL_RED = '#E5484D';
export const PIP_W = 104;
export const PIP_H = 148;
const PIP_GAP = 12;

/** A round control on the bottom panel. `active` is the "off" look: white. */
export function RoundControl({
  icon,
  label,
  onPress,
  active,
  danger,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  onPress: () => void;
  active?: boolean;
  danger?: boolean;
}) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={active === undefined ? undefined : { selected: active }}
      style={({ pressed }) => [
        styles.control,
        active && styles.controlActive,
        danger && styles.controlDanger,
        pressed && { opacity: 0.75 },
      ]}
    >
      <Ionicons
        name={icon}
        size={24}
        color={active && !danger ? '#0B0C10' : '#FFFFFF'}
        style={danger ? { transform: [{ rotate: '135deg' }] } : undefined}
      />
    </Pressable>
  );
}

/** A round initial, for people whose camera is off. */
export function CallAvatar({ name, size }: { name: string; size: number }) {
  return (
    <View style={[styles.avatar, { width: size, height: size, borderRadius: size / 2 }]}>
      <Text style={[styles.avatarText, { fontSize: size * 0.42 }]}>
        {(name || '?').trim().slice(0, 1).toUpperCase()}
      </Text>
    </View>
  );
}

/** The corner a picture-in-picture rests in. */
export type Corner = 'tl' | 'tr' | 'bl' | 'br';

export function cornerPosition(
  corner: Corner,
  area: { w: number; h: number },
  reserve: { top: number; bottom: number },
): { x: number; y: number } {
  const left = PIP_GAP;
  const right = Math.max(left, area.w - PIP_W - PIP_GAP);
  const top = reserve.top + PIP_GAP;
  const bottom = Math.max(top, area.h - reserve.bottom - PIP_H - PIP_GAP);
  return { x: corner[1] === 'l' ? left : right, y: corner[0] === 't' ? top : bottom };
}

/**
 * A small window that sits over the call, drags to any corner and springs
 * into it, and swaps with the big picture when tapped. Children fill it.
 */
export function PictureInPicture({
  area,
  reserve,
  corner,
  onCorner,
  onPress,
  children,
}: {
  /** The size of the space it moves in. */
  area: { w: number; h: number };
  /** Space it keeps clear of at the top (header) and bottom (controls). */
  reserve: { top: number; bottom: number };
  corner: Corner;
  onCorner: (c: Corner) => void;
  onPress: () => void;
  children: React.ReactNode;
}) {
  const start = cornerPosition(corner, area, reserve);
  const x = useSharedValue(start.x);
  const y = useSharedValue(start.y);
  const originX = useSharedValue(start.x);
  const originY = useSharedValue(start.y);

  // Follow the corner, and the space, when either changes: the controls
  // hiding gives it the room they took.
  useEffect(() => {
    const p = cornerPosition(corner, area, reserve);
    x.value = withSpring(p.x, { damping: 18, stiffness: 220 });
    y.value = withSpring(p.y, { damping: 18, stiffness: 220 });
  }, [corner, area, reserve, x, y]);

  const settle = (c: Corner) => onCorner(c);

  const drag = Gesture.Pan()
    .onStart(() => {
      originX.value = x.value;
      originY.value = y.value;
    })
    .onUpdate((e) => {
      x.value = originX.value + e.translationX;
      y.value = originY.value + e.translationY;
    })
    .onEnd(() => {
      const mid = {
        x: area.w / 2 - PIP_W / 2,
        y: (reserve.top + area.h - reserve.bottom - PIP_H) / 2,
      };
      const next = `${y.value < mid.y ? 't' : 'b'}${x.value < mid.x ? 'l' : 'r'}` as Corner;
      runOnJS(settle)(next);
    });

  const tap = Gesture.Tap().onEnd((_e, ok) => {
    if (ok) runOnJS(onPress)();
  });

  const style = useAnimatedStyle(() => ({
    transform: [{ translateX: x.value }, { translateY: y.value }],
  }));

  return (
    <GestureDetector gesture={Gesture.Exclusive(drag, tap)}>
      <Animated.View style={[styles.pip, style]}>{children}</Animated.View>
    </GestureDetector>
  );
}

const styles = StyleSheet.create({
  control: {
    width: 56,
    height: 56,
    borderRadius: 28,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(255,255,255,0.16)',
  },
  controlActive: { backgroundColor: '#FFFFFF' },
  controlDanger: { backgroundColor: CALL_RED },
  avatar: {
    backgroundColor: 'rgba(255,255,255,0.14)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarText: { color: '#FFFFFF', fontWeight: '700' },
  pip: {
    position: 'absolute',
    left: 0,
    top: 0,
    width: PIP_W,
    height: PIP_H,
    borderRadius: Radii.lg,
    overflow: 'hidden',
    backgroundColor: '#1B1C22',
    borderWidth: 1.5,
    borderColor: 'rgba(255,255,255,0.35)',
    shadowColor: '#000',
    shadowOpacity: 0.35,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 4 },
    elevation: 6,
  },
});
