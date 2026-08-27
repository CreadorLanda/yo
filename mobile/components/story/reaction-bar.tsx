import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { useState } from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withSequence,
  withSpring,
} from 'react-native-reanimated';

import { Radii, Spacing, Typography } from '@/constants/theme';
import {
  ALL_REACTIONS,
  countOf,
  reactionBarEmojis,
  type StoryReactionCount,
} from '@/data/story-reactions';
import { t } from '@/i18n';

/**
 * The reaction bar under a story.
 *
 * Several emoji at once, so a chip is a toggle rather than a send button:
 * tapping 🔥 then ❤️ leaves both, and tapping 🔥 again takes it back. The
 * count beside each one is everybody's; the ring around it means you are in
 * that number.
 *
 * Dark and self-contained rather than theme-aware, like the rest of the story
 * viewer: it sits on top of somebody's photo at whatever hour they watch it.
 */
export function ReactionBar({
  counts,
  mine,
  onToggle,
  onSheetOpenChange,
}: {
  counts: readonly StoryReactionCount[];
  mine: readonly string[];
  onToggle: (emoji: string) => void;
  /** The story pauses while the full set is open. */
  onSheetOpenChange?: (open: boolean) => void;
}) {
  const [sheetOpen, setSheetOpen] = useState(false);

  const openSheet = (open: boolean) => {
    setSheetOpen(open);
    onSheetOpenChange?.(open);
  };

  return (
    <View style={styles.bar}>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        style={styles.scroller}
        contentContainerStyle={styles.chipRow}
      >
        {reactionBarEmojis(counts, mine).map((emoji) => (
          <ReactionChip
            key={emoji}
            emoji={emoji}
            count={countOf(counts, emoji)}
            picked={mine.includes(emoji)}
            onPress={() => onToggle(emoji)}
          />
        ))}
      </ScrollView>

      <Pressable
        onPress={() => {
          Haptics.selectionAsync();
          openSheet(true);
        }}
        style={styles.moreBtn}
        hitSlop={6}
        accessibilityLabel={t('stories.more_reactions')}
      >
        <Ionicons name="add" size={20} color="#FFF" />
      </Pressable>

      <Modal
        transparent
        visible={sheetOpen}
        animationType="slide"
        onRequestClose={() => openSheet(false)}
      >
        <Pressable style={styles.scrim} onPress={() => openSheet(false)}>
          <Pressable style={styles.sheet} onPress={() => {}}>
            <View style={styles.grabber} />
            <View style={styles.sheetHeader}>
              <Text style={styles.sheetTitle}>{t('stories.reactions')}</Text>
              <Pressable onPress={() => openSheet(false)} hitSlop={10}>
                <Ionicons name="close" size={18} color="#FFF" />
              </Pressable>
            </View>
            {/* The sheet stays open on a tap: picking three emoji should not
                cost three trips through it. */}
            <Text style={styles.sheetHint}>{t('stories.reactions_hint')}</Text>
            <ScrollView contentContainerStyle={styles.grid}>
              {ALL_REACTIONS.map((emoji) => (
                <ReactionChip
                  key={emoji}
                  emoji={emoji}
                  count={countOf(counts, emoji)}
                  picked={mine.includes(emoji)}
                  onPress={() => onToggle(emoji)}
                />
              ))}
            </ScrollView>
          </Pressable>
        </Pressable>
      </Modal>
    </View>
  );
}

function ReactionChip({
  emoji,
  count,
  picked,
  onPress,
}: {
  emoji: string;
  count: number;
  picked: boolean;
  onPress: () => void;
}) {
  const scale = useSharedValue(1);
  const style = useAnimatedStyle(() => ({ transform: [{ scale: scale.value }] }));

  return (
    <Pressable
      onPress={() => {
        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
        scale.value = withSequence(
          withSpring(1.28, { damping: 8, stiffness: 320 }),
          withSpring(1, { damping: 12, stiffness: 220 }),
        );
        onPress();
      }}
      hitSlop={6}
      accessibilityRole="button"
      accessibilityState={{ selected: picked }}
      accessibilityLabel={count > 0 ? `${emoji} ${count}` : emoji}
    >
      <Animated.View
        style={[styles.chip, count > 0 && styles.chipWithCount, picked && styles.chipPicked, style]}
      >
        <Text style={styles.chipEmoji}>{emoji}</Text>
        {count > 0 ? <Text style={styles.chipCount}>{count}</Text> : null}
      </Animated.View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  bar: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  scroller: { flex: 1 },
  chipRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingRight: Spacing.xs,
  },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4,
    minWidth: 40,
    height: 40,
    borderRadius: Radii.pill,
    backgroundColor: 'rgba(255,255,255,0.1)',
    borderWidth: 1.5,
    borderColor: 'transparent',
  },
  chipWithCount: { paddingHorizontal: 10 },
  chipPicked: {
    backgroundColor: 'rgba(255,255,255,0.24)',
    borderColor: '#FFF',
  },
  chipEmoji: { fontSize: 20 },
  chipCount: { ...Typography.micro, color: '#FFF', fontWeight: '700' },
  moreBtn: {
    width: 40,
    height: 40,
    borderRadius: Radii.pill,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(255,255,255,0.14)',
  },
  scrim: {
    flex: 1,
    justifyContent: 'flex-end',
    backgroundColor: 'rgba(0,0,0,0.55)',
  },
  sheet: {
    maxHeight: '62%',
    paddingHorizontal: Spacing.lg,
    paddingBottom: Spacing.xl,
    paddingTop: Spacing.sm,
    borderTopLeftRadius: Radii.xl,
    borderTopRightRadius: Radii.xl,
    backgroundColor: '#14161C',
  },
  grabber: {
    alignSelf: 'center',
    width: 38,
    height: 4,
    borderRadius: Radii.pill,
    backgroundColor: 'rgba(255,255,255,0.28)',
    marginBottom: Spacing.md,
  },
  sheetHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  sheetTitle: { ...Typography.h3, color: '#FFF' },
  sheetHint: {
    ...Typography.caption,
    color: 'rgba(255,255,255,0.6)',
    marginTop: Spacing.xs,
    marginBottom: Spacing.md,
  },
  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: Spacing.sm,
    paddingBottom: Spacing.md,
  },
});
