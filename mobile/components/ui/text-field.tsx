import { useState } from 'react';
import {
  StyleSheet,
  type TextInputProps,
  View,
} from 'react-native';

import { Text, TextInput, type TextInputHandle } from '@/components/ui/text';
import { Radii, Sizes, Spacing, Typography } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

type Props = TextInputProps & {
  label?: string;
  hint?: string;
  error?: string;
  leftAdornment?: React.ReactNode;
  rightAdornment?: React.ReactNode;
  inputRef?: React.Ref<TextInputHandle>;
};

export function TextField({
  label,
  hint,
  error,
  leftAdornment,
  rightAdornment,
  style,
  onFocus,
  onBlur,
  inputRef,
  ...rest
}: Props) {
  const [focused, setFocused] = useState(false);
  const { colors } = useTheme();

  return (
    <View style={styles.wrap}>
      {label ? <Text style={[styles.label, { color: colors.textSecondary }]}>{label}</Text> : null}

      <View
        style={[
          styles.field,
          { backgroundColor: colors.surface, borderColor: colors.border },
          focused && [styles.fieldFocused, { borderColor: colors.primary }],
          !!error && { borderColor: colors.danger },
        ]}
      >
        {leftAdornment ? <View style={styles.adornment}>{leftAdornment}</View> : null}
        <TextInput
          ref={inputRef}
          style={[styles.input, { color: colors.text }, style]}
          placeholderTextColor={colors.textMuted}
          onFocus={(e) => {
            setFocused(true);
            onFocus?.(e);
          }}
          onBlur={(e) => {
            setFocused(false);
            onBlur?.(e);
          }}
          {...rest}
        />
        {rightAdornment ? <View style={styles.adornment}>{rightAdornment}</View> : null}
      </View>

      {error ? (
        <Text style={[styles.error, { color: colors.danger }]}>{error}</Text>
      ) : hint ? (
        <Text style={[styles.hint, { color: colors.textMuted }]}>{hint}</Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    gap: Spacing.sm,
  },
  label: {
    ...Typography.label,
  },
  // One pixel at rest, two when focused, with the padding giving back the
  // difference so the text does not shift as the ring thickens.
  field: {
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1,
    borderRadius: Radii.md,
    paddingHorizontal: Spacing.md + 1,
    minHeight: Sizes.control,
  },
  fieldFocused: {
    borderWidth: 2,
    paddingHorizontal: Spacing.md,
  },
  input: {
    flex: 1,
    ...Typography.body,
    paddingVertical: Spacing.md,
  },
  adornment: {
    paddingHorizontal: Spacing.xs,
  },
  hint: {
    ...Typography.caption,
  },
  error: {
    ...Typography.caption,
  },
});
