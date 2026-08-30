import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { router, useLocalSearchParams } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useEffect, useState } from 'react';
import {
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Text, TextInput } from '@/components/ui/text';
import { Radii, Spacing, Typography } from '@/constants/theme';
import {
  canManage,
  isHandleAvailable,
  normalizeHandle,
  persistChannelToApi,
  refreshChannel,
  updateChannel,
  updateChannelSettings,
  useChannel,
  type ChannelVisibility,
  type JoinMode,
  type PostPermission,
  type SlowMode,
} from '@/data/channel-store';
import { appAlert } from '@/data/dialog-store';
import { CHANNEL_CATEGORIES, type ChannelCategory } from '@/data/mock';
import { useTheme } from '@/hooks/use-theme';
import { t } from '@/i18n';

const CATEGORIES = CHANNEL_CATEGORIES.filter((c) => c !== 'all') as Exclude<
  ChannelCategory,
  'all'
>[];

const SLOW_OPTIONS: { value: SlowMode; labelKey: string }[] = [
  { value: 0, labelKey: 'channel_settings.slow_off' },
  { value: 10, labelKey: 'channel_settings.slow_10' },
  { value: 30, labelKey: 'channel_settings.slow_30' },
  { value: 60, labelKey: 'channel_settings.slow_60' },
  { value: 300, labelKey: 'channel_settings.slow_300' },
];

