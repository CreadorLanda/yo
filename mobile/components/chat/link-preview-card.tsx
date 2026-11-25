import { Ionicons } from '@expo/vector-icons';
import { Image } from 'expo-image';
import { ActivityIndicator, Pressable, StyleSheet, View } from 'react-native';

import { Text } from '@/components/ui/text';
import { Radii, Spacing, Typography } from '@/constants/theme';
import { prepareLink } from '@/data/browser';
import type { LinkPreview } from '@/data/link-preview';
import { useTheme } from '@/hooks/use-theme';
import { t } from '@/i18n';

/**
 * The card under a message's text (#353). Everything on it came sealed with
 * the message: the thumbnail is a data URI, so drawing it fetches nothing.
 */
export function LinkPreviewCard({
  preview,
  mine,
  onOpen,
}: {
  preview: LinkPreview;
  mine: boolean;
  onOpen: (url: string) => void;
}) {
  const { colors, chat } = useTheme();
  const text = mine ? chat.textMine || colors.onPrimary : chat.textTheirs || colors.text;
  const meta = mine ? chat.metaMine || colors.onPrimary : chat.metaTheirs || colors.textMuted;
  const accent = mine ? chat.textMine || colors.onPrimary : colors.primary;
  return (
    <Pressable
      onPressIn={() => prepareLink(preview.url)}
      onPress={() => onOpen(preview.url)}
      accessibilityRole="link"
      accessibilityLabel={`${preview.title}, ${preview.site}`}
      style={({ pressed }) => [
        styles.card,
        { backgroundColor: mine ? 'rgba(0,0,0,0.12)' : colors.surfaceMuted, opacity: pressed ? 0.8 : 1 },
      ]}
    >
      <View style={[styles.stripe, { backgroundColor: accent }]} />
      <View style={styles.body}>
        {preview.image ? (
          <Image source={{ uri: preview.image }} style={styles.image} contentFit="cover" />
        ) : null}
        <Text style={[styles.site, { color: accent }]} numberOfLines={1}>
          {preview.site}
        </Text>
        <Text style={[styles.title, { color: text }]} numberOfLines={2}>
          {preview.title}
        </Text>
        {preview.description ? (
          <Text style={[styles.description, { color: meta }]} numberOfLines={3}>
            {preview.description}
          </Text>
        ) : null}
      </View>
    </Pressable>
  );
}

/**
 * The card above the composer while a message with a link is being written.
 * Loading, then the card, with an X that sends the message without it.
 */
export function DraftLinkPreview({
  preview,
  loading,
  onDismiss,
}: {
  preview: LinkPreview | null;
  loading: boolean;
  onDismiss: () => void;
}) {
  const { colors } = useTheme();
  if (!loading && !preview) return null;
  return (
    <View style={[styles.draft, { backgroundColor: colors.surface, borderTopColor: colors.divider }]}>
      <View style={[styles.draftStripe, { backgroundColor: colors.primary }]} />
      {loading || !preview ? (
        <View style={styles.draftLoading}>
          <ActivityIndicator size="small" color={colors.textMuted} />
          <Text style={[styles.draftHint, { color: colors.textMuted }]}>{t('chat.link_preview_loading')}</Text>
        </View>
      ) : (
        <>
          {preview.image ? (
            <Image source={{ uri: preview.image }} style={styles.draftImage} contentFit="cover" />
          ) : (
            <Ionicons name="link-outline" size={20} color={colors.primary} />
          )}
          <View style={styles.draftText}>
            <Text style={[styles.draftTitle, { color: colors.text }]} numberOfLines={1}>
              {preview.title}
            </Text>
            <Text style={[styles.draftHint, { color: colors.textSecondary }]} numberOfLines={1}>
              {preview.description || preview.site}
            </Text>
          </View>
        </>
      )}
      <Pressable
        onPress={onDismiss}
        hitSlop={10}
        accessibilityRole="button"
        accessibilityLabel={t('chat.link_preview_remove')}
      >
        <Ionicons name="close" size={18} color={colors.textMuted} />
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    flexDirection: 'row',
    borderRadius: Radii.md,
    overflow: 'hidden',
    marginTop: Spacing.xs,
    marginBottom: Spacing.xs,
  },
  stripe: { width: 3 },
  body: { flex: 1, padding: Spacing.sm, gap: Spacing.xxs },
  image: { width: '100%', aspectRatio: 1.91, borderRadius: Radii.sm, marginBottom: Spacing.xs },
  site: { ...Typography.label },
  title: { ...Typography.bodyStrong, fontSize: 15, lineHeight: 20 },
  description: { ...Typography.caption },
  draft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  draftStripe: { width: 3, height: 34, borderRadius: Radii.pill },
  draftLoading: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: Spacing.sm },
  draftImage: { width: 40, height: 40, borderRadius: Radii.sm },
  draftText: { flex: 1, gap: 2 },
  draftTitle: { ...Typography.label },
  draftHint: { ...Typography.caption },
});
