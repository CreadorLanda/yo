import { Ionicons } from '@expo/vector-icons';

import { ChannelCover, ChannelLogo } from '@/components/ui/channel-art';
import { router, useLocalSearchParams } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useEffect, useMemo, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Switch, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { formatCount } from '@/components/ui/follow-button';
import { Text } from '@/components/ui/text';
import { Radii, Spacing, Typography } from '@/constants/theme';
import {
  canManage,
  refreshChannel,
  toggleFollow,
  useChannel,
  useIsFollowing,
} from '@/data/channel-store';
import { useTheme } from '@/hooks/use-theme';
import { t } from '@/i18n';

const DESCRIPTION_PREVIEW_LIMIT = 110;

export default function ChannelInfoScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const channel = useChannel(id);
  const { colors, isDark } = useTheme();
  const isFollowing = useIsFollowing(channel?.id ?? id ?? '');
  const manage = canManage(channel);
  const [muted, setMuted] = useState(false);
  const [expanded, setExpanded] = useState(false);

  useEffect(() => {
    if (id) refreshChannel(id).catch(() => {});
  }, [id]);

  if (!channel) {
    return (
      <SafeAreaView style={[styles.safe, { backgroundColor: colors.background }]}>
        <Text style={[styles.fallback, { color: colors.text }]}>{t('channel.not_found')}</Text>
      </SafeAreaView>
    );
  }

  const filesCount = channel.posts.filter((p) => !!p.mediaUri).length;
  const description = channel.description ?? '';
  const needsTruncation = description.length > DESCRIPTION_PREVIEW_LIMIT;
  const visibleDescription =
    !needsTruncation || expanded
      ? description
      : description.slice(0, DESCRIPTION_PREVIEW_LIMIT).trimEnd() + '…';

  const handleFollow = () => {
    if (!channel) return;
    toggleFollow(channel.id);
  };

  return (
    <SafeAreaView
      style={[styles.safe, { backgroundColor: colors.background }]}
      edges={['top', 'bottom']}
    >
      <StatusBar style={isDark ? 'light' : 'dark'} />

      {/* Header */}
      <View style={styles.header}>
        <Pressable
          onPress={() => router.back()}
          hitSlop={12}
          style={({ pressed }) => [
            styles.iconBtn,
            pressed && { backgroundColor: colors.surfaceMuted },
          ]}
        >
          <Ionicons name="chevron-back" size={24} color={colors.text} />
        </Pressable>
        <View style={{ flex: 1 }} />
        {manage ? (
          <Pressable
            hitSlop={12}
            style={styles.iconBtn}
            onPress={() => router.push(`/channel/settings/${channel.id}`)}
            accessibilityLabel={t('channel_settings.title')}
          >
            <Ionicons name="settings-outline" size={22} color={colors.text} />
          </Pressable>
        ) : (
          <Pressable hitSlop={12} style={styles.iconBtn}>
            <Ionicons name="ellipsis-vertical" size={20} color={colors.text} />
          </Pressable>
        )}
      </View>

      <ScrollView
        contentContainerStyle={styles.body}
        showsVerticalScrollIndicator={false}
      >
        {/* Cover + identity */}
        <View style={styles.heroWrap}>
          <ChannelCover
                url={channel.coverUri}
                handle={channel.handle}
            style={styles.cover}
          />
          <View style={styles.coverScrim} />
          <View style={styles.identity}>
            <ChannelLogo
              url={channel.avatarUri}
              name={channel.name}
              handle={channel.handle}
              size={56}
              style={[styles.avatar, { borderColor: colors.background }]}
            />
            <View style={styles.identityNameRow}>
              <Text style={[styles.name, { color: colors.text }]} numberOfLines={2}>
                {channel.name}
              </Text>
              {channel.verified ? (
                <Ionicons name="checkmark-circle" size={20} color={colors.primary} />
              ) : null}
            </View>
            <Text style={[styles.subtitle, { color: colors.textSecondary }]}>
              {t('channel_info.subtitle', { count: formatCount(channel.members) })}
            </Text>
            <Text style={[styles.handleLine, { color: colors.textMuted }]}>
              {channel.handle} · {t(`discover.cat_${channel.category}`)}
            </Text>
          </View>
        </View>

        {/* Action buttons */}
        <View style={styles.actions}>
          {manage ? (
            <ActionButton
              icon="settings-outline"
              label={t('channel_settings.manage')}
              active
              onPress={() => router.push(`/channel/settings/${channel.id}`)}
            />
          ) : (
            <ActionButton
              icon={isFollowing ? 'checkmark' : 'add'}
              label={isFollowing ? t('channel_info.following') : t('channel_info.follow')}
              active={isFollowing}
              onPress={handleFollow}
            />
          )}
          {/* Share is deliberately absent for now: external sharing and deep
              links were dropped, and a button that does nothing is worse than
              one that is not there. */}
          <ActionButton
            icon="search"
            label={t('channel_info.search')}
            onPress={() => {
              if (id) router.push(`/channel/${id}?search=1`);
            }}
          />
        </View>

        {/* Permissions summary for owners / public badge for others */}
        {channel.settings ? (
          <View
            style={[
              styles.permCard,
              { backgroundColor: colors.surface, borderColor: colors.border },
            ]}
          >
            <Text style={[styles.permTitle, { color: colors.textSecondary }]}>
              {t('channel_settings.section_permissions')}
            </Text>
            <PermRow
              icon={channel.settings.visibility === 'public' ? 'globe-outline' : 'lock-closed-outline'}
              label={
                channel.settings.visibility === 'public'
                  ? t('channel_create.vis_public')
                  : t('channel_create.vis_private')
              }
              colors={colors}
            />
            <PermRow
              icon="create-outline"
              label={
                channel.settings.whoCanPost === 'admins'
                  ? t('channel_create.post_admins')
                  : channel.settings.whoCanPost === 'publishers'
                    ? t('channel_create.post_publishers')
                    : t('channel_create.post_everyone')
              }
              colors={colors}
            />
            <PermRow
              icon="chatbubbles-outline"
              label={
                channel.settings.commentsEnabled
                  ? t('channel_create.comments')
                  : t('channel_settings.comments_off')
              }
              colors={colors}
            />
            {manage ? (
              <Pressable
                onPress={() => router.push(`/channel/settings/${channel.id}`)}
                style={[styles.editPerms, { borderColor: colors.primary }]}
              >
                <Ionicons name="shield-checkmark-outline" size={16} color={colors.primary} />
                <Text style={[styles.editPermsText, { color: colors.primary }]}>
                  {t('channel_settings.edit_permissions')}
                </Text>
              </Pressable>
            ) : null}
          </View>
        ) : null}

        {/* Description */}
        {description ? (
          <Pressable
            onPress={() => needsTruncation && setExpanded((e) => !e)}
            style={[styles.descCard, { backgroundColor: colors.surface, borderColor: colors.border }]}
          >
            <Text style={[styles.descText, { color: colors.text }]}>
              {visibleDescription}
              {needsTruncation ? (
                <Text style={[styles.descToggle, { color: colors.primary }]}>
                  {'  '}
                  {expanded ? t('channel_info.read_less') : t('channel_info.read_more')}
                </Text>
              ) : null}
            </Text>
            <Text style={[styles.descMeta, { color: colors.textSecondary }]}>
              {t('channel_info.created_on', { date: '26/09/23' })}
            </Text>
          </Pressable>
        ) : null}

        {/* Management team — only for those who are part of it.
            The list is a channel's staff, not its audience, and the server
            refuses anyone else. Showing the row to a follower would offer a
            door that opens onto an error. */}
        {manage ? (
          <Section colors={colors}>
            <Row
              icon="shield-checkmark-outline"
              label={t('channel_members.title')}
              subtitle={t('channel_members.subtitle')}
              colors={colors}
              onPress={() => {
                if (id) router.push(`/channel-members/${id}`);
              }}
            />
          </Section>
        ) : null}

        {/* Files & links */}
        <Section colors={colors}>
          <Row
            icon="folder-outline"
            label={t('channel_info.files_count', { count: filesCount })}
            colors={colors}
          />
        </Section>

        {/* Notifications */}
        <Section colors={colors}>
          <RowToggle
            icon="notifications-off-outline"
            label={t('channel_info.mute_notifications')}
            value={muted}
            onValueChange={setMuted}
            colors={colors}
          />
        </Section>

        {/* Privacy */}
        <Section colors={colors}>
          <Row
            icon="earth-outline"
            label={t('channel_info.public_channel')}
            subtitle={t('channel_info.public_channel_hint')}
            colors={colors}
          />
          <Divider colors={colors} />
          <Row
            icon="shield-checkmark-outline"
            label={t('channel_info.profile_privacy')}
            subtitle={t('channel_info.profile_privacy_hint')}
            colors={colors}
          />
        </Section>

        {/* Rules */}
        {channel.rules && channel.rules.length > 0 ? (
          <>
            <SectionTitle colors={colors}>{t('channel_info.rules')}</SectionTitle>
            <Section colors={colors}>
              {channel.rules.map((rule, i) => (
                <View key={rule}>
                  {i > 0 ? <Divider colors={colors} /> : null}
                  <View style={styles.row}>
                    <View style={[styles.ruleDot, { backgroundColor: colors.primary }]} />
                    <Text style={[styles.rowLabel, { color: colors.text, flex: 1 }]}>{rule}</Text>
                  </View>
                </View>
              ))}
            </Section>
          </>
        ) : null}

        {/* Report */}
        <Section colors={colors}>
          <Row
            icon="thumbs-down-outline"
            label={t('channel_info.report_channel')}
            colors={colors}
            destructive
          />
        </Section>

        <View style={{ height: Spacing.xl }} />
      </ScrollView>
    </SafeAreaView>
  );
}

