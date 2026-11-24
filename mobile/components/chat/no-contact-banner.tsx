import { Ionicons } from '@expo/vector-icons';
import { useEffect, useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { Text } from '@/components/ui/text';
import { Radii, Spacing, Typography } from '@/constants/theme';
import { noContactRemaining } from '@/data/report-evidence';
import { useTheme } from '@/hooks/use-theme';
import { t } from '@/i18n';

/**
 * Shown where the composer would be while a no-contact period runs.
 *
 * Neutral on purpose: it says that a pause applies and when it ends, and says
 * nothing about who asked for it or why, so it reads the same to both people.
 */
export function NoContactBanner({ until }: { until: string }) {
  const { colors } = useTheme();
  const [now, setNow] = useState(Date.now());

  // Once a minute is as fine as the countdown gets, and cheap.
  useEffect(() => {
    const tick = setInterval(() => setNow(Date.now()), 30000);
    return () => clearInterval(tick);
  }, []);

  const left = noContactRemaining(until, now);
  if (!left) return null;

  const when =
    left.hours > 0
      ? t('report.time_left_hours', { hours: left.hours, minutes: left.minutes })
      : t('report.time_left_minutes', { minutes: left.minutes });

  return (
    <View
      accessibilityRole="alert"
      accessibilityLabel={`${t('report.paused_title')}. ${t('report.paused_body')} ${when}`}
      style={[styles.wrap, { backgroundColor: colors.surface, borderTopColor: colors.divider }]}
    >
      <View style={[styles.badge, { backgroundColor: `${colors.primary}1F` }]}>
        <Ionicons name="shield-checkmark" size={20} color={colors.primary} />
      </View>
      <View style={styles.copy}>
        <Text style={[styles.title, { color: colors.text }]}>{t('report.paused_title')}</Text>
        <Text style={[styles.body, { color: colors.textSecondary }]}>{t('report.paused_body')}</Text>
      </View>
      <View style={[styles.pill, { backgroundColor: colors.surfaceMuted }]}>
        <Ionicons name="time-outline" size={13} color={colors.textSecondary} />
        <Text style={[styles.pillText, { color: colors.textSecondary }]}>{when}</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.md,
    paddingHorizontal: Spacing.lg,
    paddingVertical: Spacing.md,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  badge: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
  },
  copy: { flex: 1, gap: 2 },
  title: { ...Typography.bodyStrong },
  body: { ...Typography.caption },
  pill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: Spacing.sm,
    paddingVertical: 4,
    borderRadius: Radii.pill,
  },
  pillText: { ...Typography.micro, fontVariant: ['tabular-nums'] },
});
