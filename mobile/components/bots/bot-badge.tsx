import { StyleSheet, View } from 'react-native';

import { Text } from '@/components/ui/text';
import { Radii, Spacing, Typography } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { t } from '@/i18n';

/**
 * The "BOT" tag beside a bot's name (#326), wherever a name is shown — so a
 * bot can never pass for a person in a list, a header or a message.
 */
export function BotBadge({ onColor }: { onColor?: string }) {
  const { colors } = useTheme();
  return (
    <View
      style={[styles.badge, { backgroundColor: onColor ? 'transparent' : colors.surfaceMuted, borderColor: onColor ?? colors.primary }]}
      accessibilityLabel={t('bots.badge_a11y')}
    >
      <Text style={[styles.text, { color: onColor ?? colors.primary }]}>{t('bots.badge')}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  badge: {
    paddingHorizontal: Spacing.xs,
    paddingVertical: 0,
    borderRadius: Radii.sm,
    borderWidth: StyleSheet.hairlineWidth,
    alignSelf: 'center',
  },
  text: { ...Typography.micro, fontSize: 10, lineHeight: 14, letterSpacing: 0.4 },
});