// ── Cells (lifted style matches chat-info) ──────────────────────────────────

type Colors = ReturnType<typeof useTheme>['colors'];

function ActionButton({
  icon,
  label,
  active,
  onPress,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  active?: boolean;
  onPress?: () => void;
}) {
  const { colors } = useTheme();
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [
        styles.actionBtn,
        {
          backgroundColor: active ? colors.primary : colors.surface,
          borderColor: active ? colors.primary : colors.border,
        },
        pressed && { opacity: 0.85 },
      ]}
    >
      <Ionicons name={icon} size={20} color={active ? colors.onPrimary : colors.text} />
      <Text
        style={[styles.actionLabel, { color: active ? colors.onPrimary : colors.text }]}
        numberOfLines={1}
      >
        {label}
      </Text>
    </Pressable>
  );
}

function SectionTitle({ children, colors }: { children: React.ReactNode; colors: Colors }) {
  return <Text style={[styles.sectionTitle, { color: colors.textSecondary }]}>{children}</Text>;
}

function Section({ children, colors }: { children: React.ReactNode; colors: Colors }) {
  return (
    <View style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.border }]}>
      {children}
    </View>
  );
}

function Divider({ colors }: { colors: Colors }) {
  return <View style={[styles.divider, { backgroundColor: colors.divider }]} />;
}

