import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { Modal, Pressable, StyleSheet, View } from 'react-native';
import Animated, {
  FadeIn,
  FadeInDown,
  ZoomIn,
  useAnimatedStyle,
  useSharedValue,
  withSequence,
  withSpring,
} from 'react-native-reanimated';

import { Text } from '@/components/ui/text';
import { Radii, Spacing, Typography } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

const DEFAULT_EMOJIS = ['❤️', '😂', '😮', '😢', '😡', '👍', '🔥', '👏'] as const;

type Props = {
  visible: boolean;
  activeEmoji?: string | null;
  emojis?: readonly string[];
  onSelect: (emoji: string) => void;
  onComment?: () => void;
  /** Absent when the item cannot be forwarded. */
  onForward?: () => void;
  onClose: () => void;
  /** Absolute position (optional). When omitted, centers on screen. */
  anchor?: { left: number; top: number; width: number } | null;
  commentLabel?: string;
  forwardLabel?: string;
};

/**
 * Glass reaction tray — Instagram/Telegram style floating emoji picker.
 */
export function ReactionTray({
  visible,
  activeEmoji,
  emojis = DEFAULT_EMOJIS,
  onSelect,
  onComment,
  onForward,
  onClose,
  anchor,
  commentLabel = 'Comment',
  forwardLabel = 'Forward',
}: Props) {
  const { colors, isDark } = useTheme();

  return (
    <Modal transparent animationType="fade" visible={visible} onRequestClose={onClose}>
      <View style={StyleSheet.absoluteFill}>
        <Pressable style={styles.backdrop} onPress={onClose} />
        <Animated.View
          entering={FadeInDown.springify().damping(16)}
          style={[
            styles.tray,
            {
              backgroundColor: isDark ? 'rgba(28,30,38,0.96)' : 'rgba(255,255,255,0.97)',
              borderColor: isDark ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.06)',
              shadowColor: '#0B1020',
            },
            anchor
              ? { left: anchor.left, top: anchor.top, width: anchor.width }
              : styles.trayCentered,
          ]}
        >
          <View style={styles.emojiRow}>
            {emojis.map((emoji, i) => (
              <EmojiBtn
                key={emoji}
                emoji={emoji}
                index={i}
                active={activeEmoji === emoji}
                activeColor={colors.primary}
                onPress={() => {
                  Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
                  onSelect(emoji);
                }}
              />
            ))}
          </View>

          {onComment ? (
            <>
              <View
                style={[
                  styles.sep,
                  { backgroundColor: isDark ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.08)' },
                ]}
              />
              <Pressable
                onPress={() => {
                  Haptics.selectionAsync();
                  onComment();
                }}
                style={({ pressed }) => [
                  styles.commentBtn,
                  {
                    backgroundColor: isDark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.04)',
                  },
                  pressed && { opacity: 0.8 },
                ]}
              >
                <Ionicons name="chatbubble-ellipses" size={16} color={colors.primary} />
                <Text style={[styles.commentText, { color: colors.text }]}>{commentLabel}</Text>
                <Ionicons name="chevron-forward" size={14} color={colors.textMuted} />
              </Pressable>
            </>
          ) : null}

          {/* Forward sits beside comment rather than in a second menu: a
              long press is already the "do something with this" gesture, and
              splitting its results across two layers means learning both. */}
          {onForward ? (
            <Pressable
              onPress={() => {
                Haptics.selectionAsync();
                onForward();
              }}
              style={({ pressed }) => [
                styles.commentBtn,
                { backgroundColor: isDark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.04)' },
                pressed && { opacity: 0.8 },
              ]}
            >
              <Ionicons name="arrow-redo" size={16} color={colors.primary} />
              <Text style={[styles.commentText, { color: colors.text }]}>{forwardLabel}</Text>
              <Ionicons name="chevron-forward" size={14} color={colors.textMuted} />
            </Pressable>
          ) : null}
        </Animated.View>
      </View>
    </Modal>
  );
}

function EmojiBtn({
  emoji,
  index,
  active,
  activeColor,
  onPress,
}: {
  emoji: string;
  index: number;
  active: boolean;
  activeColor: string;
  onPress: () => void;
}) {
  const scale = useSharedValue(1);
  const style = useAnimatedStyle(() => ({ transform: [{ scale: scale.value }] }));

  return (
    <Pressable
      onPress={() => {
        scale.value = withSequence(
          withSpring(1.35, { damping: 8, stiffness: 320 }),
          withSpring(1, { damping: 12, stiffness: 220 }),
        );
        onPress();
      }}
      hitSlop={4}
    >
      <Animated.View
        entering={ZoomIn.delay(30 + index * 28).springify()}
        style={[
          styles.emojiBtn,
          active && { backgroundColor: `${activeColor}22`, borderColor: activeColor },
          style,
        ]}
      >
        <Text style={styles.emoji}>{emoji}</Text>
      </Animated.View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0,0,0,0.28)',
  },
  tray: {
    position: 'absolute',
    borderRadius: 28,
    borderWidth: 1,
    padding: 10,
    gap: 8,
    shadowOpacity: 0.22,
    shadowRadius: 28,
    shadowOffset: { width: 0, height: 12 },
    elevation: 16,
  },
  trayCentered: {
    left: Spacing.xl,
    right: Spacing.xl,
    top: '38%',
  },
  emojiRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 2,
  },
  emojiBtn: {
    width: 42,
    height: 42,
    borderRadius: Radii.pill,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1.5,
    borderColor: 'transparent',
  },
  emoji: { fontSize: 24 },
  sep: { height: StyleSheet.hairlineWidth, marginHorizontal: 4 },
  commentBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderRadius: Radii.pill,
  },
  commentText: { ...Typography.caption, fontWeight: '700', flex: 1 },
});
