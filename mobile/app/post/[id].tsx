import { Ionicons } from '@expo/vector-icons';
import { router, useLocalSearchParams } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useVideoPlayer, VideoView } from 'expo-video';
import { useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, useWindowDimensions, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { SlideThumb, useLocalMedia } from '@/components/post/slide-thumb';
import { CachedImage } from '@/components/ui/cached-image';
import { Text } from '@/components/ui/text';
import { CameraColors, Spacing, Typography } from '@/constants/theme';
import { getPost } from '@/data/api/posts';
import { appAlert } from '@/data/dialog-store';
import { findMyPost, mapPostDTO, removeMyPost, type Post, type PostSlide } from '@/data/post-store';
import { showToast } from '@/data/toast-store';
import { t } from '@/i18n';

/**
 * One post or reel, full screen: the carousel, then who and what.
 *
 * Opens from the grid with what the grid already holds, so the pictures are
 * on screen at once, and asks the server only when it was reached some other
 * way.
 */
export default function PostScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { width: W, height: H } = useWindowDimensions();
  const [post, setPost] = useState<Post | null>(() => findMyPost(id) ?? null);
  const [missing, setMissing] = useState(false);
  const [page, setPage] = useState(0);
  const [deleting, setDeleting] = useState(false);

  useEffect(() => {
    if (post) return;
    let cancelled = false;
    getPost(id)
      .then((dto) => {
        if (!cancelled) setPost(mapPostDTO(dto));
      })
      .catch(() => {
        if (!cancelled) setMissing(true);
      });
    return () => {
      cancelled = true;
    };
  }, [id, post]);

  const confirmDelete = () => {
    appAlert(t('posts.delete_title'), t('posts.delete_body'), [
      { text: t('common.cancel'), style: 'cancel' },
      {
        text: t('common.delete'),
        style: 'destructive',
        onPress: async () => {
          setDeleting(true);
          try {
            await removeMyPost(id);
            router.back();
          } catch {
            // Still here, still posted: say so rather than pretend it went.
            setDeleting(false);
            showToast(t('posts.delete_failed'), 'error', 3200);
          }
        },
      },
    ]);
  };

  // A reel fills the height it can; a post keeps the 4:5 it was framed in.
  const reel = post?.kind === 'reel';
  const slideH = reel ? Math.min(Math.round((W * 16) / 9), Math.round(H * 0.72)) : Math.round((W * 5) / 4);

  return (
    <View style={styles.root}>
      <StatusBar style="light" />
      <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
        <View style={styles.header}>
          <Pressable
            onPress={() => router.back()}
            hitSlop={10}
            style={styles.headerBtn}
            accessibilityRole="button"
            accessibilityLabel={t('common.back')}
          >
            <Ionicons name="chevron-back" size={26} color={CameraColors.onStage} />
          </Pressable>
          <View style={styles.author}>
            {post?.authorAvatar ? (
              <CachedImage url={post.authorAvatar} style={styles.avatar} contentFit="cover" />
            ) : null}
            <Text style={styles.authorName} numberOfLines={1}>
              {post?.authorName || post?.authorUsername || ''}
            </Text>
          </View>
          {post?.isOwn ? (
            <Pressable
              onPress={confirmDelete}
              disabled={deleting}
              hitSlop={10}
              style={styles.headerBtn}
              accessibilityRole="button"
              accessibilityLabel={t('common.delete')}
            >
              {deleting ? (
                <ActivityIndicator color={CameraColors.onStage} />
              ) : (
                <Ionicons name="trash-outline" size={22} color={CameraColors.onStage} />
              )}
            </Pressable>
          ) : (
            <View style={styles.headerBtn} />
          )}
        </View>

        {!post ? (
          <View style={styles.center}>
            {missing ? (
              <Text style={styles.missing}>{t('posts.not_available')}</Text>
            ) : (
              <ActivityIndicator color={CameraColors.onStageMuted} />
            )}
          </View>
        ) : (
          <ScrollView contentContainerStyle={styles.body}>
            <ScrollView
              horizontal
              pagingEnabled
              showsHorizontalScrollIndicator={false}
              style={{ width: W, height: slideH }}
              onMomentumScrollEnd={(e) => setPage(Math.round(e.nativeEvent.contentOffset.x / W))}
            >
              {post.slides.map((slide, index) => (
                <View key={slide.id} style={{ width: W, height: slideH }}>
                  <Slide slide={slide} active={index === page} contain={reel} />
                </View>
              ))}
            </ScrollView>

            {post.slides.length > 1 ? (
              <View style={styles.dots}>
                {post.slides.map((slide, index) => (
                  <View key={slide.id} style={[styles.dot, index === page && styles.dotOn]} />
                ))}
              </View>
            ) : null}

            <View style={styles.meta}>
              {post.caption ? <Text style={styles.caption}>{post.caption}</Text> : null}
              <View style={styles.audience}>
                <Ionicons
                  name={post.visibility === 'public' ? 'globe-outline' : 'people-outline'}
                  size={14}
                  color={CameraColors.onStageMuted}
                />
                <Text style={styles.audienceText}>
                  {t(post.visibility === 'public' ? 'posts.audience_public' : 'posts.audience_contacts')}
                  {'  ·  '}
                  {new Date(post.createdAt).toLocaleDateString()}
                </Text>
              </View>
            </View>
          </ScrollView>
        )}
      </SafeAreaView>
    </View>
  );
}