function Row({
  icon,
  label,
  subtitle,
  destructive,
  colors,
  onPress,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  subtitle?: string;
  destructive?: boolean;
  colors: Colors;
  /** Rows without one stay flat: no chevron, no press feedback, no promise. */
  onPress?: () => void;
}) {
  const textColor = destructive ? colors.danger : colors.text;
  const content = (
    <>
      <Ionicons name={icon} size={20} color={textColor} />
      <View style={styles.rowText}>
        <Text style={[styles.rowLabel, { color: textColor }]}>{label}</Text>
        {subtitle ? (
          <Text style={[styles.rowSub, { color: colors.textSecondary }]} numberOfLines={4}>
            {subtitle}
          </Text>
        ) : null}
      </View>
      {onPress ? <Ionicons name="chevron-forward" size={18} color={colors.textMuted} /> : null}
    </>
  );

  if (!onPress) return <View style={styles.row}>{content}</View>;
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [styles.row, pressed && { backgroundColor: colors.surfaceMuted }]}
      accessibilityRole="button"
    >
      {content}
    </Pressable>
  );
}

function RowToggle({
  icon,
  label,
  value,
  onValueChange,
  colors,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  value: boolean;
  onValueChange: (v: boolean) => void;
  colors: Colors;
}) {
  return (
    <View style={styles.row}>
      <Ionicons name={icon} size={20} color={colors.text} />
      <Text style={[styles.rowLabel, { color: colors.text, flex: 1 }]}>{label}</Text>
      <Switch
        value={value}
        onValueChange={onValueChange}
        trackColor={{ false: colors.surfaceMuted, true: colors.primary }}
        thumbColor="#FFFFFF"
      />
    </View>
  );
}

