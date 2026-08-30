import { Ionicons } from '@expo/vector-icons';
import { Image } from 'expo-image';
import { router } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useEffect, useState } from 'react';
import { FlatList, Pressable, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Text } from '@/components/ui/text';
import { Radii, Spacing, Typography } from '@/constants/theme';
import { appAlert } from '@/data/dialog-store';
import type { ChatDTO } from '@/data/api/messages';
import { useRevealedChats } from '@/data/chat-lock';
import { useLockedChatIds } from '@/data/chat-prefs';
import { refreshChats, setChatSettings, useArchivedChats } from '@/data/chat-store';
import { useTheme } from '@/hooks/use-theme';
import { t } from '@/i18n';

/**
 * Archived conversations.
 *
 * The store has fetched and exposed these from the beginning, but nothing
 * rendered them — archiving worked, the row vanished from the list, and
 * there was nowhere to go and find it. Unarchiving was unreachable, which
 * made "archive" behave like a delete the user had not agreed to.
 */
export default function ArchivedScreen() {
  const { colors, isDark } = useTheme();
  const all = useArchivedChats();
  const lockedIds = useLockedChatIds();
  const revealed = useRevealedChats();
  // A locked chat that is also archived must stay hidden here as well.
  // Every screen that lists conversations is a way past the lock, and this
  // one arrived after the lock did.
  const archived = all.filter((c) => !lockedIds.has(c.id) || revealed.has(c.id));
  const [busy, setBusy] = useState<string | null>(null);

  useEffect(() => {
    void refreshChats({ archived: true });
  }, []);

  const unarchive = async (chat: ChatDTO) => {
    setBusy(chat.id);
    try {
      await setChatSettings(chat.id, { archived: false });
      // Both lists changed: the row left this one and rejoined the main one.
      await refreshChats({ archived: true });
      await refreshChats();
    } catch {
      appAlert(t('chats.action_failed_title'), t('chats.action_failed_body'));
    } finally {
      setBusy(null);
    }
  };

  return (
    <SafeAreaView style={[styles.safe, { backgroundColor: colors.background }]} edges={['top']}>
      <StatusBar style={isDark ? 'light' : 'dark'} />

      <View style={[styles.header, { borderBottomColor: colors.border }]}>
        <Pressable
          onPress={() => router.back()}
          hitSlop={12}
          accessibilityRole="button"
          accessibilityLabel={t('common.back')}
        >
          <Ionicons name="chevron-back" size={26} color={colors.text} />
        </Pressable>
        <Text style={[styles.title, { color: colors.text }]}>{t('chats.archived')}</Text>
        <View style={{ width: 26 }} />
      </View>

      <FlatList
        data={archived}
        keyExtractor={(c) => c.id}
        contentContainerStyle={archived.length === 0 ? styles.emptyWrap : undefined}
        ItemSeparatorComponent={() => (
          <View style={[styles.separator, { backgroundColor: colors.divider }]} />
        )}
        ListEmptyComponent={
          <View style={styles.empty}>
            <Ionicons name="archive-outline" size={40} color={colors.textMuted} />
            <Text style={[styles.emptyTitle, { color: colors.text }]}>
              {t('chats.archived_empty')}
            </Text>
            <Text style={[styles.emptyHint, { color: colors.textSecondary }]}>
              {t('chats.archived_empty_hint')}
            </Text>
          </View>
        }
        renderItem={({ item }) => (
          <Pressable
            onPress={() => router.push(`/chat/${item.id}`)}
            style={({ pressed }) => [
              styles.row,
              pressed && { backgroundColor: colors.surfaceMuted },
            ]}
          >
            <Image
              source={{ uri: item.avatar_url ?? '' }}
              style={[styles.avatar, { backgroundColor: colors.surfaceMuted }]}
              contentFit="cover"
            />
            <View style={{ flex: 1 }}>
              <Text style={[styles.name, { color: colors.text }]} numberOfLines={1}>
                {item.title ?? item.peer_username ?? t('chats.unknown')}
              </Text>
              <Text style={[styles.sub, { color: colors.textSecondary }]} numberOfLines={1}>
                {item.last_message ? '…' : t('chats.no_messages')}
              </Text>
            </View>
            <Pressable
              onPress={() => void unarchive(item)}
              disabled={busy === item.id}
              hitSlop={10}
              style={[styles.action, { borderColor: colors.border }]}
              accessibilityRole="button"
              accessibilityLabel={t('chats.unarchive')}
            >
              <Text style={[styles.actionText, { color: colors.primary }]}>
                {t('chats.unarchive')}
              </Text>
            </Pressable>
          </Pressable>
        )}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1 },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: Spacing.lg,
    paddingVertical: Spacing.md,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  title: { ...Typography.h3 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.md,
    paddingHorizontal: Spacing.lg,
    paddingVertical: Spacing.md,
  },
  avatar: { width: 48, height: 48, borderRadius: Radii.pill },
  name: { ...Typography.bodyStrong },
  sub: { ...Typography.caption, marginTop: 2 },
  action: {
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.xs,
    borderRadius: Radii.pill,
    borderWidth: StyleSheet.hairlineWidth,
  },
  actionText: { ...Typography.bodyStrong },
  separator: { height: StyleSheet.hairlineWidth, marginLeft: 76 },
  emptyWrap: { flexGrow: 1, justifyContent: 'center' },
  empty: { alignItems: 'center', gap: Spacing.sm, paddingHorizontal: Spacing.xl },
  emptyTitle: { ...Typography.bodyStrong, marginTop: Spacing.sm },
  emptyHint: { ...Typography.caption, textAlign: 'center' },
});
