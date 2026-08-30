import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { Pressable, StyleSheet, View } from 'react-native';

import { Text } from '@/components/ui/text';
import { Radii, Spacing, Typography } from '@/constants/theme';
import type { CallLogEntry } from '@/data/api/calls';
import { useTheme } from '@/hooks/use-theme';
import { t } from '@/i18n';

/**
 * The row a call leaves in the conversation.
 *
 * A call used to leave nothing behind — the thread said nothing about who rang
 * or whether it was answered, and a call still going could only be rejoined
 * from a separate screen.
 *
 * The outcome is not baked into the message: it changes after the row is
 * written, and a row that said "missed" while the call was still ringing would
 * be actively misleading. It comes from the call log, resolved at render.
 */
export function CallRow({
  chatId,
  callId,
  mode,
  entry,
  fromMe,
  timestamp,
}: {
  chatId: string;
  callId: string;
  mode: 'voice' | 'video';
  /** The log entry for this call, if it has been loaded. */
  entry?: CallLogEntry;
  fromMe: boolean;
  timestamp: string;
}) {
  const { colors } = useTheme();

  // Live and not yet joined by this person: the row is a door, not a record.
  const live = !!entry?.running && entry.outcome !== 'answered';
  const missed = entry?.outcome === 'missed';

  const label = live
    ? t('calls.in_progress')
    : !entry
      ? mode === 'video'
        ? t('call.incoming_video')
        : t('call.incoming_voice')
      : entry.outcome === 'missed'
        ? t('calls.missed')
        : entry.outcome === 'declined'
          ? t('calls.declined')
          : fromMe
            ? t('calls.outgoing')
            : t('calls.incoming');

  const join = () =>
    router.push(
      entry?.running
        ? `/call/${chatId}?mode=${mode}&incoming=1`
        : `/call/${chatId}?mode=${mode}`,
    );

  return (
    <View style={styles.wrap}>
      <View
        style={[
          styles.row,
          { backgroundColor: colors.surface, borderColor: live ? colors.success : colors.border },
        ]}
      >
        <View
          style={[
            styles.icon,
            { backgroundColor: live ? colors.success : missed ? colors.danger : colors.surfaceMuted },
          ]}
        >
          <Ionicons
            name={mode === 'video' ? 'videocam' : 'call'}
            size={16}
            color={live || missed ? '#FFFFFF' : colors.textSecondary}
          />
        </View>

        <View style={styles.text}>
          <Text
            style={[styles.label, { color: missed ? colors.danger : colors.text }]}
            numberOfLines={1}
          >
            {label}
          </Text>
          <Text style={[styles.meta, { color: colors.textMuted }]} numberOfLines={1}>
            {timestamp}
            {entry && !live && entry.duration_sec > 0
              ? `  ·  ${formatDuration(entry.duration_sec)}`
              : ''}
            {entry && entry.participants > 2 ? `  ·  ${entry.participants}` : ''}
          </Text>
        </View>

        <Pressable
          onPress={join}
          hitSlop={8}
          accessibilityRole="button"
          accessibilityLabel={live ? t('calls.join') : t('calls.callback', { name: '' })}
          style={({ pressed }) => [
            styles.action,
            { backgroundColor: live ? colors.success : colors.surfaceMuted },
            pressed && { opacity: 0.7 },
          ]}
        >
          <Text
            style={[styles.actionText, { color: live ? colors.onPrimary : colors.primary }]}
            numberOfLines={1}
          >
            {live ? t('calls.join') : t('calls.call_back')}
          </Text>
        </Pressable>
      </View>
    </View>
  );
}

function formatDuration(sec: number): string {
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return m > 0 ? `${m}m ${s}s` : `${s}s`;
}

const styles = StyleSheet.create({
  wrap: { paddingHorizontal: Spacing.lg, paddingVertical: Spacing.xs },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.md,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: Radii.lg,
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm,
  },
  icon: { width: 32, height: 32, borderRadius: Radii.pill, alignItems: 'center', justifyContent: 'center' },
  text: { flex: 1, gap: 1 },
  label: { ...Typography.bodyStrong },
  meta: { ...Typography.micro },
  action: { paddingHorizontal: Spacing.md, paddingVertical: 6, borderRadius: Radii.pill },
  actionText: { ...Typography.caption, fontWeight: '700' },
});
