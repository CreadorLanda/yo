import { Ionicons } from '@expo/vector-icons';
import { useCallback, useEffect, useState } from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, Switch, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Initial, LIVE_RED } from '@/components/live/live-overlay';
import { PeoplePicker } from '@/components/ui/people-picker';
import { Text } from '@/components/ui/text';
import { Radii, Spacing, Typography } from '@/constants/theme';
import {
  banFromLive,
  inviteToLive,
  inviteToStage,
  liveAudienceList,
  liveBans,
  liveStats,
  removeFromStage,
  setLiveComments,
  setLiveModerator,
  unbanFromLive,
  type LiveMember,
  type LiveStats,
  type LiveViewer,
} from '@/data/api/lives';
import { appAlert } from '@/data/dialog-store';
import { t } from '@/i18n';

type Tab = 'people' | 'stage' | 'stats' | 'settings';

/**
 * Everything a moderator does, behind one button.
 *
 * TikTok spreads these over a row of icons along the bottom of the live. Here
 * they share one sheet with four tabs, so the video keeps the screen and a
 * viewer never sees controls they cannot use.
 */
export function LiveToolsSheet({
  visible,
  onClose,
  liveId,
  isHost,
  members,
  commentsEnabled,
}: {
  visible: boolean;
  onClose: () => void;
  liveId: string;
  /** Host or co-host: may appoint moderators. */
  isHost: boolean;
  members: LiveMember[];
  commentsEnabled: boolean;
}) {
  const requests = members.filter((m) => m.stage === 'requested');
  const [tab, setTab] = useState<Tab>(requests.length ? 'stage' : 'people');
  const [audience, setAudience] = useState<LiveViewer[]>([]);
  const [bans, setBans] = useState<{ user_id: string; name: string }[]>([]);
  const [stats, setStats] = useState<LiveStats | null>(null);
  const [inviting, setInviting] = useState(false);

  const failed = useCallback(() => appAlert(t('live.action_failed'), ''), []);

  const loadPeople = useCallback(() => {
    void liveAudienceList(liveId).then(setAudience).catch(() => {});
    void liveBans(liveId).then(setBans).catch(() => {});
  }, [liveId]);

  useEffect(() => {
    if (!visible) return;
    if (tab === 'people') loadPeople();
    if (tab !== 'stats') return;
    const load = () => void liveStats(liveId).then(setStats).catch(() => {});
    load();
    const every = setInterval(load, 5000);
    return () => clearInterval(every);
  }, [visible, tab, liveId, loadPeople]);

  const act = (p: Promise<unknown>, after?: () => void) => {
    p.then(() => after?.()).catch(failed);
  };

  const personMenu = (v: LiveViewer) => {
    appAlert(v.name || t('call.someone'), '', [
      ...(v.stage !== 'on'
        ? [{ text: t('live.call_to_stage'), onPress: () => act(inviteToStage(liveId, v.user_id)) }]
        : [{ text: t('live.remove_from_stage'), onPress: () => act(removeFromStage(liveId, v.user_id)) }]),
      ...(isHost
        ? [
            {
              text: v.moderator ? t('live.remove_moderator') : t('live.make_moderator'),
              onPress: () => act(setLiveModerator(liveId, v.user_id, !v.moderator), loadPeople),
            },
          ]
        : []),
      {
        text: t('live.ban'),
        style: 'destructive' as const,
        onPress: () =>
          appAlert(t('live.ban_title', { name: v.name }), t('live.ban_body'), [
            { text: t('common.cancel'), style: 'cancel' },
            {
              text: t('live.ban'),
              style: 'destructive',
              onPress: () => act(banFromLive(liveId, v.user_id), loadPeople),
            },
          ]),
      },
      { text: t('common.cancel'), style: 'cancel' as const },
    ]);
  };

  const onStage = members.filter((m) => m.stage === 'on' || m.stage === 'invited');

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={onClose} />
      <SafeAreaView style={styles.sheet} edges={['bottom']}>
        <View style={styles.grabber} />
        <View style={styles.tabs}>
          {(
            [
              ['people', t('live.tab_people')],
              ['stage', t('live.tab_stage')],
              ['stats', t('live.tab_stats')],
              ['settings', t('live.tab_settings')],
            ] as [Tab, string][]
          ).map(([key, label]) => (
            <Pressable key={key} onPress={() => setTab(key)} style={[styles.tab, tab === key && styles.tabOn]}>
              <Text style={[styles.tabText, tab === key && styles.tabTextOn]}>{label}</Text>
              {key === 'stage' && requests.length ? (
                <View style={styles.badge}>
                  <Text style={styles.badgeText}>{requests.length}</Text>
                </View>
              ) : null}
            </Pressable>
          ))}
        </View>

        <ScrollView style={styles.body} contentContainerStyle={{ paddingBottom: Spacing.lg }}>
          {tab === 'people' ? (
            <>
              {audience.length === 0 ? <Text style={styles.empty}>{t('live.nobody_watching')}</Text> : null}
              {audience.map((v) => (
                <Row key={v.user_id} name={v.name} tag={v.moderator ? t('live.moderator') : v.stage === 'on' ? t('live.on_stage') : undefined}>
                  <IconBtn icon="ellipsis-horizontal" onPress={() => personMenu(v)} label={t('live.more')} />
                </Row>
              ))}
              {bans.length ? <Text style={styles.section}>{t('live.banned_list')}</Text> : null}
              {bans.map((b) => (
                <Row key={b.user_id} name={b.name}>
                  <Pill label={t('live.unban')} onPress={() => act(unbanFromLive(liveId, b.user_id), loadPeople)} />
                </Row>
              ))}
            </>
          ) : null}

          {tab === 'stage' ? (
            <>
              <Text style={styles.section}>{t('live.requests')}</Text>
              {requests.length === 0 ? <Text style={styles.empty}>{t('live.no_requests')}</Text> : null}
              {requests.map((m) => (
                <Row key={m.user_id} name={m.name}>
                  <Pill label={t('live.decline')} onPress={() => act(removeFromStage(liveId, m.user_id))} />
                  <Pill label={t('live.accept')} strong onPress={() => act(inviteToStage(liveId, m.user_id))} />
                </Row>
              ))}
              <Text style={styles.section}>{t('live.tab_stage')}</Text>
              {onStage.length === 0 ? <Text style={styles.empty}>{t('live.stage_empty')}</Text> : null}
              {onStage.map((m) => (
                <Row key={m.user_id} name={m.name} tag={m.stage === 'invited' ? t('live.invited') : undefined}>
                  <Pill label={t('live.remove_from_stage')} onPress={() => act(removeFromStage(liveId, m.user_id))} />
                </Row>
              ))}
              <Text style={styles.hint}>{t('live.stage_hint')}</Text>
            </>
          ) : null}

          {tab === 'stats' ? (
            stats ? (
              <View style={styles.statsGrid}>
                <Stat icon="eye" value={stats.viewers} label={t('live.stat_now')} />
                <Stat icon="trending-up" value={stats.peak_viewers} label={t('live.stat_peak')} />
                <Stat icon="people" value={stats.unique_viewers} label={t('live.stat_unique')} />
                <Stat icon="heart" value={stats.hearts} label={t('live.stat_hearts')} />
                <Stat icon="chatbubble" value={stats.comments} label={t('live.stat_comments')} />
                <Stat icon="time" value={formatDuration(stats.duration_seconds)} label={t('live.stat_duration')} />
              </View>
            ) : (
              <Text style={styles.empty}>…</Text>
            )
          ) : null}

          {tab === 'settings' ? (
            <>
              <View style={styles.setting}>
                <View style={{ flex: 1 }}>
                  <Text style={styles.settingLabel}>{t('live.comments_on')}</Text>
                  <Text style={styles.hint}>{t('live.comments_on_hint')}</Text>
                </View>
                <Switch
                  value={commentsEnabled}
                  onValueChange={(on) => act(setLiveComments(liveId, on))}
                  trackColor={{ true: LIVE_RED, false: 'rgba(255,255,255,0.2)' }}
                />
              </View>
              <Pressable style={styles.setting} onPress={() => setInviting(true)}>
                <Ionicons name="person-add" size={20} color="#FFF" />
                <Text style={[styles.settingLabel, { flex: 1 }]}>{t('live.invite_people')}</Text>
                <Ionicons name="chevron-forward" size={18} color="rgba(255,255,255,0.4)" />
              </Pressable>
            </>
          ) : null}
        </ScrollView>
      </SafeAreaView>

      <PeoplePicker
        visible={inviting}
        title={t('live.invite_people')}
        confirmLabel={t('live.invite')}
        onClose={() => setInviting(false)}
        onConfirm={(people) => {
          setInviting(false);
          if (people.length) act(inviteToLive(liveId, people.map((p) => p.id)));
        }}
      />
    </Modal>
  );
}

