import { ActivityIndicator, Pressable, StyleSheet, type PressableProps } from 'react-native';

import { Text } from '@/components/ui/text';
import { Palette, Radii, Spacing, Typography } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

type Props = Omit<PressableProps, 'style' | 'children'> & {
  label: string;
  loading?: boolean;
  disabled?: boolean;
  variant?: 'primary' | 'secondary';
};

export function PrimaryButton({ label, loading, disabled, variant = 'primary', ...rest }: Props) {
  const isPrimary = variant === 'primary';
  const { colors } = useTheme();

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled: !!disabled || !!loading }}
      disabled={!!disabled || !!loading}
      style={({ pressed }) => [
        styles.base,
        isPrimary
          ? [styles.primary, { backgroundColor: colors.primary, shadowColor: colors.primary }]
          : [styles.secondary, { borderColor: colors.border }],
        pressed &&
          (isPrimary
            ? [styles.primaryPressed, { backgroundColor: colors.primary }]
            : { backgroundColor: colors.surfaceMuted }),
        disabled && styles.disabled,
      ]}
      {...rest}
    >
      {loading ? (
        <ActivityIndicator color={isPrimary ? colors.onPrimary : colors.primary} />
      ) : (
        <Text
          style={[
            styles.label,
            isPrimary ? { color: colors.onPrimary } : { color: colors.text },
          ]}
        >
          {label}
        </Text>
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  base: {
    borderRadius: Radii.xl,
    paddingVertical: Spacing.lg,
    paddingHorizontal: Spacing.xl,
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 56,
  },
  primary: {
    shadowColor: Palette.brand[500],
    shadowOpacity: 0.25,
    shadowRadius: 14,
    shadowOffset: { width: 0, height: 6 },
    elevation: 5,
  },
  primaryPressed: {
    transform: [{ scale: 0.98 }],
  },
  secondary: {
    backgroundColor: 'transparent',
    borderWidth: 1,
  },
  disabled: {
    opacity: 0.45,
  },
  label: {
    ...Typography.bodyStrong,
  },
});
