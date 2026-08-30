import { Ionicons } from '@expo/vector-icons';
import { Image } from 'expo-image';

import { CachedImage } from '@/components/ui/cached-image';
import * as Haptics from 'expo-haptics';
import { router } from 'expo-router';
import { useEffect, useMemo } from 'react';
import {
  Dimensions,
  FlatList,
  Pressable,
  ScrollView,
  StyleSheet,
  View,
} from 'react-native';
import Animated, {
  FadeInDown,
  FadeInRight,
  useAnimatedStyle,
  useSharedValue,
  withSpring,
} from 'react-native-reanimated';

import { TabScene } from '@/components/ui/tab-scene';
import { Text } from '@/components/ui/text';
import { Palette, Radii, Spacing, Typography } from '@/constants/theme';
import type { Story } from '@/data/mock';
import { useProfile } from '@/data/profile-store';
import {
  bootstrapStories,
  refreshStories,
  retryStoryPublish,
  useStories,
  useStoriesLoading,
} from '@/data/story-store';
import { useTheme } from '@/hooks/use-theme';
import { t } from '@/i18n';

const { width: SCREEN_W } = Dimensions.get('window');
const CARD_W = (SCREEN_W - Spacing.xl * 2 - Spacing.md) / 2;
const CARD_H = CARD_W * 1.42;
const RAIL_CARD_W = 118;
const RAIL_CARD_H = 168;

export default function StoriesScreen() {
  const { colors, isDark } = useTheme();
  const profile = useProfile();
  const stories = useStories();
  const loading = useStoriesLoading();

  useEffect(() => {
    bootstrapStories().catch(() => {});
  }, []);

  const mine = useMemo(() => stories.filter((s) => s.isOwn), [stories]);
  const others = useMemo(() => stories.filter((s) => !s.isOwn), [stories]);
  const fresh = useMemo(() => others.filter((s) => !s.isViewed), [others]);
  const seen = useMemo(() => others.filter((s) => s.isViewed), [others]);

  return (
    <TabScene>
      <View style={[styles.safe, { backgroundColor: colors.background }]}>
        <FlatList
          data={fresh}
          keyExtractor={(item) => item.id}
          numColumns={2}
          columnWrapperStyle={styles.gridRow}
          showsVerticalScrollIndicator={false}
          contentContainerStyle={styles.list}
          refreshing={loading}
          onRefresh={() => {
            refreshStories().catch(() => {});
          }}
          ListHeaderComponent={
            <View style={styles.headerBlock}>
              {/* Pulse header */}
              <Animated.View entering={FadeInDown.duration(420).springify()}>
                <View style={styles.pulseHead}>
                  <View style={styles.pulseTitleRow}>
                    <View style={[styles.liveDot, { backgroundColor: colors.primary }]} />
                    <Text style={[styles.pulseTitle, { color: colors.text }]}>
                      {t('stories.pulse')}
                    </Text>
                  </View>
                  <Text style={[styles.pulseHint, { color: colors.textSecondary }]}>
                    {t('stories.pulse_hint', { count: fresh.length })}
                  </Text>
                </View>
              </Animated.View>

              {/* Horizontal cinema rail — always show create + live feed */}
              <ScrollView
                horizontal
                showsHorizontalScrollIndicator={false}
                contentContainerStyle={styles.rail}
                decelerationRate="fast"
              >
                <Animated.View entering={FadeInRight.delay(40).duration(380)}>
                  <CreateRailCard
                    avatarUri={profile.avatarUri}
                    ownStory={mine[0]}
                  />
                </Animated.View>
                {mine.slice(1).map((story, i) => (
                  <Animated.View
                    key={story.id}
                    entering={FadeInRight.delay(55 + i * 40).duration(380)}
                  >
                    <RailCard story={story} />
                  </Animated.View>
                ))}
                {others.map((story, i) => (
                  <Animated.View
                    key={story.id}
                    entering={FadeInRight.delay(70 + i * 55).duration(380)}
                  >
                    <RailCard story={story} />
                  </Animated.View>
                ))}
              </ScrollView>

              {fresh.length > 0 || seen.length > 0 ? (
                <Text style={[styles.sectionLabel, { color: colors.textSecondary }]}>
                  {t('stories.for_you')}
                </Text>
              ) : null}
            </View>
          }
          renderItem={({ item, index }) => (
            <Animated.View
              entering={FadeInDown.delay(80 + index * 60).duration(400).springify()}
              style={{ width: CARD_W }}
            >
              <PortraitCard story={item} tall={index % 3 === 0} />
            </Animated.View>
          )}
          ListFooterComponent={
            seen.length > 0 ? (
              <View style={styles.seenBlock}>
                <Text style={[styles.sectionLabel, { color: colors.textSecondary }]}>
                  {t('stories.already_seen')}
                </Text>
                <View style={styles.seenList}>
                  {seen.map((story) => (
                    <SeenRow key={story.id} story={story} />
                  ))}
                </View>
              </View>
            ) : null
          }
          ListEmptyComponent={
            seen.length > 0 ? (
              <View style={{ height: Spacing.sm }} />
            ) : (
              <View style={styles.empty}>
                <View
                  style={[
                    styles.emptyOrb,
                    { backgroundColor: isDark ? colors.surfaceElevated : colors.surfaceMuted },
                  ]}
                >
                  <Ionicons name="planet-outline" size={32} color={colors.primary} />
                </View>
                <Text style={[styles.emptyTitle, { color: colors.text }]}>{t('stories.add_title')}</Text>
                <Text style={[styles.emptyBody, { color: colors.textSecondary }]}>
                  {t('stories.add_subtitle')}
                </Text>
              </View>
            )
          }
        />

        <Pressable
          onPress={() => {
            Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
            router.push('/story/create');
          }}
          style={({ pressed }) => [
            styles.fab,
            {
              backgroundColor: colors.primary,
              shadowColor: colors.primary,
            },
            pressed && styles.fabPressed,
          ]}
          accessibilityRole="button"
          accessibilityLabel={t('stories.add_title')}
        >
          <Ionicons name="camera" size={22} color={colors.onPrimary} />
        </Pressable>
      </View>
    </TabScene>
  );
}