export function formatDuration(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  const mm = String(m).padStart(2, '0');
  const ss = String(s).padStart(2, '0');
  return h > 0 ? `${h}:${mm}:${ss}` : `${mm}:${ss}`;
}

function Row({ name, tag, children }: { name: string; tag?: string; children: React.ReactNode }) {
  return (
    <View style={styles.row}>
      <Initial name={name} size={36} />
      <View style={{ flex: 1 }}>
        <Text style={styles.rowName} numberOfLines={1}>
          {name || '…'}
        </Text>
        {tag ? <Text style={styles.rowTag}>{tag}</Text> : null}
      </View>
      {children}
    </View>
  );
}

function Pill({ label, onPress, strong }: { label: string; onPress: () => void; strong?: boolean }) {
  return (
    <Pressable onPress={onPress} style={[styles.pill, strong && { backgroundColor: LIVE_RED }]}>
      <Text style={styles.pillText}>{label}</Text>
    </Pressable>
  );
}

function IconBtn({
  icon,
  onPress,
  label,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  onPress: () => void;
  label: string;
}) {
  return (
    <Pressable onPress={onPress} hitSlop={8} style={styles.iconBtn} accessibilityLabel={label}>
      <Ionicons name={icon} size={20} color="#FFF" />
    </Pressable>
  );
}

