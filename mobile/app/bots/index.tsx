import { Ionicons } from '@expo/vector-icons';
import { router, useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Avatar } from '@/components/ui/avatar';
import { EmptyState } from '@/components/ui/empty-state';
import { PrimaryButton } from '@/components/ui/primary-button';
import { Text } from '@/components/ui/text';
import { Radii, Spacing, Typography } from '@/constants/theme';
import { listMyBots, type BotDTO } from '@/data/api/bots';
import { useTheme } from '@/hooks/use-theme';
import { t } from '@/i18n';

/** Settings → My bots (#328): the bots you own, and the way to make one. */
export default function MyBotsScreen() {
  const { colors } = useTheme();
  const [bots, setBots] = useState<BotDTO[] | null>(null);
  const [failed, setFailed] = useState(false);

  // Refetched on focus: coming back from making or deleting one.
  useFocusEffect(
    useCallback(() => {
      let live = true;
      listMyBots()
        .then((list) => {
          if (live) {
            setBots(list ?? []);
            setFailed(false);
          }
        })
        .catch(() => {
          if (live) setFailed(true);
        });
      return () => {
        live = false;
      };
    }, []),
  );

  return (
    <SafeAreaView style={[styles.screen, { backgroundColor: colors.background }]} edges={['top', 'bottom']}>
      <View style={[styles.header, { borderBottomColor: colors.border }]}>
        <Pressable onPress={() => router.back()} hitSlop={10}>
          <Ionicons name="chevron-back" size={26} color={colors.text} />
        </Pressable>
        <Text style={[styles.title, { color: colors.text }]}>{t('bots.my_bots')}</Text>
      </View>

      <ScrollView contentContainerStyle={styles.body}>
        {bots === null && !failed ? (
          <ActivityIndicator color={colors.primary} style={{ marginTop: Spacing.xl }} />
        ) : failed ? (
          <EmptyState icon="cloud-offline-outline" title={t('chats.action_failed_title')} description={t('chats.action_failed_body')} />
        ) : bots && bots.length === 0 ? (
          <EmptyState icon="hardware-chip-outline" title={t('bots.empty_title')} description={t('bots.empty_body')} />
        ) : (
          <View style={[styles.list, { backgroundColor: colors.surface, borderColor: colors.border }]}>
            {bots!.map((b, i) => (
              <Pressable
                key={b.id}
                onPress={() => router.push({ pathname: '/bots/[id]', params: { id: b.id } })}
                style={({ pressed }) => [
                  styles.row,
                  i < bots!.length - 1 && { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border },
                  pressed && { backgroundColor: colors.surfaceMuted },
                ]}
                accessibilityRole="button"
              >
                <Avatar uri={b.avatar_url} id={b.id} username={b.username} size={44} />
                <View style={{ flex: 1 }}>
                  <Text style={[styles.name, { color: colors.text }]} numberOfLines={1}>
                    {b.display_name}
                  </Text>
                  <Text style={[styles.handle, { color: colors.textSecondary }]} numberOfLines={1}>
                    @{b.username}
                  </Text>
                </View>
                <Ionicons name="chevron-forward" size={18} color={colors.textMuted} />
              </Pressable>
            ))}
          </View>
        )}
      </ScrollView>

      <View style={styles.footer}>
        <PrimaryButton label={t('bots.create_new')} onPress={() => router.push('/bots/create')} />
      </View>
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
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  title: { ...Typography.h3 },
  body: { padding: Spacing.lg, gap: Spacing.lg },
  list: { borderWidth: StyleSheet.hairlineWidth, borderRadius: Radii.lg, overflow: 'hidden' },
  row: { flexDirection: 'row', alignItems: 'center', gap: Spacing.md, padding: Spacing.md },
  name: { ...Typography.bodyStrong },
  handle: { ...Typography.caption },
  footer: { padding: Spacing.lg },
});