// ── Create card on the horizontal rail ──────────────────────────────────────

function CreateRailCard({
  avatarUri,
  ownStory,
}: {
  avatarUri: string;
  ownStory?: Story;
}) {
  const { colors, isDark } = useTheme();
  const uploading = ownStory?.uploadStatus === 'uploading';
  const failed = ownStory?.uploadStatus === 'failed';
  const ringColor = failed ? '#DC2626' : uploading ? colors.primary : colors.primary;

  return (
    <Pressable
      onPress={() => {
        Haptics.selectionAsync();
        if (ownStory?.uploadStatus === 'failed') {
          retryStoryPublish(ownStory.id);
          return;
        }
        if (ownStory && !ownStory.uploadStatus) {
          router.push(`/story/${ownStory.id}`);
          return;
        }
        if (ownStory?.uploadStatus === 'uploading') return;
        router.push('/story/create');
      }}
      onLongPress={() => {
        Haptics.selectionAsync();
        router.push('/story/create');
      }}
      style={({ pressed }) => [
        styles.railCard,
        styles.createRail,
        {
          backgroundColor: isDark ? colors.surfaceElevated : colors.surface,
          borderColor: ringColor,
        },
        pressed && { opacity: 0.9, transform: [{ scale: 0.98 }] },
      ]}
      accessibilityRole="button"
      accessibilityLabel={t('stories.add_title')}
    >
      <View style={styles.createRailInner}>
        <View style={styles.createAvatarWrap}>
          {avatarUri ? (
            <Image
              source={{ uri: avatarUri }}
              style={[styles.createAvatar, { backgroundColor: colors.surfaceMuted }]}
              contentFit="cover"
            />
          ) : (
            <View style={[styles.createAvatar, { backgroundColor: colors.surfaceMuted }]} />
          )}
          <Pressable
            onPress={(e) => {
              e.stopPropagation?.();
              Haptics.selectionAsync();
              router.push('/story/create');
            }}
            hitSlop={8}
            style={[
              styles.createPlus,
              {
                backgroundColor: failed ? '#DC2626' : colors.primary,
                borderColor: isDark ? colors.surfaceElevated : colors.surface,
              },
            ]}
          >
            <Ionicons
              name={uploading ? 'cloud-upload' : failed ? 'refresh' : 'add'}
              size={14}
              color={colors.onPrimary}
            />
          </Pressable>
        </View>
        <Text style={[styles.createLabel, { color: colors.text }]} numberOfLines={2}>
          {uploading
            ? t('stories.uploading')
            : failed
              ? t('stories.post_failed')
              : ownStory
                ? t('stories.your_frame')
                : t('stories.add_title')}
        </Text>
        <Text style={[styles.createSub, { color: colors.textMuted }]} numberOfLines={1}>
          {uploading
            ? t('stories.sending')
            : failed
              ? t('stories.retry')
              : ownStory
                ? t('stories.create_hint')
                : t('stories.add_subtitle')}
        </Text>
      </View>
    </Pressable>
  );
}