function PermRow({
  icon,
  label,
  colors,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  colors: Colors;
}) {
  return (
    <View style={styles.permRow}>
      <Ionicons name={icon} size={16} color={colors.textSecondary} />
      <Text style={[styles.permLabel, { color: colors.text }]}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1 },
  fallback: { ...Typography.body, padding: Spacing.xl },

  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: Spacing.sm,
    paddingVertical: Spacing.sm,
    gap: Spacing.xs,
  },
  iconBtn: {
    width: 36,
    height: 36,
    borderRadius: Radii.pill,
    alignItems: 'center',
    justifyContent: 'center',
  },

  body: {
    paddingHorizontal: Spacing.lg,
    paddingBottom: Spacing.xl,
    gap: Spacing.md,
  },
  heroWrap: { marginHorizontal: -Spacing.lg, marginTop: -Spacing.sm, marginBottom: Spacing.sm },
  cover: { width: '100%', height: 160, backgroundColor: '#1F2937' },
  coverScrim: {
    ...StyleSheet.absoluteFillObject,
    height: 160,
    backgroundColor: 'rgba(11,16,32,0.25)',
  },
  identity: {
    alignItems: 'center',
    paddingHorizontal: Spacing.lg,
    marginTop: -56,
    gap: 4,
  },
  avatar: {
    width: 112,
    height: 112,
    borderRadius: Radii.pill,
    borderWidth: 4,
    backgroundColor: '#1F2937',
  },
  identityNameRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.xs,
    marginTop: Spacing.sm,
  },
  name: { ...Typography.h2, fontSize: 22, textAlign: 'center', maxWidth: '85%' },
  subtitle: { ...Typography.body, textAlign: 'center' },
  handleLine: { ...Typography.caption, textAlign: 'center', marginTop: 2 },

  actions: { flexDirection: 'row', gap: Spacing.sm },
  actionBtn: {
    flex: 1,
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingVertical: Spacing.md,
    borderRadius: Radii.lg,
    borderWidth: 1,
  },
  actionLabel: { ...Typography.micro, fontWeight: '700' },

  descCard: {
    borderRadius: Radii.lg,
    borderWidth: 1,
    padding: Spacing.md,
    gap: Spacing.xs,
  },
  descText: { ...Typography.body, lineHeight: 22 },
  descToggle: { fontWeight: '700' },
  descMeta: { ...Typography.micro, marginTop: 2 },

  sectionTitle: {
    ...Typography.micro,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginTop: Spacing.md,
    marginLeft: Spacing.sm,
  },

  card: { borderRadius: Radii.lg, borderWidth: 1, overflow: 'hidden' },
  divider: { height: StyleSheet.hairlineWidth, marginLeft: Spacing.lg + 24 + Spacing.sm },

  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.md,
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm + 4,
    minHeight: 56,
  },
  rowText: { flex: 1, gap: 2 },
  rowLabel: { ...Typography.body, fontSize: 15 },
  rowSub: { ...Typography.caption, lineHeight: 18 },
  ruleDot: { width: 6, height: 6, borderRadius: Radii.pill, marginLeft: 4 },
  permCard: {
    borderRadius: Radii.lg,
    borderWidth: 1,
    padding: Spacing.md,
    gap: Spacing.sm,
  },
  permTitle: {
    ...Typography.micro,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 0.6,
  },
  permRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm },
  permLabel: { ...Typography.caption, flex: 1 },
  editPerms: {
    marginTop: Spacing.xs,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing.sm,
    paddingVertical: Spacing.sm,
    borderRadius: Radii.pill,
    borderWidth: 1.5,
  },
  editPermsText: { ...Typography.caption, fontWeight: '700' },
});
