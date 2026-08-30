import { Ionicons } from '@expo/vector-icons';
import { Pressable, StyleSheet, View } from 'react-native';
import Animated, { FadeInDown, FadeOutUp } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Text } from '@/components/ui/text';
import { Radii, Spacing, Typography } from '@/constants/theme';
import { retryStoryPublish, useStories } from '@/data/story-store';
import { hideToast, useToast, type ToastTone } from '@/data/toast-store';
import { useTheme } from '@/hooks/use-theme';
import { t } from '@/i18n';

function toneColor(tone: ToastTone, primary: string): string {
  if (tone === 'success') return '#16A34A';
  if (tone === 'error') return '#DC2626';
  return primary;
}

function toneIcon(tone: ToastTone): keyof typeof Ionicons.glyphMap {
  if (tone === 'success') return 'checkmark-circle';
  if (tone === 'error') return 'alert-circle';
  return 'cloud-upload-outline';
}

/**
 * Global status strip — mounts once at the root so background story
 * publishes (and other jobs) can report progress after the composer closes.
 */
export function AppToast() {
  const toast = useToast();
  const stories = useStories();
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();

  const failed = stories.find((s) => s.isOwn && s.uploadStatus === 'failed');

  if (!toast) return null;

  const bg = toneColor(toast.tone, colors.primary);
  const canRetry = toast.tone === 'error' && !!failed;

  return (
    <Animated.View
      entering={FadeInDown.duration(220).springify()}
      exiting={FadeOutUp.duration(180)}
      pointerEvents="box-none"
      style={[
        styles.wrap,
        {
          bottom: Math.max(insets.bottom, 12) + 56,
        },
      ]}
    >
      <View style={[styles.card, { backgroundColor: bg, shadowColor: '#000' }]}>
        <Ionicons name={toneIcon(toast.tone)} size={18} color="#FFF" />
        <Text style={styles.text} numberOfLines={2}>
          {toast.message}
        </Text>
        {canRetry ? (
          <Pressable
            onPress={() => {
              if (failed) retryStoryPublish(failed.id);
            }}
            hitSlop={8}
            style={styles.action}
          >
            <Text style={styles.actionText}>{t('stories.retry')}</Text>
          </Pressable>
        ) : (
          <Pressable onPress={() => hideToast(toast.id)} hitSlop={8}>
            <Ionicons name="close" size={16} color="rgba(255,255,255,0.85)" />
          </Pressable>
        )}
      </View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    position: 'absolute',
    left: Spacing.lg,
    right: Spacing.lg,
    zIndex: 9999,
    elevation: 20,
  },
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
    paddingHorizontal: Spacing.md,
    paddingVertical: 12,
    borderRadius: Radii.lg,
    shadowOpacity: 0.25,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 6 },
  },
  text: {
    ...Typography.caption,
    color: '#FFF',
    fontWeight: '600',
    flex: 1,
  },
  action: {
    paddingHorizontal: Spacing.sm,
    paddingVertical: 4,
    borderRadius: Radii.pill,
    backgroundColor: 'rgba(255,255,255,0.2)',
  },
  actionText: {
    ...Typography.caption,
    color: '#FFF',
    fontWeight: '700',
  },
});
