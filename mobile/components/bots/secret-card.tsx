import { Ionicons } from '@expo/vector-icons';
import { useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { Text } from '@/components/ui/text';
import { Radii, Spacing, Typography } from '@/constants/theme';
import { SECRET_CLIPBOARD_SECONDS } from '@/data/bot-policy';
import { copySecret } from '@/data/secret-clipboard';
import { useTheme } from '@/hooks/use-theme';
import { t } from '@/i18n';

/**
 * A secret shown the one time the server hands it over (#328). Lives only in
 * the screen's state: leaving the screen is the end of it.
 */
export function SecretCard({ label, value }: { label: string; value: string }) {
  const { colors } = useTheme();
  const [copied, setCopied] = useState(false);
  return (
    <View style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.border }]}>
      <Text style={[styles.label, { color: colors.textSecondary }]}>{label}</Text>
      <Text selectable style={[styles.value, { color: colors.text, backgroundColor: colors.surfaceMuted }]}>
        {value}
      </Text>
      <Pressable
        onPress={() => {
          void copySecret(value).then(() => setCopied(true));
        }}
        style={({ pressed }) => [styles.copy, { borderColor: colors.border, opacity: pressed ? 0.7 : 1 }]}
        accessibilityRole="button"
      >
        <Ionicons name={copied ? 'checkmark' : 'copy-outline'} size={16} color={colors.primary} />
        <Text style={[styles.copyText, { color: colors.primary }]}>
          {copied ? t('bots.secret_copied', { seconds: SECRET_CLIPBOARD_SECONDS }) : t('bots.secret_copy')}
        </Text>
      </Pressable>
      <View style={styles.warn}>
        <Ionicons name="warning-outline" size={16} color={colors.warning} />
        <Text style={[styles.warnText, { color: colors.textSecondary }]}>{t('bots.secret_once')}</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  card: { borderWidth: StyleSheet.hairlineWidth, borderRadius: Radii.lg, padding: Spacing.lg, gap: Spacing.md },
  label: { ...Typography.label },
  value: {
    ...Typography.callout,
    fontFamily: 'monospace',
    padding: Spacing.md,
    borderRadius: Radii.md,
  },
  copy: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-start',
    gap: Spacing.xs,
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm,
    borderRadius: Radii.pill,
    borderWidth: StyleSheet.hairlineWidth,
  },
  copyText: { ...Typography.label },
  warn: { flexDirection: 'row', gap: Spacing.sm, alignItems: 'flex-start' },
  warnText: { ...Typography.caption, flex: 1 },
});
