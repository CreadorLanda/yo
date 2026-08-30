import { Ionicons } from '@expo/vector-icons';
import { Image } from 'expo-image';
import { router, useLocalSearchParams } from 'expo-router';
import type { ReactNode } from 'react';
import { Pressable, ScrollView, StyleSheet, Switch, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Text } from '@/components/ui/text';
import { Radii, Spacing, Typography } from '@/constants/theme';
import { updateGroup, useGroup } from '@/data/group-store';
import { HISTORY_LIMITS, type GroupMember } from '@/data/mock';
import { useTheme } from '@/hooks/use-theme';
import { t } from '@/i18n';

export default function GroupSettingsModal() {
  const { groupId } = useLocalSearchParams<{ groupId?: string }>();
  const group = useGroup(groupId);
  const { colors } = useTheme();

  if (!group) {
    return (
      <SafeAreaView style={[styles.safe, { backgroundColor: colors.background }]}>
        <Text style={[styles.fallback, { color: colors.text }]}>{t('chat.not_found')}</Text>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={[styles.safe, { backgroundColor: colors.background }]} edges={['top']}>
      <View style={[styles.header, { borderBottomColor: colors.divider }]}>
        <Text style={[styles.headerTitle, { color: colors.text }]}>{t('group.settings_title')}</Text>
        <Pressable onPress={() => router.back()} hitSlop={10} accessibilityRole="button">
          <Text style={[styles.done, { color: colors.primary }]}>{t('group.done')}</Text>
        </Pressable>
      </View>

      <ScrollView contentContainerStyle={styles.body} showsVerticalScrollIndicator={false}>
        <View style={styles.identity}>
          <Image
            source={{ uri: group.avatarUri }}
            style={[styles.groupAvatar, { backgroundColor: colors.surfaceMuted }]}
            contentFit="cover"
          />
          <Text style={[styles.groupName, { color: colors.text }]}>{group.name}</Text>
          <Text style={[styles.groupMeta, { color: colors.textSecondary }]}>
            {t('group.members_count', { count: group.members.length })}
          </Text>
        </View>

        <Section title={t('group.history_section')}>
          <View style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.border }]}>
            <View style={styles.toggleRow}>
              <Text style={[styles.toggleLabel, { color: colors.text }]}>
                {t('group.history_toggle')}
              </Text>
              <Switch
                value={group.historyEnabled}
                onValueChange={(v) => updateGroup(group.id, { historyEnabled: v })}
                trackColor={{ false: colors.border, true: colors.primary }}
                thumbColor={colors.surface}
              />
            </View>
            <Text style={[styles.hint, { color: colors.textSecondary }]}>
              {group.historyEnabled ? t('group.history_hint_on') : t('group.history_hint_off')}
            </Text>
          </View>
        </Section>

        {group.historyEnabled ? (
          <>
            <Section title={t('group.access_section')}>
              <View style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.border }]}>
                <View style={[styles.segment, { backgroundColor: colors.surfaceMuted }]}>
                  {(['view-only', 'full'] as const).map((mode) => {
                    const active = group.historyMode === mode;
                    return (
                      <Pressable
                        key={mode}
                        onPress={() => updateGroup(group.id, { historyMode: mode })}
                        style={[styles.segmentItem, active && { backgroundColor: colors.surface }]}
                        accessibilityRole="button"
                        accessibilityState={{ selected: active }}
                      >
                        <Text
                          style={[
                            styles.segmentText,
                            { color: active ? colors.text : colors.textSecondary },
                          ]}
                        >
                          {mode === 'view-only' ? t('group.mode_view_only') : t('group.mode_full')}
                        </Text>
                      </Pressable>
                    );
                  })}
                </View>
                <Text style={[styles.hint, { color: colors.textSecondary }]}>
                  {group.historyMode === 'view-only'
                    ? t('group.mode_hint_view_only')
                    : t('group.mode_hint_full')}
                </Text>
              </View>
            </Section>

            <Section title={t('group.limit_section')}>
              <View style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.border }]}>
                <View style={styles.chips}>
                  {HISTORY_LIMITS.map((limit) => {
                    const active = group.historyLimit === limit;
                    return (
                      <Pressable
                        key={String(limit)}
                        onPress={() => updateGroup(group.id, { historyLimit: limit })}
                        style={[
                          styles.chip,
                          { borderColor: colors.border },
                          active && { backgroundColor: colors.primary, borderColor: colors.primary },
                        ]}
                        accessibilityRole="button"
                        accessibilityState={{ selected: active }}
                      >
                        <Text
                          style={[
                            styles.chipText,
                            { color: active ? colors.onPrimary : colors.text },
                          ]}
                        >
                          {limit === Infinity ? t('group.limit_all') : limit}
                        </Text>
                      </Pressable>
                    );
                  })}
                </View>
                <Text style={[styles.hint, { color: colors.textSecondary }]}>
                  {t('group.limit_hint')}
                </Text>
              </View>
            </Section>
          </>
        ) : null}

        <Section title={t('group.members_section')}>
          <View style={[styles.card, styles.cardFlush, { backgroundColor: colors.surface, borderColor: colors.border }]}>
            {group.members.map((member, i) => (
              <MemberRow key={member.id} member={member} divider={i > 0} />
            ))}
          </View>
        </Section>
      </ScrollView>
    </SafeAreaView>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  const { colors } = useTheme();
  return (
    <View style={styles.section}>
      <Text style={[styles.sectionTitle, { color: colors.textSecondary }]}>{title}</Text>
      {children}
    </View>
  );
}

