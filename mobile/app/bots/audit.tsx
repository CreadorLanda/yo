import { Ionicons } from '@expo/vector-icons';
import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { EmptyState } from '@/components/ui/empty-state';
import { Text } from '@/components/ui/text';
import { Radii, Spacing, Typography } from '@/constants/theme';
import { chatBotAudit, type BotAuditEntryDTO } from '@/data/api/bots';
import { useTheme } from '@/hooks/use-theme';
import { getLocale, t } from '@/i18n';

const ICONS: Record<BotAuditEntryDTO['action'], keyof typeof Ionicons.glyphMap> = {
  'bot.added': 'add-circle-outline',
  'bot.removed': 'remove-circle-outline',
  'bot.read_all_on': 'eye-outline',
  'bot.read_all_off': 'eye-off-outline',
  'bot.scopes_changed': 'options-outline',
  'bot.suspended': 'ban-outline',
  'command.run': 'terminal-outline',
};

/**
 * A group's bot activity (#343), for its admins: who added, removed or
 * changed which bot, suspensions, and commands admins ran. Who and when,
 * never what anyone wrote.
 */
export default function BotAuditScreen() {
  const { chatId } = useLocalSearchParams<{ chatId: string }>();
  const { colors } = useTheme();
  const [entries, setEntries] = useState<BotAuditEntryDTO[] | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    if (!chatId) return;
    chatBotAudit(chatId)
      .then((l) => setEntries(l ?? []))
      .catch(() => setFailed(true));
  }, [chatId]);

  const line = (e: BotAuditEntryDTO) =>
    t(`bots.audit_${e.action.replace('.', '_')}`, {
      actor: e.actor_name || t('bots.audit_system'),
      bot: e.bot_name || t('bots.a_bot'),
    });

  return (
    <SafeAreaView style={[styles.screen, { backgroundColor: colors.background }]} edges={['top']}>
      <View style={[styles.header, { borderBottomColor: colors.border }]}>
        <Pressable onPress={() => router.back()} hitSlop={10}>
          <Ionicons name="chevron-back" size={26} color={colors.text} />
        </Pressable>
        <Text style={[styles.title, { color: colors.text }]}>{t('bots.audit_title')}</Text>
      </View>
      <ScrollView contentContainerStyle={styles.body}>
        <Text style={[styles.sub, { color: colors.textSecondary }]}>{t('bots.audit_hint')}</Text>
        {entries === null && !failed ? (
          <ActivityIndicator color={colors.primary} />
        ) : failed ? (
          <EmptyState icon="cloud-offline-outline" title={t('chats.action_failed_title')} description={t('chats.action_failed_body')} />
        ) : entries!.length === 0 ? (
          <EmptyState icon="document-text-outline" title={t('bots.audit_empty')} />
        ) : (
          <View style={[styles.list, { backgroundColor: colors.surface }]}>
            {entries!.map((e, i) => (
              <View
                key={e.id}
                style={[styles.row, i > 0 && { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.divider }]}
              >
                <Ionicons
                  name={ICONS[e.action] ?? 'ellipse-outline'}
                  size={18}
                  color={e.action === 'bot.suspended' || e.action === 'bot.read_all_on' ? colors.warning : colors.textSecondary}
                />
                <View style={{ flex: 1, gap: 2 }}>
                  <Text style={[styles.text, { color: colors.text }]}>{line(e)}</Text>
                  <Text style={[styles.sub, { color: colors.textMuted }]}>
                    {new Date(e.created_at).toLocaleString(getLocale(), {
                      day: 'numeric',
                      month: 'short',
                      hour: '2-digit',
                      minute: '2-digit',
                    })}
                  </Text>
                </View>
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
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  title: { ...Typography.h3 },
  body: { padding: Spacing.lg, gap: Spacing.md },
  list: { borderRadius: Radii.lg, overflow: 'hidden' },
  row: { flexDirection: 'row', alignItems: 'center', gap: Spacing.md, padding: Spacing.md },
  text: { ...Typography.callout },
  sub: { ...Typography.caption },
});
