import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { Pressable, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Text } from '@/components/ui/text';
import { Spacing, Typography } from '@/constants/theme';
import {
  endCall,
  formatCallDuration,
  useActiveCall,
  useCallSeconds,
} from '@/data/active-call';
import { useTheme } from '@/hooks/use-theme';
import { t } from '@/i18n';

/**
 * The running call, at the top of the app, while its screen is not showing.
 * It takes room rather than covering what is there, so it sits above the name
 * and photo of a chat instead of on top of them.
 */
export function OngoingCallBar() {
  const call = useActiveCall();
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const seconds = useCallSeconds(call?.connectedAt ?? null);

  if (!call || call.onScreen || call.failure) return null;

  const when = call.connectedAt
    ? formatCallDuration(seconds)
    : call.room
      ? t('call.calling')
      : t('call.connecting');
  const label = call.peerName ? `${call.peerName} · ${when}` : when;

  return (
    <View style={[styles.bar, { backgroundColor: colors.success, paddingTop: insets.top }]}>
      <Pressable
        style={styles.open}
        onPress={() => router.push(`/call/${call.chatId}?mode=${call.mode}`)}
        accessibilityRole="button"
        accessibilityLabel={`${t('call.return_to_call')}. ${label}`}
      >
        <Ionicons
          name={call.mode === 'video' ? 'videocam' : 'call'}
          size={16}
          color={colors.onPrimary}
        />
        <View style={styles.copy}>
          <Text style={[styles.title, { color: colors.onPrimary }]} numberOfLines={1}>
            {t('call.return_to_call')}
          </Text>
          <Text style={[styles.detail, { color: colors.onPrimary }]} numberOfLines={1}>
            {label}
          </Text>
        </View>
      </Pressable>
      <Pressable
        onPress={endCall}
        hitSlop={8}
        style={[styles.end, { backgroundColor: colors.danger }]}
        accessibilityRole="button"
        accessibilityLabel={t('call.hang_up')}
      >
        <Ionicons name="call" size={16} color={colors.onPrimary} style={styles.endIcon} />
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  bar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
    paddingHorizontal: Spacing.md,
    paddingBottom: Spacing.xs,
  },
  open: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
    paddingVertical: Spacing.xs,
  },
  copy: { flex: 1 },
  title: { ...Typography.caption, fontWeight: '700' },
  detail: { ...Typography.micro, fontVariant: ['tabular-nums'] },
  end: { width: 32, height: 32, borderRadius: 16, alignItems: 'center', justifyContent: 'center' },
  endIcon: { transform: [{ rotate: '135deg' }] },
});