export default function ChannelSettingsScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const channel = useChannel(id);
  const { colors, isDark } = useTheme();
  const manage = canManage(channel);

  const [name, setName] = useState('');
  const [handle, setHandle] = useState('');
  const [description, setDescription] = useState('');
  const [category, setCategory] = useState<Exclude<ChannelCategory, 'all'>>('tech');
  const [visibility, setVisibility] = useState<ChannelVisibility>('public');
  const [whoCanPost, setWhoCanPost] = useState<PostPermission>('admins');
  const [joinMode, setJoinMode] = useState<JoinMode>('open');
  const [commentsEnabled, setCommentsEnabled] = useState(true);
  const [commentsRequireApproval, setCommentsRequireApproval] = useState(true);
  const [allowAnonymousComments, setAllowAnonymousComments] = useState(true);
  const [reactionsEnabled, setReactionsEnabled] = useState(true);
  const [slowModeSec, setSlowModeSec] = useState<SlowMode>(0);
  const [showMemberList, setShowMemberList] = useState(true);
  const [showHistoryToNew, setShowHistoryToNew] = useState(true);
  const [rulesText, setRulesText] = useState('');

  useEffect(() => {
    if (id) refreshChannel(id).catch(() => {});
  }, [id]);

  useEffect(() => {
    if (!channel) return;
    setName(channel.name);
    setHandle(channel.handle.replace(/^@/, ''));
    setDescription(channel.description);
    setCategory(channel.category);
    setVisibility(channel.settings.visibility);
    setWhoCanPost(channel.settings.whoCanPost);
    setJoinMode(channel.settings.joinMode);
    setCommentsEnabled(channel.settings.commentsEnabled);
    setCommentsRequireApproval(channel.settings.commentsRequireApproval);
    setAllowAnonymousComments(channel.settings.allowAnonymousComments);
    setReactionsEnabled(channel.settings.reactionsEnabled);
    setSlowModeSec(channel.settings.slowModeSec);
    setShowMemberList(channel.settings.showMemberList);
    setShowHistoryToNew(channel.settings.showHistoryToNew);
    setRulesText((channel.rules ?? []).join('\n'));
  }, [channel?.id]);

  if (!channel) {
    return (
      <SafeAreaView style={[styles.safe, { backgroundColor: colors.background }]}>
        <Text style={[styles.fallback, { color: colors.text }]}>{t('channel.not_found')}</Text>
      </SafeAreaView>
    );
  }

  if (!manage) {
    return (
      <SafeAreaView style={[styles.safe, { backgroundColor: colors.background }]} edges={['top']}>
        <View style={styles.header}>
          <Pressable onPress={() => router.back()} hitSlop={10}>
            <Ionicons name="chevron-back" size={24} color={colors.text} />
          </Pressable>
          <Text style={[styles.headerTitle, { color: colors.text }]}>
            {t('channel_settings.title')}
          </Text>
          <View style={{ width: 24 }} />
        </View>
        <View style={styles.denied}>
          <Ionicons name="lock-closed-outline" size={40} color={colors.textMuted} />
          <Text style={[styles.deniedTitle, { color: colors.text }]}>
            {t('channel_settings.no_access')}
          </Text>
          <Text style={[styles.deniedBody, { color: colors.textSecondary }]}>
            {t('channel_settings.no_access_hint')}
          </Text>
        </View>
      </SafeAreaView>
    );
  }

  const save = () => {
    const h = normalizeHandle(handle);
    if (name.trim().length < 2) {
      appAlert(t('channel_settings.title'), t('channel_create.fill_required'));
      return;
    }
    if (!isHandleAvailable(h, channel.id)) {
      appAlert(t('channel_settings.title'), t('channel_create.handle_taken'));
      return;
    }

    const profile = {
      name,
      handle: h,
      description,
      category,
      rules: rulesText
        .split('\n')
        .map((r) => r.trim())
        .filter(Boolean)
        .slice(0, 12),
    };
    const settings = {
      visibility,
      whoCanPost,
      joinMode,
      commentsEnabled,
      commentsRequireApproval,
      allowAnonymousComments,
      reactionsEnabled,
      slowModeSec,
      showMemberList,
      showHistoryToNew,
    };
    updateChannel(channel.id, profile);
    updateChannelSettings(channel.id, settings);
    persistChannelToApi(channel.id, profile, settings);
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    router.back();
  };

  return (
    <SafeAreaView style={[styles.safe, { backgroundColor: colors.background }]} edges={['top', 'bottom']}>
      <StatusBar style={isDark ? 'light' : 'dark'} />

      <View style={[styles.header, { borderBottomColor: colors.divider }]}>
        <Pressable onPress={() => router.back()} hitSlop={10} style={styles.iconBtn}>
          <Ionicons name="chevron-back" size={24} color={colors.text} />
        </Pressable>
        <Text style={[styles.headerTitle, { color: colors.text }]}>
          {t('channel_settings.title')}
        </Text>
        <Pressable
          onPress={save}
          style={[styles.saveBtn, { backgroundColor: colors.primary }]}
        >
          <Text style={[styles.saveText, { color: colors.onPrimary }]}>
            {t('channel_settings.save')}
          </Text>
        </Pressable>
      </View>

      <ScrollView contentContainerStyle={styles.body} keyboardShouldPersistTaps="handled">
        <Section title={t('channel_settings.section_profile')} color={colors.textSecondary}>
          <Label color={colors.textSecondary}>{t('channel_create.name')}</Label>
          <TextInput
            value={name}
            onChangeText={setName}
            style={[styles.input, { color: colors.text, backgroundColor: colors.surfaceMuted }]}
            maxLength={60}
          />
          <Label color={colors.textSecondary}>{t('channel_create.handle')}</Label>
          <View style={[styles.handleRow, { backgroundColor: colors.surfaceMuted }]}>
            <Text style={{ color: colors.textSecondary }}>@</Text>
            <TextInput
              value={handle}
              onChangeText={(v) => setHandle(v.toLowerCase().replace(/[^a-z0-9_]/g, ''))}
              autoCapitalize="none"
              style={[styles.handleInput, { color: colors.text }]}
              maxLength={24}
            />
          </View>
          <Label color={colors.textSecondary}>{t('channel_create.description')}</Label>
          <TextInput
            value={description}
            onChangeText={setDescription}
            multiline
            style={[
              styles.input,
              styles.textarea,
              { color: colors.text, backgroundColor: colors.surfaceMuted },
            ]}
            maxLength={500}
          />
          <Label color={colors.textSecondary}>{t('channel_create.category')}</Label>
          <View style={styles.chips}>
            {CATEGORIES.map((cat) => {
              const active = category === cat;
              return (
                <Pressable
                  key={cat}
                  onPress={() => setCategory(cat)}
                  style={[
                    styles.chip,
                    active
                      ? { backgroundColor: colors.primary }
                      : { backgroundColor: colors.surfaceMuted },
                  ]}
                >
                  <Text
                    style={{
                      ...Typography.caption,
                      fontWeight: '700',
                      color: active ? colors.onPrimary : colors.textSecondary,
                    }}
                  >
                    {t(`discover.cat_${cat}`)}
                  </Text>
                </Pressable>
              );
            })}
          </View>
        </Section>

        <Section title={t('channel_settings.section_access')} color={colors.textSecondary}>
          <Segment
            options={[
              { id: 'public', label: t('channel_create.vis_public') },
              { id: 'private', label: t('channel_create.vis_private') },
            ]}
            value={visibility}
            onChange={(v) => setVisibility(v as ChannelVisibility)}
            colors={colors}
          />
          <Label color={colors.textSecondary}>{t('channel_create.join_mode')}</Label>
          <Segment
            options={[
              { id: 'open', label: t('channel_settings.join_open_short') },
              { id: 'request', label: t('channel_settings.join_request_short') },
              { id: 'invite', label: t('channel_settings.join_invite_short') },
            ]}
            value={joinMode}
            onChange={(v) => setJoinMode(v as JoinMode)}
            colors={colors}
          />
          <Toggle
            title={t('channel_settings.show_members')}
            hint={t('channel_settings.show_members_hint')}
            value={showMemberList}
            onChange={setShowMemberList}
            colors={colors}
          />
          <Toggle
            title={t('channel_settings.show_history')}
            hint={t('channel_settings.show_history_hint')}
            value={showHistoryToNew}
            onChange={setShowHistoryToNew}
            colors={colors}
          />
        </Section>

        <Section title={t('channel_settings.section_permissions')} color={colors.textSecondary}>
          <Label color={colors.textSecondary}>{t('channel_create.who_can_post')}</Label>
          <Segment
            options={[
              { id: 'admins', label: t('channel_settings.post_admins_short') },
              { id: 'publishers', label: t('channel_settings.post_publishers_short') },
              { id: 'everyone', label: t('channel_settings.post_everyone_short') },
            ]}
            value={whoCanPost}
            onChange={(v) => setWhoCanPost(v as PostPermission)}
            colors={colors}
          />
          <Label color={colors.textSecondary}>{t('channel_settings.slow_mode')}</Label>
          <View style={styles.chips}>
            {SLOW_OPTIONS.map((opt) => {
              const active = slowModeSec === opt.value;
              return (
                <Pressable
                  key={opt.value}
                  onPress={() => setSlowModeSec(opt.value)}
                  style={[
                    styles.chip,
                    active
                      ? { backgroundColor: colors.primary }
                      : { backgroundColor: colors.surfaceMuted },
                  ]}
                >
                  <Text
                    style={{
                      ...Typography.caption,
                      fontWeight: '700',
                      color: active ? colors.onPrimary : colors.textSecondary,
                    }}
                  >
                    {t(opt.labelKey)}
                  </Text>
                </Pressable>
              );
            })}
          </View>
        </Section>

        <Section title={t('channel_settings.section_engagement')} color={colors.textSecondary}>
          <Toggle
            title={t('channel_create.comments')}
            hint={t('channel_create.comments_hint')}
            value={commentsEnabled}
            onChange={setCommentsEnabled}
            colors={colors}
          />
          {commentsEnabled ? (
            <>
              <Toggle
                title={t('channel_settings.comment_approval')}
                hint={t('channel_settings.comment_approval_hint')}
                value={commentsRequireApproval}
                onChange={setCommentsRequireApproval}
                colors={colors}
              />
              <Toggle
                title={t('channel_create.anon_comments')}
                hint={t('channel_create.anon_comments_hint')}
                value={allowAnonymousComments}
                onChange={setAllowAnonymousComments}
                colors={colors}
              />
            </>
          ) : null}
          <Toggle
            title={t('channel_create.reactions')}
            hint={t('channel_create.reactions_hint')}
            value={reactionsEnabled}
            onChange={setReactionsEnabled}
            colors={colors}
          />
        </Section>

        <Section title={t('channel_settings.section_rules')} color={colors.textSecondary}>
          <Text style={[styles.rulesHint, { color: colors.textSecondary }]}>
            {t('channel_settings.rules_hint')}
          </Text>
          <TextInput
            value={rulesText}
            onChangeText={setRulesText}
            placeholder={t('channel_settings.rules_placeholder')}
            placeholderTextColor={colors.textMuted}
            multiline
            style={[
              styles.input,
              styles.textarea,
              { color: colors.text, backgroundColor: colors.surfaceMuted, minHeight: 120 },
            ]}
          />
        </Section>

        <Pressable
          onPress={save}
          style={[styles.bottomSave, { backgroundColor: colors.primary }]}
        >
          <Text style={[styles.bottomSaveText, { color: colors.onPrimary }]}>
            {t('channel_settings.save')}
          </Text>
        </Pressable>
      </ScrollView>
    </SafeAreaView>
  );
}

