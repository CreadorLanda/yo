import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Modal,
  Pressable,
  StyleSheet,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ChannelLogo } from '@/components/ui/channel-art';
import { Text } from '@/components/ui/text';
import { Radii, Spacing, Typography } from '@/constants/theme';
import {
  acceptChannelInvite,
  declineChannelInvite,
  listChannelInvites,
  type ChannelRoleInvite,
} from '@/data/api/channels';
import { refreshChannel } from '@/data/channel-store';
import { useTheme } from '@/hooks/use-theme';
import { t } from '@/i18n';

/**
 * Requests to help run a channel.
 *
 * Both choices are equally reachable and neither is pre-selected. A request
 * for a responsibility should not be designed so that the easy path is
 * "yes" — an accept that people fall into is not consent.
 */
export function ChannelInvitesSheet({
  visible,
  onClose,
  onChanged,
}: {
  visible: boolean;
  onClose: () => void;
  /** Fired after any accept or decline, so the caller can refresh its count. */
  onChanged: () => void;
}) {
  const { colors } = useTheme();
  const [invites, setInvites] = useState<ChannelRoleInvite[] | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(() => {
    listChannelInvites()
      .then((list) => setInvites(list ?? []))
      .catch(() => setInvites([]));
  }, []);

  useEffect(() => {
    if (!visible) return;
    setInvites(null);
    load();
  }, [visible, load]);

  const act = (invite: ChannelRoleInvite, accept: boolean) => {
    setBusy(invite.id);
    const run = accept
      ? acceptChannelInvite(invite.id).then(({ channel_id }) => {
          void refreshChannel(channel_id);
          onClose();
          router.push(`/channel/${channel_id}`);
        })
      : declineChannelInvite(invite.id).then(() => load());
    run
      .catch(() => load())
      .finally(() => {
        setBusy(null);
        onChanged();
      });
  };

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onClose}>
      <SafeAreaView style={[styles.safe, { backgroundColor: colors.background }]} edges={['top']}>
        <View style={[styles.header, { borderBottomColor: colors.border }]}>
          <Text style={[styles.title, { color: colors.text }]}>
            {t('channel_invites.title')}
          </Text>
          <Pressable onPress={onClose} hitSlop={10} accessibilityRole="button">
            <Ionicons name="close" size={22} color={colors.textSecondary} />
          </Pressable>
        </View>

        {invites === null ? (
          <View style={styles.center}>
            <ActivityIndicator color={colors.primary} />
          </View>
        ) : invites.length === 0 ? (
          <View style={styles.center}>
            <Ionicons name="mail-open-outline" size={34} color={colors.textMuted} />
            <Text style={[styles.muted, { color: colors.textSecondary }]}>
              {t('channel_invites.empty')}
            </Text>
          </View>
        ) : (
          <FlatList
            data={invites}
            keyExtractor={(i) => i.id}
            contentContainerStyle={styles.list}
            renderItem={({ item }) => (
              <View style={[styles.card, { borderColor: colors.border }]}>
                <View style={styles.cardHead}>
                  <ChannelLogo
                    url={item.channel_avatar}
                    name={item.channel_name}
                    handle={item.channel_handle}
                    size={44}
                  />
                  <View style={{ flex: 1 }}>
                    <Text style={[styles.name, { color: colors.text }]} numberOfLines={1}>
                      {item.channel_name}
                    </Text>
                    <Text style={[styles.handle, { color: colors.textSecondary }]} numberOfLines={1}>
                      @{item.channel_handle}
                    </Text>
                  </View>
                </View>

                <Text style={[styles.body, { color: colors.text }]}>
                  {t(
                    item.role === 'admin'
                      ? 'channel_invites.asks_admin'
                      : 'channel_invites.asks_publisher',
                    { name: item.invited_by_name || `@${item.invited_by_username}` },
                  )}
                </Text>
                <Text style={[styles.consequence, { color: colors.textSecondary }]}>
                  {t(
                    item.role === 'admin'
                      ? 'channel_invites.means_admin'
                      : 'channel_invites.means_publisher',
                  )}
                </Text>

                <View style={styles.actions}>
                  <Pressable
                    onPress={() => act(item, false)}
                    disabled={busy === item.id}
                    style={[styles.btn, { borderColor: colors.border }]}
                  >
                    <Text style={[styles.btnText, { color: colors.textSecondary }]}>
                      {t('channel_invites.decline')}
                    </Text>
                  </Pressable>
                  <Pressable
                    onPress={() => act(item, true)}
                    disabled={busy === item.id}
                    style={[styles.btn, { backgroundColor: colors.primary, borderColor: 'transparent' }]}
                  >
                    <Text style={[styles.btnText, { color: colors.onPrimary }]}>
                      {t('channel_invites.accept')}
                    </Text>
                  </Pressable>
                </View>
              </View>
            )}
          />
        )}
      </SafeAreaView>
    </Modal>
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
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: Spacing.sm },
  muted: { ...Typography.body },
  list: { padding: Spacing.lg, gap: Spacing.md },
  card: {
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: Radii.lg,
    padding: Spacing.md,
    gap: Spacing.sm,
  },
  cardHead: { flexDirection: 'row', alignItems: 'center', gap: Spacing.md },
  name: { ...Typography.bodyStrong },
  handle: { ...Typography.caption, marginTop: 2 },
  body: { ...Typography.body },
  consequence: { ...Typography.caption },
  actions: { flexDirection: 'row', gap: Spacing.sm, marginTop: Spacing.xs },
  btn: {
    flex: 1,
    paddingVertical: Spacing.sm,
    borderRadius: Radii.md,
    borderWidth: StyleSheet.hairlineWidth,
    alignItems: 'center',
  },
  btnText: { ...Typography.bodyStrong },
});
