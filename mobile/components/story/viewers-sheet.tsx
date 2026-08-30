import { Ionicons } from '@expo/vector-icons';
import { Image } from 'expo-image';
import { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Modal,
  Pressable,
  StyleSheet,
  View,
} from 'react-native';

import { Text } from '@/components/ui/text';
import { Radii, Spacing, Typography } from '@/constants/theme';
import { storyViewers, type StoryViewer } from '@/data/api/stories';
import { t } from '@/i18n';

/**
 * Who has seen a story.
 *
 * Deliberately dark and self-contained rather than theme-aware: it opens on
 * top of the story viewer, which is always dark, and a light sheet over a
 * photo is a flash in the face at whatever hour people watch these.
 */
export function ViewersSheet({
  visible,
  storyId,
  totalViewers,
  onClose,
}: {
  visible: boolean;
  storyId: string;
  totalViewers: number;
  onClose: () => void;
}) {
  const [viewers, setViewers] = useState<StoryViewer[] | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    if (!visible) return;
    let cancelled = false;
    setViewers(null);
    setFailed(false);
    storyViewers(storyId)
      .then((list) => {
        if (!cancelled) setViewers(list ?? []);
      })
      .catch(() => {
        if (!cancelled) setFailed(true);
      });
    return () => {
      cancelled = true;
    };
  }, [visible, storyId]);

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <Pressable style={styles.scrim} onPress={onClose}>
        <Pressable style={styles.sheet} onPress={() => {}}>
          <View style={styles.grabber} />

          <View style={styles.header}>
            <Ionicons name="eye-outline" size={18} color="#FFFFFF" />
            <Text style={styles.title}>
              {t('stories.views', { count: viewers?.length ?? totalViewers })}
            </Text>
          </View>

          {viewers === null && !failed ? (
            <View style={styles.center}>
              <ActivityIndicator color="#FFFFFF" />
            </View>
          ) : failed ? (
            <View style={styles.center}>
              <Text style={styles.muted}>{t('stories.viewers_failed')}</Text>
            </View>
          ) : (viewers?.length ?? 0) === 0 ? (
            <View style={styles.center}>
              <Ionicons name="eye-off-outline" size={32} color="rgba(255,255,255,0.35)" />
              <Text style={styles.muted}>{t('stories.viewers_empty')}</Text>
            </View>
          ) : (
            <FlatList
              data={viewers}
              keyExtractor={(v) => v.user_id}
              contentContainerStyle={styles.list}
              renderItem={({ item }) => {
                // Every emoji they left, not just the first: with several
                // allowed, showing one hides the rest from the only person
                // who can see this list. `emojis` is absent on a server that
                // predates them, so fall back to `emoji`.
                const left = item.emojis ?? (item.emoji ? [item.emoji] : []);
                return (
                  <View style={styles.row}>
                    <Image
                      source={{ uri: item.avatar_uri ?? '' }}
                      style={styles.avatar}
                      contentFit="cover"
                    />
                    <View style={{ flex: 1 }}>
                      <Text style={styles.name} numberOfLines={1}>
                        {item.display_name || item.username}
                      </Text>
                      <Text style={styles.handle} numberOfLines={1}>
                        @{item.username}
                      </Text>
                    </View>
                    {left.length > 0 ? (
                      <Text style={styles.emoji} numberOfLines={1}>
                        {left.join(' ')}
                      </Text>
                    ) : null}
                  </View>
                );
              }}
            />
          )}
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const styles = StyleSheet.create({
  scrim: { flex: 1, backgroundColor: 'rgba(0,0,0,0.55)', justifyContent: 'flex-end' },
  sheet: {
    backgroundColor: '#14161C',
    borderTopLeftRadius: Radii.xl,
    borderTopRightRadius: Radii.xl,
    paddingTop: Spacing.sm,
    paddingBottom: Spacing.xl,
    maxHeight: '70%',
    minHeight: 220,
  },
  grabber: {
    width: 40,
    height: 4,
    borderRadius: 2,
    backgroundColor: 'rgba(255,255,255,0.25)',
    alignSelf: 'center',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
    paddingHorizontal: Spacing.lg,
    paddingVertical: Spacing.md,
  },
  title: { ...Typography.bodyStrong, color: '#FFFFFF' },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: Spacing.sm, padding: Spacing.xl },
  muted: { ...Typography.body, color: 'rgba(255,255,255,0.55)', textAlign: 'center' },
  list: { paddingHorizontal: Spacing.lg, paddingBottom: Spacing.md },
  row: { flexDirection: 'row', alignItems: 'center', gap: Spacing.md, paddingVertical: Spacing.sm },
  avatar: { width: 44, height: 44, borderRadius: Radii.pill, backgroundColor: 'rgba(255,255,255,0.08)' },
  name: { ...Typography.body, color: '#FFFFFF' },
  handle: { ...Typography.caption, color: 'rgba(255,255,255,0.5)' },
  emoji: { fontSize: 22 },
});
