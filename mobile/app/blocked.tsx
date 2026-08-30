import { Ionicons } from '@expo/vector-icons';
import { Image } from 'expo-image';
import { router } from 'expo-router';
import { useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Text } from '@/components/ui/text';
import { Radii, Spacing, Typography } from '@/constants/theme';
import { refreshBlocks, unblock, useBlocked } from '@/data/block-store';
import { appAlert } from '@/data/dialog-store';
import { useTheme } from '@/hooks/use-theme';
import { t } from '@/i18n';

/**
 * Who you have blocked, and the way back.
 *
 * There was no way back. Blocking set a status on the conversation and no
 * unblock existed anywhere in the codebase — no route, no service method, no
 * button — so blocking someone by mistake was permanent.
 *
 * The list is also the only place the rule is stated: a block stops one-to-one
 * messages and calls, and deliberately does not reach groups or lives.
 */
export default function BlockedScreen() {
  const { colors } = useTheme();
  const blocked = useBlocked();
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    refreshBlocks().finally(() => setLoading(false));
  }, []);

  const confirmUnblock = (userId: string, name: string) =>
    appAlert(t('blocked.unblock_title', { name }), t('blocked.unblock_body'), [
      { text: t('common.cancel'), style: 'cancel' },
      {
        text: t('blocked.unblock_action'),
        onPress: () => {
          unblock(userId).catch(() =>
            appAlert(t('chats.action_failed_title'), t('chats.action_failed_body')),
          );
        },
      },
    ]);

  return (
    <SafeAreaView style={[styles.screen, { backgroundColor: colors.background }]} edges={['top']}>
      <View style={[styles.header, { borderBottomColor: colors.border }]}>
        <Pressable onPress={() => router.back()} hitSlop={10}>
          <Ionicons name="chevron-back" size={26} color={colors.text} />
        </Pressable>
        <Text style={[styles.title, { color: colors.text }]}>{t('blocked.title')}</Text>
      </View>

      <ScrollView contentContainerStyle={styles.body}>
        <Text style={[styles.explain, { color: colors.textSecondary }]}>
          {t('blocked.explain')}
        </Text>

        {loading ? (
          <ActivityIndicator color={colors.primary} style={{ marginTop: Spacing.xl }} />
        ) : blocked.length === 0 ? (
          <View style={styles.empty}>
            <Ionicons name="shield-checkmark-outline" size={40} color={colors.textMuted} />
            <Text style={[styles.emptyText, { color: colors.textSecondary }]}>
              {t('blocked.empty')}
            </Text>
          </View>
        ) : (
          <View style={[styles.list, { backgroundColor: colors.surface, borderColor: colors.border }]}>
            {blocked.map((b, i) => (
              <View
                key={b.user_id}
                style={[
                  styles.row,
                  i < blocked.length - 1 && { borderBottomWidth: 1, borderBottomColor: colors.border },
                ]}
              >
                {b.avatar_uri ? (
                  <Image source={{ uri: b.avatar_uri }} style={styles.avatar} contentFit="cover" />
                ) : (
                  <View style={[styles.avatar, { backgroundColor: colors.surfaceMuted }]}>
                    <Ionicons name="person" size={18} color={colors.textMuted} />
                  </View>
                )}
                <View style={{ flex: 1 }}>
                  <Text style={[styles.name, { color: colors.text }]} numberOfLines={1}>
                    {b.display_name || b.username}
                  </Text>
                  <Text style={[styles.handle, { color: colors.textSecondary }]} numberOfLines={1}>
                    @{b.username}
                  </Text>
                </View>
                <Pressable
                  onPress={() => confirmUnblock(b.user_id, b.display_name || b.username)}
                  style={[styles.unblockBtn, { borderColor: colors.border }]}
                >
                  <Text style={[styles.unblockText, { color: colors.primary }]}>
                    {t('blocked.unblock_action')}
                  </Text>
                </Pressable>
              </View>
            ))}
          </View>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.md,
    paddingHorizontal: Spacing.lg,
    paddingVertical: Spacing.md,
    borderBottomWidth: 1,
  },
  title: { ...Typography.h3 },
  body: { padding: Spacing.lg, gap: Spacing.lg },
  explain: { ...Typography.caption },
  list: { borderRadius: Radii.lg, borderWidth: 1, overflow: 'hidden' },
  row: { flexDirection: 'row', alignItems: 'center', gap: Spacing.md, padding: Spacing.md },
  avatar: { width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center' },
  name: { ...Typography.bodyStrong },
  handle: { ...Typography.caption },
  unblockBtn: {
    paddingHorizontal: Spacing.md,
    paddingVertical: 6,
    borderRadius: Radii.pill,
    borderWidth: 1,
  },
  unblockText: { ...Typography.caption, fontWeight: '600' },
  empty: { alignItems: 'center', gap: Spacing.md, marginTop: Spacing.xl },
  emptyText: { ...Typography.body, textAlign: 'center' },
});
