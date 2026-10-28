import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { Pressable, StyleSheet, View } from 'react-native';

import { Text } from '@/components/ui/text';
import { Radii, Sizes, Spacing, Typography } from '@/constants/theme';
import { t } from '@/i18n';
import { useTheme } from '@/hooks/use-theme';

type Props = {
  step: number;
  total: number;
  title: string;
  subtitle?: string;
  onBack?: () => void;
};

export function StepHeader({ step, total, title, subtitle, onBack }: Props) {
  const { colors } = useTheme();
  const handleBack = () => {
    if (onBack) {
      onBack();
      return;
    }
    if (router.canGoBack()) {
      router.back();
    }
  };

  const progress = step / total;
  const titleColor = colors.text;
  const trackColor = colors.divider;

  return (
    <View style={styles.wrap}>
      <View style={styles.topRow}>
        <Pressable
          onPress={handleBack}
          hitSlop={12}
          style={({ pressed }) => [
            styles.backButton,
            pressed && { backgroundColor: colors.surfaceMuted },
          ]}
          accessibilityRole="button"
          accessibilityLabel={t('auth.back')}
        >
          <Ionicons name="chevron-back" size={24} color={colors.text} />
        </Pressable>
        <Text style={[styles.counter, { color: colors.textSecondary }]}>
          {t('auth.step_counter', { step, total })}
        </Text>
      </View>

      <View style={[styles.track, { backgroundColor: trackColor }]}>
        <View
          style={[
            styles.fill,
            { width: `${Math.min(Math.max(progress, 0), 1) * 100}%`, backgroundColor: colors.primary },
          ]}
        />
      </View>

      <Text style={[styles.title, { color: titleColor }]}>{title}</Text>
      {subtitle ? (
        <Text style={[styles.subtitle, { color: colors.textSecondary }]}>{subtitle}</Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    paddingHorizontal: Spacing.xl,
    paddingTop: Spacing.sm,
    paddingBottom: Spacing.xl,
    gap: Spacing.md,
  },
  topRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginLeft: -Spacing.sm,
  },
  backButton: {
    width: Sizes.iconButton,
    height: Sizes.iconButton,
    borderRadius: Radii.pill,
    alignItems: 'center',
    justifyContent: 'center',
  },
  counter: {
    ...Typography.label,
    fontVariant: ['tabular-nums'],
  },
  track: {
    height: 4,
    borderRadius: Radii.pill,
    overflow: 'hidden',
  },
  fill: {
    height: '100%',
    borderRadius: Radii.pill,
  },
  title: {
    ...Typography.h1,
    marginTop: Spacing.md,
  },
  subtitle: {
    ...Typography.body,
    marginTop: -Spacing.xs,
  },
});