// ── Horizontal rail portrait ────────────────────────────────────────────────

function RailCard({ story }: { story: Story }) {
  const { colors } = useTheme();
  const scale = useSharedValue(1);
  const anim = useAnimatedStyle(() => ({ transform: [{ scale: scale.value }] }));

  return (
    <Pressable
      onPressIn={() => {
        scale.value = withSpring(0.96, { damping: 16, stiffness: 280 });
      }}
      onPressOut={() => {
        scale.value = withSpring(1, { damping: 14, stiffness: 220 });
      }}
      onPress={() => {
        Haptics.selectionAsync();
        router.push(`/story/${story.id}`);
      }}
      accessibilityRole="button"
      accessibilityLabel={t('stories.open_story', { name: story.user })}
    >
      <Animated.View style={[styles.railCard, anim]}>
        {story.kind === 'text' ||
        story.kind === 'poll' ||
        story.kind === 'question' ||
        story.kind === 'audio' ||
        !story.coverUri ? (
          <View
            style={[
              StyleSheet.absoluteFill,
              { backgroundColor: story.kind === 'audio' ? '#12141A' : story.accent },
            ]}
          >
            <View style={styles.railTextGlow} />
            {story.kind === 'audio' ? (
              <View style={styles.railAudioIcon}>
                <Ionicons name="mic" size={28} color="#FFF" />
              </View>
            ) : (
              <Text style={styles.railTextCaption} numberOfLines={4}>
                {story.caption || story.user}
              </Text>
            )}
          </View>
        ) : (
          <CachedImage url={story.coverUri} style={StyleSheet.absoluteFill} contentFit="cover" />
        )}
        <View style={styles.railScrim} />
        {!story.isViewed ? (
          <View style={[styles.freshPip, { backgroundColor: colors.primary }]} />
        ) : null}
        {story.kind === 'video' || story.kind === 'audio' || story.kind === 'poll' ? (
          <View style={styles.railKind}>
            <Ionicons
              name={
                story.kind === 'audio' ? 'mic' : story.kind === 'poll' ? 'stats-chart' : 'play'
              }
              size={11}
              color="#FFF"
            />
          </View>
        ) : null}
        <View style={styles.railFooter}>
          <View
            style={[
              styles.railRing,
              {
                borderColor: story.isViewed ? 'rgba(255,255,255,0.35)' : story.accent,
              },
            ]}
          >
            <Image source={{ uri: story.avatarUri }} style={styles.railAvatar} contentFit="cover" />
          </View>
          <Text style={styles.railName} numberOfLines={1}>
            {story.user}
          </Text>
        </View>
      </Animated.View>
    </Pressable>
  );
}

// ── For-you portrait cards ──────────────────────────────────────────────────

