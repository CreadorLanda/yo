import { Ionicons } from '@expo/vector-icons';
import { Pressable, StyleSheet } from 'react-native';

import { Text } from '@/components/ui/text';
import { Radii, Spacing, Typography } from '@/constants/theme';
import { toggleFollow, useIsFollowing } from '@/data/channel-store';
import { useTheme } from '@/hooks/use-theme';
import { t } from '@/i18n';

/** Compact follower count: 48200 -> "48.2K". */
export function formatCount(n: number): string {
  if (n >= 1000) return `${(n / 1000).toFixed(1).replace(/\.0$/, '')}K`;
  return String(n);
}

/** Follow / Following toggle for a Discover channel. `wide` for full-width use. */
export function FollowButton({ id, wide }: { id: string; wide?: boolean }) {
  const { colors } = useTheme();
  const following = useIsFollowing(id);
  return (
    <Pressable
      onPress={() => toggleFollow(id)}
      style={({ pressed }) => [
        styles.follow,
        wide && styles.followWide,
        following
          ? { backgroundColor: 'transparent', borderColor: colors.border }
          : { backgroundColor: colors.primary, borderColor: colors.primary },
        pressed && { opacity: 0.7 },
      ]}
      accessibilityRole="button"
      accessibilityState={{ selected: following }}
    >
      {following ? <Ionicons name="checkmark" size={15} color={colors.text} /> : null}
      <Text style={[styles.followText, { color: following ? colors.text : colors.onPrimary }]}>
        {following ? t('discover.following') : t('discover.follow')}
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  follow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 3,
    paddingHorizontal: Spacing.md,
    height: 34,
    borderRadius: Radii.pill,
    borderWidth: 1.5,
  },
  followWide: {
    height: 46,
    paddingHorizontal: Spacing.xl,
  },
  followText: { ...Typography.caption, fontWeight: '700' },
});