function Slide({ slide, active, contain }: { slide: PostSlide; active: boolean; contain: boolean }) {
  if (slide.kind === 'image') {
    return <CachedImage url={slide.uri} style={styles.fill} contentFit="cover" />;
  }
  return <VideoSlide slide={slide} active={active} contain={contain} />;
}

/**
 * A video slide. Plays while it is the slide on screen, muted until tapped:
 * sound that starts without being asked for is the fastest way to make
 * someone close an app.
 */
function VideoSlide({ slide, active, contain }: { slide: PostSlide; active: boolean; contain: boolean }) {
  // Server bytes are authenticated, so the player cannot be handed a URL: the
  // file has to be on the device first.
  const local = useLocalMedia(slide.uri, 'video/mp4');
  const [muted, setMuted] = useState(true);
  const player = useVideoPlayer(local, (p) => {
    p.loop = true;
    p.muted = true;
  });

  useEffect(() => {
    if (!local) return;
    if (active) player.play();
    else {
      player.pause();
      player.currentTime = 0;
    }
  }, [local, active, player]);

  useEffect(() => {
    player.muted = muted;
  }, [muted, player]);

  return (
    <Pressable
      style={styles.fill}
      onPress={() => setMuted((m) => !m)}
      accessibilityRole="button"
      accessibilityLabel={t(muted ? 'posts.unmute' : 'posts.mute')}
    >
      {/* The first frame sits underneath, so the slide is never blank while
          the file downloads. */}
      <SlideThumb uri={slide.uri} kind="video" style={styles.fill} contentFit={contain ? 'contain' : 'cover'} />
      {local ? (
        <VideoView
          player={player}
          style={StyleSheet.absoluteFill}
          contentFit={contain ? 'contain' : 'cover'}
          nativeControls={false}
          allowsFullscreen={false}
          allowsPictureInPicture={false}
        />
      ) : (
        <View style={styles.loading}>
          <ActivityIndicator color={CameraColors.onStage} />
        </View>
      )}
      <View style={styles.sound}>
        <Ionicons name={muted ? 'volume-mute' : 'volume-high'} size={16} color={CameraColors.onStage} />
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: CameraColors.stage },
  safe: { flex: 1 },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: Spacing.sm,
    height: 52,
    gap: Spacing.xs,
  },
  headerBtn: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  author: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: Spacing.sm },
  avatar: { width: 30, height: 30, borderRadius: 15, backgroundColor: CameraColors.surface },
  authorName: { ...Typography.bodyStrong, color: CameraColors.onStage, flexShrink: 1 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: Spacing.xl },
  missing: { ...Typography.callout, color: CameraColors.onStageMuted, textAlign: 'center' },
  body: { paddingBottom: Spacing.xxl },
  fill: { width: '100%', height: '100%', backgroundColor: CameraColors.stage },
  loading: { ...StyleSheet.absoluteFillObject, alignItems: 'center', justifyContent: 'center' },
  sound: {
    position: 'absolute',
    right: Spacing.md,
    bottom: Spacing.md,
    width: 30,
    height: 30,
    borderRadius: 15,
    backgroundColor: CameraColors.scrim,
    alignItems: 'center',
    justifyContent: 'center',
  },
  dots: { flexDirection: 'row', justifyContent: 'center', gap: 6, paddingTop: Spacing.md },
  dot: { width: 6, height: 6, borderRadius: 3, backgroundColor: CameraColors.onStageFaint },
  dotOn: { backgroundColor: CameraColors.onStage },
  meta: { paddingHorizontal: Spacing.lg, paddingTop: Spacing.lg, gap: Spacing.sm },
  caption: { ...Typography.body, color: CameraColors.onStage },
  audience: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  audienceText: { ...Typography.caption, color: CameraColors.onStageMuted },
});