function PortraitCard({ story, tall }: { story: Story; tall?: boolean }) {
  const { colors } = useTheme();
  const height = tall ? CARD_H + 28 : CARD_H;
  const scale = useSharedValue(1);
  const anim = useAnimatedStyle(() => ({ transform: [{ scale: scale.value }] }));

  return (
    <Pressable
      onPressIn={() => {
        scale.value = withSpring(0.97, { damping: 16, stiffness: 280 });
      }}
      onPressOut={() => {
        scale.value = withSpring(1, { damping: 14, stiffness: 220 });
      }}
      onPress={() => {
        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
        router.push(`/story/${story.id}`);
      }}
      accessibilityRole="button"
      accessibilityLabel={t('stories.open_story', { name: story.user })}
    >
      <Animated.View
        style={[
          styles.portrait,
          {
            height,
            backgroundColor: colors.surfaceMuted,
            shadowColor: isShadow(colors.background),
          },
          anim,
        ]}
      >
        {story.kind === 'text' ||
        story.kind === 'poll' ||
        story.kind === 'question' ||
        story.kind === 'audio' ||
        !story.coverUri ? (
          <View
            style={[
              StyleSheet.absoluteFill,
              { backgroundColor: story.kind === 'audio' ? '#12141A' : story.accent },
            ]}
          >
            <View style={styles.portraitHalo} />
            <View style={styles.portraitTextWrap}>
              {story.kind === 'audio' ? (
                <Ionicons
                  name="mic"
                  size={36}
                  color="#FFF"
                  style={{ alignSelf: 'center', marginBottom: 8 }}
                />
              ) : null}
              <Text style={styles.portraitText} numberOfLines={5}>
                {story.caption || story.user}
              </Text>
            </View>
          </View>
        ) : (
          <CachedImage url={story.coverUri} style={StyleSheet.absoluteFill} contentFit="cover" />
        )}

        <View style={styles.portraitTopFade} />
        <View style={styles.portraitBottomFade} />

        <View style={styles.portraitTop}>
          <View
            style={[
              styles.portraitRing,
              {
                borderColor: story.isViewed ? 'rgba(255,255,255,0.4)' : story.accent,
              },
            ]}
          >
            <Image source={{ uri: story.avatarUri }} style={styles.portraitAvatar} contentFit="cover" />
          </View>
          {story.kind === 'video' ? (
            <View style={styles.kindChip}>
              <Ionicons name="play" size={10} color="#FFF" />
              <Text style={styles.kindChipText}>{story.durationSec}s</Text>
            </View>
          ) : story.kind === 'audio' ? (
            <View style={styles.kindChip}>
              <Ionicons name="mic" size={10} color="#FFF" />
              <Text style={styles.kindChipText}>{story.audioSec ?? story.durationSec}s</Text>
            </View>
          ) : story.kind === 'poll' ? (
            <View style={styles.kindChip}>
              <Ionicons name="stats-chart" size={10} color="#FFF" />
            </View>
          ) : story.kind === 'text' || story.kind === 'question' ? (
            <View style={styles.kindChip}>
              <Ionicons name={story.kind === 'question' ? 'help' : 'text'} size={10} color="#FFF" />
            </View>
          ) : null}
        </View>

        <View style={styles.portraitMeta}>
          <Text style={styles.portraitName} numberOfLines={1}>
            {story.user}
          </Text>
          <Text style={styles.portraitTime} numberOfLines={1}>
            {story.postedAt}
            {!story.isViewed ? ` · ${t('stories.new')}` : ''}
          </Text>
          {story.kind !== 'text' ? (
            <Text style={styles.portraitCaption} numberOfLines={2}>
              {story.caption}
            </Text>
          ) : null}
        </View>
      </Animated.View>
    </Pressable>
  );
}

function isShadow(_bg: string) {
  return '#0B1020';
}

// ── Compact seen list ───────────────────────────────────────────────────────

