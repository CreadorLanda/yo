import { Pressable, ScrollView, StyleSheet, View } from 'react-native';

import { BotBadge } from '@/components/bots/bot-badge';
import { Avatar } from '@/components/ui/avatar';
import { Text } from '@/components/ui/text';
import { Spacing, Typography } from '@/constants/theme';
import { describe, type ChatCommand } from '@/data/bot-commands';
import { useTheme } from '@/hooks/use-theme';
import { getLocale, t } from '@/i18n';

/**
 * The list `/` opens above the composer (#324): the commands of the bots in
 * this chat, filtered as the person types.
 */
export function CommandPopover({ commands, onPick }: { commands: ChatCommand[]; onPick: (c: ChatCommand) => void }) {
  const { colors } = useTheme();
  const lang = getLocale();
  return (
    <View
      style={[styles.wrap, { backgroundColor: colors.surface, borderTopColor: colors.divider }]}
      accessibilityRole="menu"
      accessibilityLabel={t('bots.commands_a11y')}
    >
      <ScrollView keyboardShouldPersistTaps="always" style={styles.scroll}>
        {commands.map((c) => (
          <Pressable
            key={`${c.bot.id}:${c.name}`}
            onPress={() => onPick(c)}
            accessibilityRole="menuitem"
            accessibilityLabel={`/${c.name}, ${describe(c, lang)}, ${c.bot.display_name}`}
            style={({ pressed }) => [styles.row, pressed && { backgroundColor: colors.surfaceMuted }]}
          >
            <Avatar uri={c.bot.avatar_url} id={c.bot.id} username={c.bot.username} size={32} />
            <View style={{ flex: 1, gap: 2 }}>
              <View style={styles.head}>
                <Text style={[styles.name, { color: colors.text }]}>/{c.name}</Text>
                {c.options.map((o) => (
                  <Text key={o.name} style={[styles.opt, { color: colors.textMuted }]}>
                    {o.required ? `<${o.name}>` : `[${o.name}]`}
                  </Text>
                ))}
              </View>
              <Text style={[styles.desc, { color: colors.textSecondary }]} numberOfLines={1}>
                {describe(c, lang)}
              </Text>
            </View>
            <View style={styles.botName}>
              <Text style={[styles.desc, { color: colors.textMuted }]} numberOfLines={1}>
                {c.bot.display_name}
              </Text>
              <BotBadge />
            </View>
          </Pressable>
        ))}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { borderTopWidth: StyleSheet.hairlineWidth },
  scroll: { maxHeight: 240 },
  row: { flexDirection: 'row', alignItems: 'center', gap: Spacing.md, paddingHorizontal: Spacing.md, paddingVertical: Spacing.sm },
  head: { flexDirection: 'row', alignItems: 'baseline', gap: Spacing.xs, flexWrap: 'wrap' },
  name: { ...Typography.bodyStrong, fontFamily: 'monospace' },
  opt: { ...Typography.caption, fontFamily: 'monospace' },
  desc: { ...Typography.caption },
  botName: { flexDirection: 'row', alignItems: 'center', gap: Spacing.xs, maxWidth: 140 },
});