function Section({
  title,
  color,
  children,
}: {
  title: string;
  color: string;
  children: React.ReactNode;
}) {
  return (
    <View style={styles.section}>
      <Text style={[styles.sectionTitle, { color }]}>{title}</Text>
      <View style={styles.sectionBody}>{children}</View>
    </View>
  );
}

function Label({ children, color }: { children: string; color: string }) {
  return <Text style={[styles.label, { color }]}>{children}</Text>;
}

function Segment({
  options,
  value,
  onChange,
  colors,
}: {
  options: { id: string; label: string }[];
  value: string;
  onChange: (id: string) => void;
  colors: ReturnType<typeof useTheme>['colors'];
}) {
  return (
    <View style={[styles.segment, { backgroundColor: colors.surfaceMuted }]}>
      {options.map((opt) => {
        const active = value === opt.id;
        return (
          <Pressable
            key={opt.id}
            onPress={() => onChange(opt.id)}
            style={[
              styles.segmentItem,
              active && { backgroundColor: colors.surface, borderColor: colors.border },
            ]}
          >
            <Text
              style={[
                styles.segmentText,
                { color: active ? colors.text : colors.textSecondary },
              ]}
              numberOfLines={1}
            >
              {opt.label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

function Toggle({
  title,
  hint,
  value,
  onChange,
  colors,
}: {
  title: string;
  hint: string;
  value: boolean;
  onChange: (v: boolean) => void;
  colors: ReturnType<typeof useTheme>['colors'];
}) {
  return (
    <View style={[styles.toggle, { borderColor: colors.border, backgroundColor: colors.surface }]}>
      <View style={{ flex: 1 }}>
        <Text style={[styles.toggleTitle, { color: colors.text }]}>{title}</Text>
        <Text style={[styles.toggleHint, { color: colors.textSecondary }]}>{hint}</Text>
      </View>
      <Switch
        value={value}
        onValueChange={onChange}
        trackColor={{ false: colors.surfaceMuted, true: colors.primary }}
        thumbColor="#FFF"
      />
    </View>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1 },
  fallback: { ...Typography.body, padding: Spacing.xl },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm,
    borderBottomWidth: StyleSheet.hairlineWidth,
    gap: Spacing.sm,
  },
  iconBtn: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
  headerTitle: { ...Typography.bodyStrong, flex: 1, fontSize: 16 },
  saveBtn: {
    paddingHorizontal: Spacing.md,
    height: 34,
    borderRadius: Radii.pill,
    alignItems: 'center',
    justifyContent: 'center',
  },
  saveText: { ...Typography.caption, fontWeight: '700' },
  body: { padding: Spacing.lg, gap: Spacing.lg, paddingBottom: Spacing.xxxl },
  section: { gap: Spacing.sm },
  sectionTitle: {
    ...Typography.micro,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 0.7,
  },
  sectionBody: { gap: Spacing.sm },
  label: { ...Typography.micro, fontWeight: '600', marginTop: 4 },
  input: {
    ...Typography.body,
    borderRadius: Radii.lg,
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.md,
  },
  textarea: { minHeight: 88, textAlignVertical: 'top' },
  handleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    borderRadius: Radii.lg,
    paddingHorizontal: Spacing.md,
  },
  handleInput: { ...Typography.body, flex: 1, paddingVertical: Spacing.md },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.sm },
  chip: {
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm,
    borderRadius: Radii.pill,
  },
  segment: {
    flexDirection: 'row',
    borderRadius: Radii.lg,
    padding: 3,
    gap: 3,
  },
  segmentItem: {
    flex: 1,
    alignItems: 'center',
    paddingVertical: 10,
    borderRadius: Radii.md,
    borderWidth: 1,
    borderColor: 'transparent',
  },
  segmentText: { ...Typography.micro, fontWeight: '700', fontSize: 11 },
  toggle: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.md,
    padding: Spacing.md,
    borderRadius: Radii.lg,
    borderWidth: 1,
  },
  toggleTitle: { ...Typography.bodyStrong, fontSize: 14 },
  toggleHint: { ...Typography.caption, marginTop: 2, lineHeight: 17 },
  rulesHint: { ...Typography.caption, lineHeight: 18 },
  bottomSave: {
    minHeight: 50,
    borderRadius: Radii.pill,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: Spacing.sm,
  },
  bottomSaveText: { ...Typography.bodyStrong },
  denied: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: Spacing.xxl,
    gap: Spacing.sm,
  },
  deniedTitle: { ...Typography.h3 },
  deniedBody: { ...Typography.body, textAlign: 'center' },
});