function SeenRow({ story }: { story: Story }) {
  const { colors } = useTheme();
  return (
    <Pressable
      onPress={() => router.push(`/story/${story.id}`)}
      style={({ pressed }) => [
        styles.seenRow,
        { backgroundColor: colors.surface, borderColor: colors.border },
        pressed && { opacity: 0.88 },
      ]}
      accessibilityRole="button"
      accessibilityLabel={t('stories.open_story', { name: story.user })}
    >
      <View style={[styles.seenRing, { borderColor: colors.border }]}>
        <Image
          source={{ uri: story.avatarUri }}
          style={[styles.seenAvatar, { backgroundColor: colors.surfaceMuted }]}
          contentFit="cover"
        />
      </View>
      <View style={styles.seenText}>
        <Text style={[styles.seenName, { color: colors.text }]} numberOfLines={1}>
          {story.user}
        </Text>
        <Text style={[styles.seenMeta, { color: colors.textMuted }]} numberOfLines={1}>
          {story.postedAt} · {t('stories.viewed')}
        </Text>
      </View>
      <CachedImage
        url={story.coverUri}
        style={[styles.seenThumb, { backgroundColor: colors.surfaceMuted }]}
        contentFit="cover"
      />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1 },
  list: {
    paddingBottom: 110,
    paddingTop: Spacing.sm,
  },
  headerBlock: {
    paddingBottom: Spacing.md,
    gap: Spacing.md,
  },
  pulseHead: {
    paddingHorizontal: Spacing.xl,
    gap: 4,
  },
  pulseTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
  },
  liveDot: {
    width: 8,
    height: 8,
    borderRadius: Radii.pill,
  },
  pulseTitle: {
    ...Typography.h3,
    letterSpacing: -0.3,
  },
  pulseHint: {
    ...Typography.caption,
    marginLeft: 16,
  },
  rail: {
    paddingHorizontal: Spacing.xl,
    gap: Spacing.sm + 2,
    paddingBottom: Spacing.xs,
  },
  railCard: {
    width: RAIL_CARD_W,
    height: RAIL_CARD_H,
    borderRadius: Radii.xl,
    overflow: 'hidden',
    backgroundColor: Palette.neutral[800],
  },
  createRail: {
    borderWidth: 1.5,
    borderStyle: 'dashed',
  },
  createRailInner: {
    flex: 1,
    padding: Spacing.md,
    justifyContent: 'flex-end',
    gap: 4,
  },
  createAvatarWrap: {
    width: 44,
    height: 44,
    marginBottom: Spacing.sm,
  },
  createAvatar: {
    width: 44,
    height: 44,
    borderRadius: Radii.pill,
  },
  createPlus: {
    position: 'absolute',
    right: -2,
    bottom: -2,
    width: 20,
    height: 20,
    borderRadius: Radii.pill,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 2,
  },
  createLabel: {
    ...Typography.bodyStrong,
    fontSize: 13,
    lineHeight: 17,
  },
  createSub: {
    ...Typography.micro,
  },
  railScrim: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'transparent',
    // layered via footer gradient simulation
  },
  railTextGlow: {
    position: 'absolute',
    width: 120,
    height: 120,
    borderRadius: 60,
    backgroundColor: 'rgba(255,255,255,0.18)',
    top: 20,
    left: -20,
  },
  railTextCaption: {
    ...Typography.caption,
    color: '#FFF',
    fontWeight: '700',
    padding: Spacing.md,
    paddingTop: Spacing.xl,
    lineHeight: 18,
  },
  railAudioIcon: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  freshPip: {
    position: 'absolute',
    top: 10,
    right: 10,
    width: 8,
    height: 8,
    borderRadius: Radii.pill,
    borderWidth: 1.5,
    borderColor: 'rgba(0,0,0,0.2)',
  },
  storyLiveBadge: {
    position: 'absolute',
    top: 8,
    right: 8,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 7,
    paddingVertical: 3,
    borderRadius: Radii.pill,
    backgroundColor: '#EF4444',
  },
  storyLiveDot: { width: 5, height: 5, borderRadius: 3, backgroundColor: '#FFF' },
  storyLiveText: {
    ...Typography.micro,
    color: '#FFF',
    fontWeight: '800',
    fontSize: 9,
    letterSpacing: 0.5,
  },
  railKind: {
    position: 'absolute',
    top: 10,
    left: 10,
    width: 22,
    height: 22,
    borderRadius: Radii.pill,
    backgroundColor: 'rgba(0,0,0,0.42)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  railFooter: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    padding: Spacing.sm,
    gap: 6,
    backgroundColor: 'rgba(11,16,32,0.45)',
  },
  railRing: {
    width: 28,
    height: 28,
    borderRadius: Radii.pill,
    borderWidth: 2,
    padding: 1,
    overflow: 'hidden',
  },
  railAvatar: {
    width: '100%',
    height: '100%',
    borderRadius: Radii.pill,
  },
  railName: {
    ...Typography.micro,
    color: '#FFF',
    fontWeight: '600',
  },
  sectionLabel: {
    ...Typography.micro,
    textTransform: 'uppercase',
    letterSpacing: 1.1,
    paddingHorizontal: Spacing.xl,
    marginTop: Spacing.sm,
    marginBottom: Spacing.xs,
  },
  gridRow: {
    paddingHorizontal: Spacing.xl,
    gap: Spacing.md,
    marginBottom: Spacing.md,
  },
  portrait: {
    width: '100%',
    borderRadius: Radii.xl + 2,
    overflow: 'hidden',
    shadowOpacity: 0.12,
    shadowRadius: 16,
    shadowOffset: { width: 0, height: 8 },
    elevation: 4,
  },
  portraitHalo: {
    position: 'absolute',
    width: 160,
    height: 160,
    borderRadius: 80,
    backgroundColor: 'rgba(255,255,255,0.16)',
    top: '20%',
    alignSelf: 'center',
    left: '15%',
  },
  portraitTextWrap: {
    flex: 1,
    justifyContent: 'center',
    padding: Spacing.lg,
  },
  portraitText: {
    ...Typography.h3,
    color: '#FFF',
    textAlign: 'center',
    fontWeight: '700',
  },
  portraitTopFade: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    height: 72,
    backgroundColor: 'rgba(11,16,32,0.28)',
  },
  portraitBottomFade: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    height: 110,
    backgroundColor: 'rgba(11,16,32,0.55)',
  },
  portraitTop: {
    position: 'absolute',
    top: Spacing.sm + 2,
    left: Spacing.sm + 2,
    right: Spacing.sm + 2,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  portraitRing: {
    width: 34,
    height: 34,
    borderRadius: Radii.pill,
    borderWidth: 2,
    padding: 1.5,
    overflow: 'hidden',
  },
  portraitAvatar: {
    width: '100%',
    height: '100%',
    borderRadius: Radii.pill,
  },
  kindChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: Radii.pill,
    backgroundColor: 'rgba(0,0,0,0.4)',
  },
  kindChipText: {
    ...Typography.micro,
    color: '#FFF',
    fontWeight: '600',
  },
  portraitMeta: {
    position: 'absolute',
    left: Spacing.md,
    right: Spacing.md,
    bottom: Spacing.md,
    gap: 2,
  },
  portraitName: {
    ...Typography.bodyStrong,
    color: '#FFF',
    fontSize: 14,
  },
  portraitTime: {
    ...Typography.micro,
    color: 'rgba(255,255,255,0.78)',
  },
  portraitCaption: {
    ...Typography.caption,
    color: 'rgba(255,255,255,0.92)',
    marginTop: 4,
  },
  seenBlock: {
    paddingTop: Spacing.md,
    paddingBottom: Spacing.lg,
    gap: Spacing.sm,
  },
  seenList: {
    paddingHorizontal: Spacing.xl,
    gap: Spacing.sm,
  },
  seenRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.md,
    padding: Spacing.sm + 2,
    borderRadius: Radii.lg,
    borderWidth: StyleSheet.hairlineWidth,
  },
  seenRing: {
    width: 44,
    height: 44,
    borderRadius: Radii.pill,
    borderWidth: 2,
    padding: 2,
    overflow: 'hidden',
  },
  seenAvatar: {
    width: '100%',
    height: '100%',
    borderRadius: Radii.pill,
  },
  seenText: { flex: 1 },
  seenName: { ...Typography.bodyStrong, fontSize: 14 },
  seenMeta: { ...Typography.caption, marginTop: 1 },
  seenThumb: {
    width: 40,
    height: 52,
    borderRadius: Radii.md,
  },
  empty: {
    alignItems: 'center',
    paddingHorizontal: Spacing.xxl,
    paddingTop: Spacing.xxxl,
    gap: Spacing.sm,
  },
  emptyOrb: {
    width: 72,
    height: 72,
    borderRadius: Radii.pill,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: Spacing.sm,
  },
  emptyTitle: { ...Typography.h3 },
  emptyBody: { ...Typography.body, textAlign: 'center' },
  fab: {
    position: 'absolute',
    right: Spacing.lg,
    bottom: Spacing.lg,
    width: 56,
    height: 56,
    borderRadius: Radii.pill,
    alignItems: 'center',
    justifyContent: 'center',
    shadowOpacity: 0.35,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 6 },
    elevation: 8,
  },
  fabPressed: {
    transform: [{ scale: 0.95 }],
  },
});
