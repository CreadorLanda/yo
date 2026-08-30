import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { Pressable, StyleSheet, View } from 'react-native';

import { Text } from '@/components/ui/text';
import { Palette, Radii, Spacing, Typography } from '@/constants/theme';
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
  const { colors, scheme } = useTheme();
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
  const titleColor = scheme === 'dark' ? colors.text : Palette.brand[900];
  const trackColor = colors.divider;

  return (
    <View style={styles.wrap}>
      <View style={styles.topRow}>
        <Pressable
          onPress={handleBack}
          hitSlop={12}
          style={({ pressed }) => [
            styles.backButton,
            { backgroundColor: colors.surface, borderColor: colors.border },
            pressed && { backgroundColor: colors.surfaceMuted },
          ]}
          accessibilityRole="button"
          accessibilityLabel={t('auth.back')}
        >
          <Ionicons name="chevron-back" size={22} color={colors.text} />
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
    paddingTop: Spacing.md,
    paddingBottom: Spacing.lg,
    gap: Spacing.md,
  },
  topRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.md,
  },
  backButton: {
    width: 40,
    height: 40,
    borderRadius: Radii.pill,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
  },
  counter: {
    ...Typography.caption,
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
    marginTop: Spacing.sm,
  },
  subtitle: {
    ...Typography.body,
  },
});