function MemberRow({ member, divider }: { member: GroupMember; divider: boolean }) {
  const { colors } = useTheme();
  return (
    <View style={[styles.memberRow, divider && { borderTopWidth: 1, borderTopColor: colors.divider }]}>
      <Image
        source={{ uri: member.avatarUri }}
        style={[styles.memberAvatar, { backgroundColor: colors.surfaceMuted }]}
        contentFit="cover"
      />
      <View style={styles.memberInfo}>
        <Text style={[styles.memberName, { color: colors.text }]} numberOfLines={1}>
          {member.name}
        </Text>
        <Text style={[styles.memberUsername, { color: colors.textSecondary }]} numberOfLines={1}>
          {member.username}
        </Text>
      </View>
      {member.role === 'admin' ? (
        <View style={[styles.adminBadge, { backgroundColor: colors.surfaceMuted }]}>
          <Ionicons name="shield-checkmark" size={12} color={colors.primary} />
          <Text style={[styles.adminBadgeText, { color: colors.primary }]}>{t('group.admin')}</Text>
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1 },
  fallback: { ...Typography.body, padding: Spacing.xl },

  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: Spacing.lg,
    paddingVertical: Spacing.md,
    borderBottomWidth: 1,
  },
  headerTitle: { ...Typography.h3 },
  done: { ...Typography.bodyStrong },

  body: {
    padding: Spacing.lg,
    paddingBottom: Spacing.xxxl,
    gap: Spacing.xl,
  },

  identity: { alignItems: 'center', gap: 4 },
  groupAvatar: {
    width: 84,
    height: 84,
    borderRadius: Radii.pill,
    marginBottom: Spacing.sm,
  },
  groupName: { ...Typography.h2 },
  groupMeta: { ...Typography.caption },

  section: { gap: Spacing.sm },
  sectionTitle: {
    ...Typography.micro,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginLeft: Spacing.xs,
  },
  card: {
    borderRadius: Radii.lg,
    borderWidth: 1,
    padding: Spacing.md,
    gap: Spacing.sm,
  },
  cardFlush: { padding: 0, gap: 0 },

  toggleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: Spacing.md,
  },
  toggleLabel: { ...Typography.bodyStrong, flex: 1 },
  hint: { ...Typography.caption },

  segment: {
    flexDirection: 'row',
    borderRadius: Radii.md,
    padding: 3,
    gap: 3,
  },
  segmentItem: {
    flex: 1,
    paddingVertical: Spacing.sm,
    borderRadius: Radii.sm,
    alignItems: 'center',
  },
  segmentText: { ...Typography.caption, fontWeight: '600' },

  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.sm },
  chip: {
    minWidth: 56,
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm,
    borderRadius: Radii.pill,
    borderWidth: 1.5,
    alignItems: 'center',
  },
  chipText: { ...Typography.caption, fontWeight: '700' },

  memberRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.md,
    padding: Spacing.md,
  },
  memberAvatar: { width: 42, height: 42, borderRadius: Radii.pill },
  memberInfo: { flex: 1 },
  memberName: { ...Typography.bodyStrong },
  memberUsername: { ...Typography.caption, marginTop: 1 },
  adminBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    paddingHorizontal: Spacing.sm,
    paddingVertical: 4,
    borderRadius: Radii.pill,
  },
  adminBadgeText: { ...Typography.micro, fontWeight: '700' },
});