export function Stat({
  icon,
  value,
  label,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  value: number | string;
  label: string;
}) {
  return (
    <View style={styles.stat}>
      <Ionicons name={icon} size={18} color="rgba(255,255,255,0.6)" />
      <Text style={styles.statValue}>{value}</Text>
      <Text style={styles.statLabel}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.35)' },
  sheet: {
    maxHeight: '72%',
    backgroundColor: '#15161C',
    borderTopLeftRadius: Radii.xxl,
    borderTopRightRadius: Radii.xxl,
  },
  grabber: {
    alignSelf: 'center',
    width: 36,
    height: 4,
    borderRadius: 2,
    backgroundColor: 'rgba(255,255,255,0.25)',
    marginTop: Spacing.sm,
  },
  tabs: { flexDirection: 'row', paddingHorizontal: Spacing.md, paddingTop: Spacing.md, gap: Spacing.xs },
  tab: {
    flex: 1,
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    gap: 4,
    paddingVertical: Spacing.sm,
    borderRadius: Radii.pill,
  },
  tabOn: { backgroundColor: 'rgba(255,255,255,0.1)' },
  tabText: { ...Typography.label, color: 'rgba(255,255,255,0.55)' },
  tabTextOn: { color: '#FFF' },
  badge: {
    minWidth: 18,
    height: 18,
    borderRadius: 9,
    paddingHorizontal: 5,
    backgroundColor: LIVE_RED,
    alignItems: 'center',
    justifyContent: 'center',
  },
  badgeText: { ...Typography.micro, color: '#FFF', fontWeight: '700' },
  body: { paddingHorizontal: Spacing.lg, paddingTop: Spacing.md },
  section: {
    ...Typography.label,
    color: 'rgba(255,255,255,0.45)',
    textTransform: 'uppercase',
    marginTop: Spacing.md,
    marginBottom: Spacing.xs,
  },
  empty: { ...Typography.callout, color: 'rgba(255,255,255,0.45)', paddingVertical: Spacing.md },
  hint: { ...Typography.caption, color: 'rgba(255,255,255,0.45)', marginTop: Spacing.sm },
  row: { flexDirection: 'row', alignItems: 'center', gap: Spacing.md, paddingVertical: Spacing.sm },
  rowName: { ...Typography.bodyStrong, color: '#FFF' },
  rowTag: { ...Typography.micro, color: LIVE_RED },
  pill: {
    paddingHorizontal: Spacing.md,
    paddingVertical: 6,
    borderRadius: Radii.pill,
    backgroundColor: 'rgba(255,255,255,0.12)',
  },
  pillText: { ...Typography.label, color: '#FFF' },
  iconBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(255,255,255,0.08)',
  },
  statsGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.sm },
  stat: {
    width: '31%',
    flexGrow: 1,
    padding: Spacing.md,
    borderRadius: Radii.lg,
    backgroundColor: 'rgba(255,255,255,0.06)',
    gap: 2,
  },
  statValue: { ...Typography.h2, color: '#FFF', fontVariant: ['tabular-nums'] },
  statLabel: { ...Typography.micro, color: 'rgba(255,255,255,0.55)' },
  setting: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.md,
    paddingVertical: Spacing.md,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: 'rgba(255,255,255,0.1)',
  },
  settingLabel: { ...Typography.bodyStrong, color: '#FFF' },
});
