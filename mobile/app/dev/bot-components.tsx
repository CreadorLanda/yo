import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { InteractiveMessage, type InteractMember } from '@/components/bots/interactive-message';
import { Text } from '@/components/ui/text';
import { Radii, Spacing, Typography } from '@/constants/theme';
import { sanitizeInteractive, type BotInteractive } from '@/data/bot-message';
import { openInApp } from '@/data/browser';
import { useTheme } from '@/hooks/use-theme';
import { t } from '@/i18n';

/**
 * Every interactive bot component in one place (#325), for dev builds: check
 * them in light and dark without a bot. Clicks pretend to reach a bot; the
 * "fails" button shows the failure state.
 */

const members: InteractMember[] = [
  { id: 'u1', name: 'Ana', username: 'ana' },
  { id: 'u2', name: 'Bruno', username: 'bruno' },
  { id: 'u3', name: 'Carla', username: 'carla' },
];

const SAMPLES: { title: string; raw: Record<string, unknown> }[] = [
  {
    title: 'Card colours',
    raw: {
      card: {
        title: 'Deploy finished',
        description: 'Version 1.4.0 is live in production.',
        color: 'success',
        fields: [
          { name: 'Duration', value: '3 min', inline: true },
          { name: 'Commit', value: 'a1b2c3d', inline: true },
          { name: 'Notes', value: 'Bots can now send cards with fields, a thumbnail and a footer.' },
        ],
        footer: 'ci_bot · today 14:02',
      },
    },
  },
  ...(['primary', 'warning', 'danger', 'info'] as const).map((color) => ({
    title: `Card: ${color}`,
    raw: { card: { title: `A ${color} card`, description: 'The stripe uses the theme token.', color } },
  })),
  {
    title: 'Buttons',
    raw: {
      components: [
        [
          { type: 'button', id: 'yes', label: 'Primary', style: 'primary' },
          { type: 'button', id: 'maybe', label: 'Secondary', style: 'secondary' },
          { type: 'button', id: 'no', label: 'Danger', style: 'danger' },
        ],
        [
          { type: 'button', label: 'Link', style: 'link', url: 'https://example.com' },
          { type: 'button', id: 'off', label: 'Disabled', style: 'primary', disabled: true },
          { type: 'button', id: 'fail', label: 'Fails', style: 'secondary' },
        ],
      ],
    },
  },
  {
    title: 'Select (single)',
    raw: { components: [[{ type: 'select', id: 'lunch', placeholder: 'Where to eat?', options: [{ label: 'Sushi', value: 'sushi' }, { label: 'Pizza', value: 'pizza' }, { label: 'Salad', value: 'salad' }] }]] },
  },
  {
    title: 'Select (multi)',
    raw: { components: [[{ type: 'select', id: 'days', placeholder: 'Which days work?', max: 3, options: ['Mon', 'Tue', 'Wed', 'Thu', 'Fri'].map((d) => ({ label: d, value: d.toLowerCase() })) }]] },
  },
  { title: 'User picker', raw: { components: [[{ type: 'user_select', id: 'assignee', placeholder: 'Who takes it?', max: 1 }]] } },
  {
    title: 'Form',
    raw: {
      components: [[{
        type: 'form', id: 'rsvp', title: 'RSVP', submit_label: 'Send RSVP',
        fields: [
          { id: 'name', label: 'Name', type: 'text', required: true },
          { id: 'guests', label: 'Guests', type: 'number' },
          { id: 'date', label: 'Date', type: 'date' },
          { id: 'meal', label: 'Meal', type: 'choice', choices: [{ label: 'Fish', value: 'fish' }, { label: 'Veg', value: 'veg' }] },
        ],
      }]],
    },
  },
  {
    title: 'Expired',
    raw: {
      card: { title: 'Poll closed', description: 'This poll ended yesterday.', color: 'info' },
      components: [[{ type: 'button', id: 'vote', label: 'Vote', style: 'primary' }]],
      expires_at: '2020-01-01T00:00:00Z',
    },
  },
];

export default function BotComponentsGallery() {
  const { colors } = useTheme();
  const items = SAMPLES.map((s) => ({ title: s.title, interactive: sanitizeInteractive(s.raw) as BotInteractive }));
  return (
    <SafeAreaView style={[styles.screen, { backgroundColor: colors.background }]} edges={['top']}>
      <View style={[styles.header, { borderBottomColor: colors.border }]}>
        <Pressable onPress={() => router.back()} hitSlop={10}>
          <Ionicons name="chevron-back" size={26} color={colors.text} />
        </Pressable>
        <Text style={[styles.title, { color: colors.text }]}>{t('bots.dev_gallery')}</Text>
      </View>
      <ScrollView contentContainerStyle={styles.body}>
        {items.map((it) => (
          <View key={it.title} style={styles.item}>
            <Text style={[styles.label, { color: colors.textSecondary }]}>{it.title}</Text>
            <View style={[styles.bubble, { backgroundColor: colors.surface }]}>
              <InteractiveMessage
                interactive={it.interactive}
                members={members}
                onOpenLink={(url) => void openInApp(url)}
                onInteract={(componentId) =>
                  new Promise((resolve, reject) => setTimeout(componentId === 'fail' ? reject : resolve, 900))
                }
              />
            </View>
          </View>
        ))}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.md,
    paddingHorizontal: Spacing.lg,
    paddingVertical: Spacing.md,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  title: { ...Typography.h3 },
  body: { padding: Spacing.lg, gap: Spacing.lg, paddingBottom: Spacing.xxxl },
  item: { gap: Spacing.xs },
  label: { ...Typography.label, textTransform: 'uppercase' },
  bubble: { borderRadius: Radii.lg, padding: Spacing.md },
});
