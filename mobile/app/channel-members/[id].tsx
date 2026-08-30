import { Ionicons } from '@expo/vector-icons';
import { Image } from 'expo-image';
import { router, useLocalSearchParams } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { FlatList, Pressable, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Text, TextInput } from '@/components/ui/text';
import { Radii, Spacing, Typography } from '@/constants/theme';
import { appAlert } from '@/data/dialog-store';
import { ApiError } from '@/data/api/client';
import {
  addChannelMember,
  listChannelMembers,
  removeChannelMember,
  setChannelMemberRole,
  type ChannelMember,
  type ChannelMemberRole,
} from '@/data/api/channels';
import { getCurrentUser } from '@/data/auth-store';
import { useChannel } from '@/data/channel-store';
import { useTheme } from '@/hooks/use-theme';
import { t } from '@/i18n';

/**
 * Who is in a channel, grouped by what they can do.
 *
 * Grouped rather than one long list with role badges: the question people
 * open this screen with is "who runs this", and a badge buried on row 140
 * does not answer it.
 */
type Section = { role: ChannelMemberRole; title: string; data: ChannelMember[] };

export default function ChannelMembersScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { colors, isDark } = useTheme();
  const channel = useChannel(id);
  const me = getCurrentUser()?.id;

  const [members, setMembers] = useState<ChannelMember[] | null>(null);
  const [adding, setAdding] = useState(false);
  const [handle, setHandle] = useState('');
  const [addRole, setAddRole] = useState<Exclude<ChannelMemberRole, 'owner'>>('publisher');
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => {
    if (!id) return;
    listChannelMembers(id)
      .then((list) => setMembers(list ?? []))
      .catch(() => setMembers([]));
  }, [id]);

  useEffect(load, [load]);

  const myRole = members?.find((m) => m.user_id === me)?.role;
  const isOwner = myRole === 'owner';
  const canManage = isOwner || myRole === 'admin';

  const sections = useMemo<Section[]>(() => {
    const list = members ?? [];
    const of = (role: ChannelMemberRole) => list.filter((m) => m.role === role);
    return (
      [
        { role: 'owner' as const, title: t('channel_members.owner'), data: of('owner') },
        { role: 'admin' as const, title: t('channel_members.admins'), data: of('admin') },
        { role: 'publisher' as const, title: t('channel_members.publishers'), data: of('publisher') },
        { role: 'member' as const, title: t('channel_members.followers'), data: of('member') },
      ] as Section[]
    ).filter((s) => s.data.length > 0);
  }, [members]);

  const failed = () =>
    appAlert(t('chats.action_failed_title'), t('chats.action_failed_body'));

  const submitAdd = () => {
    const name = handle.trim().replace(/^@/, '');
    if (!id || !name || busy) return;
    setBusy(true);
    addChannelMember(id, name, addRole)
      .then(() => {
        setHandle('');
        setAdding(false);
        load();
        // A managing role is a request, not a change: saying "added" would
        // promise something that has not happened and may never.
        if (addRole !== 'member') {
          appAlert(t('channel_members.invited'), t('channel_members.invited_body'));
        }
      })
      .catch((err) => {
        // "Not found" covers both an unknown handle and a malformed one —
        // the server refuses to confirm which usernames exist, so the
        // message here says what the person can act on.
        const code = err instanceof ApiError ? err.code : '';
        appAlert(
          t('channel_members.add_failed'),
          code === 'member_not_found'
            ? t('channel_members.unknown_handle')
            : t('chats.action_failed_body'),
        );
      })
      .finally(() => setBusy(false));
  };

  /**
   * Role menu for one person.
   *
   * Which options appear depends on who is asking: an admin may not touch
   * another admin — only the owner may — and showing an action the server
   * will refuse is worse than not showing it.
   */
  const openMenu = (member: ChannelMember) => {
    if (!id || !canManage || member.user_id === me) return;
    if (member.role === 'owner') return;
    if (member.role === 'admin' && !isOwner) return;

    const change = (role: Exclude<ChannelMemberRole, 'owner'>) =>
      setChannelMemberRole(id, member.user_id, role).then(load).catch(failed);

    const options: { text: string; onPress?: () => void; style?: 'destructive' | 'cancel' }[] = [];
    if (member.role !== 'admin' && isOwner) {
      options.push({ text: t('channel_members.make_admin'), onPress: () => void change('admin') });
    }
    if (member.role !== 'publisher') {
      options.push({
        text: t('channel_members.make_publisher'),
        onPress: () => void change('publisher'),
      });
    }
    if (member.role !== 'member') {
      options.push({ text: t('channel_members.make_member'), onPress: () => void change('member') });
    }
    options.push({
      text: t('channel_members.remove'),
      style: 'destructive',
      onPress: () => void removeChannelMember(id, member.user_id).then(load).catch(failed),
    });
    options.push({ text: t('common.cancel'), style: 'cancel' });

    appAlert(member.display_name || member.username, t('channel_members.manage_hint'), options);
  };

  return (
    <SafeAreaView style={[styles.safe, { backgroundColor: colors.background }]} edges={['top']}>
      <StatusBar style={isDark ? 'light' : 'dark'} />

      <View style={[styles.header, { borderBottomColor: colors.border }]}>
        <Pressable onPress={() => router.back()} hitSlop={12} accessibilityRole="button">
          <Ionicons name="chevron-back" size={26} color={colors.text} />
        </Pressable>
        <Text style={[styles.title, { color: colors.text }]} numberOfLines={1}>
          {channel?.name ?? t('channel_members.title')}
        </Text>
        <View style={{ width: 26 }} />
      </View>

      {canManage ? (
        <View style={styles.addBox}>
          {adding ? (
            <>
              <View style={[styles.addField, { backgroundColor: colors.surfaceMuted }]}>
                <Text style={[styles.at, { color: colors.textMuted }]}>@</Text>
                <TextInput
                  value={handle}
                  onChangeText={setHandle}
                  autoFocus
                  autoCapitalize="none"
                  autoCorrect={false}
                  placeholder={t('channel_members.handle_placeholder')}
                  placeholderTextColor={colors.textMuted}
                  onSubmitEditing={submitAdd}
                  style={[styles.addInput, { color: colors.text }]}
                />
                <Pressable onPress={submitAdd} disabled={!handle.trim() || busy} hitSlop={8}>
                  <Ionicons
                    name="arrow-forward-circle"
                    size={26}
                    color={handle.trim() && !busy ? colors.primary : colors.textMuted}
                  />
                </Pressable>
              </View>
              <View style={styles.roleRow}>
                {/* Admin only where the caller may mint one, so the picker
                    cannot offer a choice the server refuses. */}
                {(isOwner
                  ? (['admin', 'publisher', 'member'] as const)
                  : (['publisher', 'member'] as const)
                ).map((r) => (
                  <Pressable
                    key={r}
                    onPress={() => setAddRole(r)}
                    style={[
                      styles.roleChip,
                      {
                        borderColor: addRole === r ? colors.primary : colors.border,
                        backgroundColor: addRole === r ? colors.primary : 'transparent',
                      },
                    ]}
                  >
                    <Text
                      style={[
                        styles.roleChipText,
                        { color: addRole === r ? colors.onPrimary : colors.textSecondary },
                      ]}
                    >
                      {t(`channel_members.role_${r}` as never)}
                    </Text>
                  </Pressable>
                ))}
              </View>
            </>
          ) : (
            <Pressable
              onPress={() => setAdding(true)}
              style={({ pressed }) => [styles.addRow, pressed && { opacity: 0.7 }]}
            >
              <Ionicons name="person-add-outline" size={20} color={colors.primary} />
              <Text style={[styles.addLabel, { color: colors.primary }]}>
                {t('channel_members.add')}
              </Text>
            </Pressable>
          )}
        </View>
      ) : null}

      <FlatList
        data={sections}
        keyExtractor={(s) => s.role}
        contentContainerStyle={styles.list}
        ListEmptyComponent={
          members === null ? null : (
            <Text style={[styles.empty, { color: colors.textSecondary }]}>
              {t('channel_members.empty')}
            </Text>
          )
        }
        renderItem={({ item: section }) => (
          <View>
            <Text style={[styles.sectionTitle, { color: colors.textSecondary }]}>
              {section.title} · {section.data.length}
            </Text>
            {section.data.map((m) => {
              const manageable =
                canManage &&
                m.user_id !== me &&
                m.role !== 'owner' &&
                !(m.role === 'admin' && !isOwner);
              return (
                <Pressable
                  key={m.user_id}
                  onPress={() => openMenu(m)}
                  disabled={!manageable}
                  style={({ pressed }) => [
                    styles.row,
                    pressed && manageable && { backgroundColor: colors.surfaceMuted },
                  ]}
                >
                  <Image
                    source={{ uri: m.avatar_uri ?? '' }}
                    style={[styles.avatar, { backgroundColor: colors.surfaceMuted }]}
                    contentFit="cover"
                  />
                  <View style={{ flex: 1 }}>
                    <Text style={[styles.name, { color: colors.text }]} numberOfLines={1}>
                      {m.display_name || m.username}
                      {m.user_id === me ? ` · ${t('channel_members.you')}` : ''}
                    </Text>
                    <Text style={[styles.handle, { color: colors.textSecondary }]} numberOfLines={1}>
                      @{m.username}
                    </Text>
                  </View>
                  {manageable ? (
                    <Ionicons name="ellipsis-horizontal" size={18} color={colors.textMuted} />
                  ) : null}
                </Pressable>
              );
            })}
          </View>
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
  title: { ...Typography.h3, flex: 1, textAlign: 'center' },
  list: { paddingBottom: Spacing.xl },
  addBox: { paddingHorizontal: Spacing.lg, paddingTop: Spacing.md, gap: Spacing.sm },
  addRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, paddingVertical: Spacing.sm },
  addLabel: { ...Typography.bodyStrong },
  addField: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    borderRadius: Radii.pill,
    paddingHorizontal: Spacing.md,
    height: 44,
  },
  at: { ...Typography.body },
  addInput: { flex: 1, ...Typography.body, padding: 0 },
  roleRow: { flexDirection: 'row', gap: Spacing.xs },
  roleChip: {
    paddingHorizontal: Spacing.md,
    paddingVertical: 6,
    borderRadius: Radii.pill,
    borderWidth: StyleSheet.hairlineWidth,
  },
  roleChipText: { ...Typography.caption, fontWeight: '600' },
  sectionTitle: {
    ...Typography.caption,
    textTransform: 'uppercase',
    paddingHorizontal: Spacing.lg,
    paddingTop: Spacing.lg,
    paddingBottom: Spacing.xs,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.md,
    paddingHorizontal: Spacing.lg,
    paddingVertical: Spacing.sm,
  },
  avatar: { width: 44, height: 44, borderRadius: Radii.pill },
  name: { ...Typography.body },
  handle: { ...Typography.caption, marginTop: 2 },
  empty: { ...Typography.body, textAlign: 'center', paddingTop: Spacing.xl },
});
