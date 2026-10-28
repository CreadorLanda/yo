import { ActivityIndicator, Pressable, StyleSheet, type PressableProps } from 'react-native';

import { Text } from '@/components/ui/text';
import { Radii, Sizes, Spacing, Typography } from '@/constants/theme';
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
          ? { backgroundColor: colors.primary }
          : [styles.secondary, { borderColor: colors.border }],
        pressed && (isPrimary ? styles.primaryPressed : { backgroundColor: colors.surfaceMuted }),
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
  // Flat. A coloured glow under the button was the loudest thing on every
  // screen it sat on, and the colour alone already says "this is the action".
  base: {
    borderRadius: Radii.lg,
    paddingHorizontal: Spacing.xl,
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: Sizes.control,
  },
  primaryPressed: {
    opacity: 0.88,
    transform: [{ scale: 0.985 }],
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
