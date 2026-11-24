import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { useEffect } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, useWindowDimensions, View } from 'react-native';

import { SlideThumb } from '@/components/post/slide-thumb';
import { Text } from '@/components/ui/text';
import { CameraColors, Radii, Spacing, Typography } from '@/constants/theme';
import { refreshMyPosts, retryPostPublish, useMyPosts, type Post } from '@/data/post-store';
import { useTheme } from '@/hooks/use-theme';
import { t } from '@/i18n';

const COLUMNS = 3;
const GAP = 2;

/**
 * The signed-in person's posts and reels, three across.
 *
 * Plain views rather than a list: it sits inside the profile's own scroll
 * view, and a page of the grid is at most a few dozen tiles.
 */
export function PostGrid() {
  const { colors } = useTheme();
  const { width } = useWindowDimensions();
  const { posts, loading, loaded, error } = useMyPosts();

  useEffect(() => {
    void refreshMyPosts();
  }, []);

  const tile = Math.floor((width - GAP * (COLUMNS - 1)) / COLUMNS);

  return (
    <View style={styles.root}>
      <View style={styles.heading}>
        <Text style={[styles.title, { color: colors.text }]}>{t('posts.grid_title')}</Text>
        <Pressable
          onPress={() => router.push('/camera?mode=post')}
          hitSlop={8}
          style={({ pressed }) => [styles.add, { borderColor: colors.border }, pressed && { backgroundColor: colors.surfaceMuted }]}
          accessibilityRole="button"
          accessibilityLabel={t('posts.new_post')}
        >
          <Ionicons name="add" size={18} color={colors.text} />
          <Text style={[styles.addText, { color: colors.text }]}>{t('posts.new')}</Text>
        </Pressable>
      </View>

      {posts.length === 0 ? (
        <View style={styles.empty}>
          {!loaded && loading ? (
            <ActivityIndicator color={colors.textMuted} />
          ) : error ? (
            <>
              <Text style={[styles.emptyText, { color: colors.textSecondary }]}>{t('posts.load_failed')}</Text>
              <Pressable onPress={() => void refreshMyPosts()} hitSlop={8} accessibilityRole="button">
                <Text style={[styles.retry, { color: colors.primary }]}>{t('posts.retry')}</Text>
              </Pressable>
            </>
          ) : (
            <>
              <Ionicons name="camera-outline" size={28} color={colors.textMuted} />
              <Text style={[styles.emptyText, { color: colors.textSecondary }]}>{t('posts.empty')}</Text>
            </>
          )}
        </View>
      ) : (
        <View style={styles.grid}>
          {posts.map((post) => (
            <Tile key={post.id} post={post} size={tile} />
          ))}
        </View>
      )}
    </View>
  );
}

function Tile({ post, size }: { post: Post; size: number }) {
  const { colors } = useTheme();
  const cover = post.slides[0];
  const failed = post.uploadStatus === 'failed';

  const open = () => {
    // A tile that never reached the server has nothing to open; tapping a
    // failed one tries again.
    if (failed) retryPostPublish(post.id);
    else if (!post.uploadStatus) router.push(`/post/${post.id}`);
  };

  return (
    <Pressable
      onPress={open}
      style={[styles.tile, { width: size, height: Math.round((size * 5) / 4), backgroundColor: colors.surfaceMuted }]}
      accessibilityRole="button"
      accessibilityLabel={
        failed ? t('posts.retry_upload') : t(post.kind === 'reel' ? 'posts.open_reel' : 'posts.open_post')
      }
    >
      {cover ? <SlideThumb uri={cover.uri} kind={cover.kind} style={styles.tileImage} /> : null}

      {post.kind === 'reel' || post.slides.length > 1 ? (
        <View style={styles.badge}>
          <Ionicons
            name={post.kind === 'reel' ? 'film-outline' : 'copy-outline'}
            size={14}
            color={CameraColors.onStage}
          />
        </View>
      ) : null}

      {post.uploadStatus ? (
        <View style={styles.pending}>
          {failed ? (
            <>
              <Ionicons name="refresh" size={20} color={CameraColors.onStage} />
              <Text style={styles.pendingText}>{t('posts.retry_upload')}</Text>
            </>
          ) : (
            <ActivityIndicator color={CameraColors.onStage} />
          )}
        </View>
      ) : null}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  root: { marginTop: Spacing.xl },
  heading: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: Spacing.lg,
    marginBottom: Spacing.md,
  },
  title: { ...Typography.h3 },
  add: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    height: 34,
    paddingLeft: Spacing.sm,
    paddingRight: Spacing.md,
    borderRadius: Radii.pill,
    borderWidth: 1,
  },
  addText: { ...Typography.label },
  empty: { alignItems: 'center', gap: Spacing.sm, paddingVertical: Spacing.xxl, paddingHorizontal: Spacing.xl },
  emptyText: { ...Typography.callout, textAlign: 'center' },
  retry: { ...Typography.label },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: GAP },
  tile: { overflow: 'hidden' },
  tileImage: { width: '100%', height: '100%' },
  badge: {
    position: 'absolute',
    top: 6,
    right: 6,
    width: 24,
    height: 24,
    borderRadius: 12,
    backgroundColor: CameraColors.scrim,
    alignItems: 'center',
    justifyContent: 'center',
  },
  pending: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: CameraColors.scrim,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4,
  },
  pendingText: { ...Typography.micro, color: CameraColors.onStage },
});
