import { Ionicons } from '@expo/vector-icons';
import { router, useFocusEffect } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useCallback, useMemo, useState } from 'react';
import { Pressable, SectionList, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { EmptyState } from '@/components/ui/empty-state';
import { StateTransition } from '@/components/ui/state-transition';
import { Text } from '@/components/ui/text';
import { Radii, Spacing, Typography } from '@/constants/theme';
import { callHistory, type CallLogEntry } from '@/data/api/calls';
import { useTheme } from '@/hooks/use-theme';
import { t } from '@/i18n';

type Tab = 'all' | 'missed';
type Bucket = 'today' | 'yesterday' | 'earlier';

function bucketOf(timestamp: string): Bucket {
  if (timestamp.startsWith('Today')) return 'today';
  if (timestamp.startsWith('Yesterday')) return 'yesterday';
  return 'earlier';
}

function timeOf(timestamp: string): string {
  const comma = timestamp.indexOf(', ');
  return comma === -1 ? timestamp : timestamp.slice(comma + 2);
}

const BUCKET_LABEL: Record<Bucket, string> = {
  today: t('chat.today'),
  yesterday: t('chat.yesterday'),
  earlier: t('calls.earlier'),
};

export default function CallsScreen() {
  const { colors, isDark } = useTheme();
  const [tab, setTab] = useState<Tab>('all');
  const [calls, setCalls] = useState<CallLogEntry[]>([]);
  const [loading, setLoading] = useState(true);

  // Refetched whenever the screen comes back into focus. A call that started
  // while this list was open would otherwise never appear, and the whole point
  // of the running state is that you can still join it.
  useFocusEffect(
    useCallback(() => {
      let cancelled = false;
      callHistory()
        .then((rows) => {
          if (!cancelled) setCalls(rows ?? []);
        })
        .catch(() => {
          if (!cancelled) setCalls([]);
        })
        .finally(() => {
          if (!cancelled) setLoading(false);
        });
      return () => {
        cancelled = true;
      };
    }, []),
  );

  const sections = useMemo(() => {
    // "missed" excludes calls still ringing: those are not missed yet, and
    // burying a joinable call under that tab would waste it.
    const rows = tab === 'missed' ? calls.filter((c) => c.outcome === 'missed') : calls;
    const order: Bucket[] = ['today', 'yesterday', 'earlier'];
    return order
      .map((bucket) => ({
        bucket,
        title: BUCKET_LABEL[bucket],
        data: rows.filter((c) => bucketOf(c.started_at) === bucket),
      }))
      .filter((s) => s.data.length > 0);
  }, [tab, calls]);

  return (
    <SafeAreaView style={[styles.safe, { backgroundColor: colors.background }]} edges={['top', 'bottom']}>
      <StatusBar style={isDark ? 'light' : 'dark'} />

      <View style={[styles.header, { borderBottomColor: colors.divider }]}>
        <Pressable
          onPress={() => router.back()}
          hitSlop={12}
          style={styles.backBtn}
          accessibilityLabel={t('auth.back')}
        >
          <Ionicons name="chevron-back" size={26} color={colors.text} />
        </Pressable>
        <Text style={[styles.headerTitle, { color: colors.text }]}>{t('calls.title')}</Text>
        <View style={styles.backBtn} />
      </View>

      <View style={styles.tabs}>
        {(['all', 'missed'] as const).map((key) => {
          const active = tab === key;
          return (
            <Pressable
              key={key}
              onPress={() => setTab(key)}
              style={[
                styles.tab,
                { backgroundColor: active ? colors.primary : colors.surfaceMuted },
              ]}
              accessibilityRole="button"
              accessibilityState={{ selected: active }}
            >
              <Text
                style={[
                  styles.tabText,
                  { color: active ? colors.onPrimary : colors.textSecondary },
                ]}
              >
                {key === 'all' ? t('calls.tab_all') : t('calls.tab_missed')}
              </Text>
            </Pressable>
          );
        })}
      </View>

      <StateTransition transitionKey={tab} style={styles.flex}>
        <SectionList
          sections={sections}
          keyExtractor={(item) => item.id}
          renderItem={({ item }) => <CallRow call={item} />}
          renderSectionHeader={({ section }) => (
            <Text style={[styles.sectionHeader, { color: colors.textSecondary, backgroundColor: colors.background }]}>
              {section.title}
            </Text>
          )}
          stickySectionHeadersEnabled={false}
          contentContainerStyle={sections.length === 0 ? styles.emptyList : styles.list}
          showsVerticalScrollIndicator={false}
          ListEmptyComponent={
            loading ? null : (
              // Nothing is shown while the first fetch is in flight: an empty
              // state that flashes before the data arrives reads as "you have
              // no calls", which may be false.
              <EmptyState
                icon={tab === 'missed' ? 'checkmark-circle-outline' : 'call-outline'}
                title={tab === 'missed' ? t('calls.empty_missed') : t('calls.empty_all')}
                description={t('calls.empty_hint')}
              />
            )
          }
        />
      </StateTransition>
    </SafeAreaView>
  );
}

function CallRow({ call }: { call: CallLogEntry }) {
  const { colors } = useTheme();
  const missed = call.outcome === 'missed';
  // A live call is the one row worth interrupting the list for: it is not a
  // record of something that happened, it is a door still open.
  const live = call.running && call.outcome !== 'answered';

  const label = live
    ? t('calls.in_progress')
    : call.outcome === 'missed'
      ? t('calls.missed')
      : call.outcome === 'declined'
        ? t('calls.declined')
        : call.mine
          ? t('calls.outgoing')
          : t('calls.incoming');

  // Joining an existing call, not starting a new one: `incoming=1` stops this
  // phone asking the server to ring everyone again for a call already ringing.
  const action = () =>
    router.push(
      call.running
        ? `/call/${call.chat_id}?mode=${call.mode}&incoming=1`
        : `/call/${call.chat_id}?mode=${call.mode}`,
    );

  return (
    <Pressable
      onPress={() => router.push(`/chat/${call.chat_id}`)}
      style={({ pressed }) => [styles.row, pressed && { backgroundColor: colors.surfaceMuted }]}
      accessibilityRole="button"
    >
      <View style={[styles.avatar, styles.avatarFallback, { backgroundColor: colors.surfaceMuted }]}>
        <Text style={[styles.avatarInitial, { color: colors.textSecondary }]}>
          {(call.caller_name || '?').charAt(0).toUpperCase()}
        </Text>
      </View>
      <View style={styles.rowText}>
        <Text
          style={[styles.name, { color: missed ? colors.danger : colors.text }]}
          numberOfLines={1}
        >
          {call.caller_name || t('call.someone')}
          {call.participants > 2 ? `  ·  ${call.participants}` : ''}
        </Text>
        <View style={styles.meta}>
          {live ? (
            <View style={[styles.liveDot, { backgroundColor: colors.success }]} />
          ) : (
            <Ionicons
              name={call.mine ? 'arrow-up' : 'arrow-down'}
              size={13}
              color={missed ? colors.danger : colors.success}
            />
          )}
          <Ionicons
            name={call.mode === 'video' ? 'videocam' : 'call'}
            size={12}
            color={colors.textMuted}
          />
          <Text
            style={[styles.metaText, { color: live ? colors.success : colors.textSecondary }]}
            numberOfLines={1}
          >
            {label}
            {!live && call.duration_sec > 0 ? `  ·  ${formatDuration(call.duration_sec)}` : ''}
          </Text>
        </View>
      </View>
      <Text style={[styles.time, { color: colors.textMuted }]}>{timeOf(call.started_at)}</Text>
      <Pressable
        onPress={action}
        hitSlop={8}
        style={({ pressed }) => [
          styles.callBtn,
          { backgroundColor: live ? colors.success : colors.surfaceMuted },
          pressed && { opacity: 0.6 },
        ]}
        accessibilityLabel={
          live ? t('calls.join') : t('calls.callback', { name: call.caller_name })
        }
      >
        <Ionicons
          name={live ? 'enter' : call.mode === 'video' ? 'videocam' : 'call'}
          size={19}
          color={live ? colors.onPrimary : colors.primary}
        />
      </Pressable>
    </Pressable>
  );
}

function formatDuration(sec: number): string {
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return m > 0 ? `${m}m ${s}s` : `${s}s`;
}

const AVATAR = 50;

const styles = StyleSheet.create({
  safe: { flex: 1 },
  flex: { flex: 1 },

  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: Spacing.sm,
    paddingVertical: Spacing.sm,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  backBtn: {
    width: 40,
    height: 40,
    borderRadius: Radii.pill,
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerTitle: { ...Typography.h3 },

  tabs: {
    flexDirection: 'row',
    gap: Spacing.sm,
    paddingHorizontal: Spacing.lg,
    paddingVertical: Spacing.md,
  },
  tab: {
    paddingHorizontal: Spacing.lg,
    paddingVertical: Spacing.sm,
    borderRadius: Radii.pill,
  },
  tabText: { ...Typography.caption, fontWeight: '700' },

  list: { paddingBottom: Spacing.xl },
  emptyList: { flexGrow: 1 },

  sectionHeader: {
    ...Typography.micro,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 0.6,
    paddingHorizontal: Spacing.lg,
    paddingTop: Spacing.lg,
    paddingBottom: Spacing.sm,
  },

  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.md,
    paddingHorizontal: Spacing.lg,
    paddingVertical: 9,
  },
  avatar: {
    width: AVATAR,
    height: AVATAR,
    borderRadius: Radii.pill,
  },
  rowText: { flex: 1, gap: 3 },
  name: { ...Typography.body, fontWeight: '600' },
  meta: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  metaText: { ...Typography.caption, flex: 1 },
  time: { ...Typography.micro },
  avatarFallback: { alignItems: 'center', justifyContent: 'center' },
  avatarInitial: { ...Typography.h3 },
  liveDot: { width: 8, height: 8, borderRadius: 4 },
  callBtn: {
    width: 40,
    height: 40,
    borderRadius: Radii.pill,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
