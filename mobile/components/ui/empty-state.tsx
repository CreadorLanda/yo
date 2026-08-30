import { Ionicons } from '@expo/vector-icons';
import { StyleSheet, View } from 'react-native';

import { Text } from '@/components/ui/text';
import { Radii, Spacing, Typography } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

/**
 * Shared empty / placeholder state. A soft tinted icon disc inside a hairline
 * ring, a title, and a teaching line — consistent across calls, search,
 * discover, and any future empty surface.
 */
export function EmptyState({
  icon,
  title,
  description,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  title: string;
  description?: string;
}) {
  const { colors } = useTheme();
  return (
    <View style={styles.wrap}>
      <View style={[styles.ring, { borderColor: colors.divider }]}>
        <View style={[styles.disc, { backgroundColor: colors.surfaceMuted }]}>
          <Ionicons name={icon} size={30} color={colors.primary} />
        </View>
      </View>
      <Text style={[styles.title, { color: colors.text }]}>{title}</Text>
      {description ? (
        <Text style={[styles.description, { color: colors.textSecondary }]}>{description}</Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: Spacing.xl,
    paddingVertical: Spacing.xxxl,
    gap: Spacing.sm,
  },
  ring: {
    width: 96,
    height: 96,
    borderRadius: Radii.pill,
    borderWidth: StyleSheet.hairlineWidth,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: Spacing.sm,
  },
  disc: {
    width: 72,
    height: 72,
    borderRadius: Radii.pill,
    alignItems: 'center',
    justifyContent: 'center',
  },
  title: { ...Typography.h3 },
  description: {
    ...Typography.body,
    textAlign: 'center',
    maxWidth: 280,
    lineHeight: 21,
  },
});
