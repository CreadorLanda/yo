import { Ionicons } from '@expo/vector-icons';
import { useEffect } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import Animated, {
  Easing,
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';

import { Text } from '@/components/ui/text';
import { Spacing, Typography } from '@/constants/theme';
import type { LiveComment } from '@/data/api/lives';

/** The live colour: badges, the go-live button, the heart. */
export const LIVE_RED = '#FE2C55';

/** How many comments sit over the video at once. More than this is noise. */
const VISIBLE = 7;

/**
 * A round initial, for people the app has no picture of here.
 */
export function Initial({ name, size = 32 }: { name: string; size?: number }) {
  return (
    <View style={[styles.initial, { width: size, height: size, borderRadius: size / 2 }]}>
      <Text style={[styles.initialText, { fontSize: size * 0.42 }]}>
        {(name || '?').slice(0, 1).toUpperCase()}
      </Text>
    </View>
  );
}

/**
 * Comments over the bottom-left of the video, newest at the bottom, the older
 * ones fading as they climb. A long press is how moderators act on one; the
 * author can take back their own.
 */
export function CommentStream({
  comments,
  note,
  onLongPress,
}: {
  comments: LiveComment[];
  /** A line from the app itself, shown first: the encryption notice. */
  note?: string;
  onLongPress: (c: LiveComment) => void;
}) {
  const shown = comments.slice(-VISIBLE);
  return (
    <View style={styles.stream} pointerEvents="box-none">
      {note && comments.length < VISIBLE ? (
        <View style={[styles.bubble, styles.noteBubble]}>
          <Text style={styles.noteText}>{note}</Text>
        </View>
      ) : null}
      {shown.map((c, i) => (
        <Pressable
          key={c.id}
          onLongPress={() => onLongPress(c)}
          delayLongPress={350}
          style={[styles.bubble, { opacity: 0.45 + (0.55 * (i + 1)) / shown.length }]}
        >
          <Text style={styles.comment}>
            <Text style={styles.author}>{c.name || '…'}  </Text>
            {c.body}
          </Text>
        </Pressable>
      ))}
    </View>
  );
}

export type FloatingHeart = { id: number; drift: number };

/** One heart rising from the button and fading out. */
function Heart({ drift, onDone }: { drift: number; onDone: () => void }) {
  const t = useSharedValue(0);
  useEffect(() => {
    t.value = withTiming(1, { duration: 1800, easing: Easing.out(Easing.quad) }, (finished) => {
      if (finished) runOnJS(onDone)();
    });
  }, [t, onDone]);
  const style = useAnimatedStyle(() => ({
    opacity: t.value < 0.15 ? t.value / 0.15 : 1 - (t.value - 0.15) / 0.85,
    transform: [
      { translateY: -260 * t.value },
      { translateX: drift * Math.sin(t.value * Math.PI) },
      { scale: 0.6 + 0.6 * Math.min(1, t.value * 3) },
    ],
  }));
  return (
    <Animated.View style={[styles.heart, style]} pointerEvents="none">
      <Ionicons name="heart" size={30} color={LIVE_RED} />
    </Animated.View>
  );
}

export function HeartLayer({
  hearts,
  onDone,
}: {
  hearts: FloatingHeart[];
  onDone: (id: number) => void;
}) {
  return (
    <View style={styles.heartLayer} pointerEvents="none">
      {hearts.map((h) => (
        <Heart key={h.id} drift={h.drift} onDone={() => onDone(h.id)} />
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  initial: {
    backgroundColor: 'rgba(255,255,255,0.18)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  initialText: { color: '#FFF', fontWeight: '700' },
  stream: { gap: 6, alignItems: 'flex-start' },
  bubble: {
    maxWidth: '100%',
    paddingHorizontal: Spacing.md,
    paddingVertical: 6,
    borderRadius: 16,
    backgroundColor: 'rgba(0,0,0,0.32)',
  },
  noteBubble: { backgroundColor: 'rgba(255,255,255,0.12)' },
  noteText: { ...Typography.micro, color: 'rgba(255,255,255,0.75)' },
  comment: { ...Typography.callout, color: '#FFF' },
  author: { ...Typography.label, color: 'rgba(255,255,255,0.7)' },
  heartLayer: { position: 'absolute', right: 20, bottom: 0, width: 40, height: 1 },
  heart: { position: 'absolute', bottom: 0, left: 5 },
});
