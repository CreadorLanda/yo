import { Ionicons } from '@expo/vector-icons';
import { router, useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { BotBadge } from '@/components/bots/bot-badge';
import { Avatar } from '@/components/ui/avatar';
import { Text } from '@/components/ui/text';
import { Radii, Spacing, Typography } from '@/constants/theme';
import { askBotToForgetMe, listChatBots, uninstallBot, updateBotScopes, type BotInstallationDTO } from '@/data/api/bots';
import { canModerate, hasFullRead, scopesFor } from '@/data/bot-policy';
import { invalidateChatBots } from '@/data/bot-store';
import { appAlert } from '@/data/dialog-store';
import { refreshGroup } from '@/data/group-store';
import { showToast } from '@/data/toast-store';
import { useTheme } from '@/hooks/use-theme';
import { t } from '@/i18n';

/**
 * The bots in a group (#326): who they are and what they may read. Admins
 * add one, let it read everything or only what is addressed to it, or remove
 * it. Every change is also announced in the group by the server.
 */
export function ChatBotsSection({ chatId, isAdmin }: { chatId: string; isAdmin: boolean }) {
  const { colors } = useTheme();
  const [bots, setBots] = useState<BotInstallationDTO[]>([]);

  const load = useCallback(() => {
    listChatBots(chatId)
      .then((list) => setBots(list ?? []))
      .catch(() => {});
  }, [chatId]);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load]),
  );

  const changed = () => {
    invalidateChatBots(chatId);
    void refreshGroup(chatId).catch(() => {});
    load();
  };

  const fail = () => appAlert(t('chats.action_failed_title'), t('chats.action_failed_body'));

  // Anyone here can ask a bot to delete what it holds about them (#343).
  const forgetMe = (inst: BotInstallationDTO) =>
    appAlert(t('bots.forget_title', { name: inst.bot.display_name }), t('bots.forget_body'), [
      { text: t('common.cancel'), style: 'cancel' },
      {
        text: t('bots.forget_action'),
        onPress: () =>
          void askBotToForgetMe(inst.bot.id)
            .then(() => showToast(t('bots.forget_sent'), 'success'))
            .catch(fail),
      },
    ]);

  const manage = (inst: BotInstallationDTO) => {
    const full = hasFullRead(inst.scopes);
    const mod = canModerate(inst.scopes);
    appAlert(inst.bot.display_name, full ? t('bots.reads_all') : t('bots.reads_addressed'), [
      {
        text: full ? t('bots.make_private') : t('bots.allow_read_all'),
        onPress: () => {
          const apply = () =>
            updateBotScopes(chatId, inst.bot.id, scopesFor({ readAll: !full, moderate: mod })).then(changed).catch(fail);
          if (full) {
            void apply();
            return;
          }
          appAlert(t('bots.allow_read_all_title', { name: inst.bot.display_name }), t('bots.allow_read_all_body'), [
            { text: t('common.cancel'), style: 'cancel' },
            { text: t('bots.allow_read_all'), onPress: () => void apply() },
          ]);
        },
      },
      {
        text: mod ? t('bots.stop_moderating') : t('bots.allow_moderate'),
        onPress: () => {
          const apply = () =>
            updateBotScopes(chatId, inst.bot.id, scopesFor({ readAll: full, moderate: !mod })).then(changed).catch(fail);
          if (mod) {
            void apply();
            return;
          }
          appAlert(t('bots.allow_moderate_title', { name: inst.bot.display_name }), t('bots.allow_moderate_body'), [
            { text: t('common.cancel'), style: 'cancel' },
            { text: t('bots.allow_moderate'), onPress: () => void apply() },
          ]);
        },
      },
      { text: t('bots.forget_action'), onPress: () => forgetMe(inst) },
      {
        text: t('bots.remove_from_group'),
        style: 'destructive',
        onPress: () =>
          appAlert(t('bots.remove_title', { name: inst.bot.display_name }), t('bots.remove_body'), [
            { text: t('common.cancel'), style: 'cancel' },
            {
              text: t('bots.remove_from_group'),
              style: 'destructive',
              onPress: () => void uninstallBot(chatId, inst.bot.id).then(changed).catch(fail),
            },
          ]),
      },
      { text: t('common.cancel'), style: 'cancel' },
    ]);
  };

  if (bots.length === 0 && !isAdmin) return null;

  return (
    <View style={styles.wrap}>
      <Text style={[styles.title, { color: colors.textSecondary }]}>{t('bots.section_in_group')}</Text>
      <View style={[styles.card, { backgroundColor: colors.surface }]}>
        {isAdmin ? (
          <Pressable
            onPress={() => router.push({ pathname: '/bots/add', params: { chatId } })}
            style={({ pressed }) => [styles.row, pressed && { backgroundColor: colors.surfaceMuted }]}
            accessibilityRole="button"
          >
            <View style={[styles.addIcon, { backgroundColor: colors.surfaceMuted }]}>
              <Ionicons name="add" size={20} color={colors.primary} />
            </View>
            <Text style={[styles.label, { color: colors.primary }]}>{t('bots.add_bot')}</Text>
          </Pressable>
        ) : null}
        {isAdmin ? (
          <Pressable
            onPress={() => router.push({ pathname: '/bots/audit', params: { chatId } })}
            style={({ pressed }) => [
              styles.row,
              { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.divider },
              pressed && { backgroundColor: colors.surfaceMuted },
            ]}
            accessibilityRole="button"
          >
            <View style={[styles.addIcon, { backgroundColor: colors.surfaceMuted }]}>
              <Ionicons name="document-text-outline" size={18} color={colors.textSecondary} />
            </View>
            <Text style={[styles.label, { color: colors.text }]}>{t('bots.audit_title')}</Text>
          </Pressable>
        ) : null}
        {bots.map((inst, i) => {
          const full = hasFullRead(inst.scopes);
          const mod = canModerate(inst.scopes);
          return (
            <Pressable
              key={inst.bot.id}
              onPress={() => (isAdmin ? manage(inst) : forgetMe(inst))}
              style={({ pressed }) => [
                styles.row,
                (isAdmin || i > 0) && { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.divider },
                pressed && { backgroundColor: colors.surfaceMuted },
              ]}
            >
              <Avatar uri={inst.bot.avatar_url} id={inst.bot.id} username={inst.bot.username} size={36} />
              <View style={{ flex: 1, gap: 2 }}>
                <View style={styles.nameRow}>
                  <Text style={[styles.label, { color: colors.text, flexShrink: 1 }]} numberOfLines={1}>
                    {inst.bot.display_name}
                  </Text>
                  <BotBadge />
                </View>
                <View style={styles.nameRow}>
                  <Ionicons
                    name={full ? 'eye-outline' : 'lock-closed-outline'}
                    size={12}
                    color={full ? colors.warning : colors.textSecondary}
                  />
                  <Text style={[styles.sub, { color: colors.textSecondary }]} numberOfLines={1}>
                    {full ? t('bots.reads_all') : t('bots.reads_addressed')}
                  </Text>
                </View>
                {mod ? (
                  <View style={styles.nameRow}>
                    <Ionicons name="shield-outline" size={12} color={colors.warning} />
                    <Text style={[styles.sub, { color: colors.textSecondary }]} numberOfLines={1}>
                      {t('bots.moderates')}
                    </Text>
                  </View>
                ) : null}
              </View>
              <Ionicons name="ellipsis-vertical" size={18} color={colors.textSecondary} />
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: Spacing.sm },
  title: { ...Typography.label, textTransform: 'uppercase', paddingHorizontal: Spacing.xs },
  card: { borderRadius: Radii.lg, overflow: 'hidden' },
  row: { flexDirection: 'row', alignItems: 'center', gap: Spacing.md, padding: Spacing.md },
  addIcon: { width: 36, height: 36, borderRadius: Radii.pill, alignItems: 'center', justifyContent: 'center' },
  nameRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.xs },
  label: { ...Typography.bodyStrong },
  sub: { ...Typography.caption },
});
