import { Ionicons } from '@expo/vector-icons';

import { ChannelCover, ChannelLogo } from '@/components/ui/channel-art';
import * as Haptics from 'expo-haptics';
import { router } from 'expo-router';
import { useEffect, useMemo, useState } from 'react';
import {
  Dimensions,
  FlatList,
  Pressable,
  ScrollView,
  StyleSheet,
  View,
} from 'react-native';
import Animated, { FadeInDown, FadeInRight } from 'react-native-reanimated';

import { EmptyState } from '@/components/ui/empty-state';
import { FollowButton, formatCount } from '@/components/ui/follow-button';
import { TabScene } from '@/components/ui/tab-scene';
import { Text, TextInput } from '@/components/ui/text';
import { Radii, Spacing, Typography } from '@/constants/theme';
import { bootstrapChannels, useChannels } from '@/data/channel-store';
import { CHANNEL_CATEGORIES, type Channel, type ChannelCategory } from '@/data/mock';
import { useTheme } from '@/hooks/use-theme';
import { t } from '@/i18n';

const { width: SCREEN_W } = Dimensions.get('window');
const FEATURED_W = SCREEN_W - Spacing.xl * 2;
const TREND_W = 168;
const TREND_H = 210;

const CAT_ICONS: Record<Exclude<ChannelCategory, 'all'>, keyof typeof Ionicons.glyphMap> = {
  crypto: 'logo-bitcoin',
  nft: 'color-palette-outline',
  tech: 'hardware-chip-outline',
  gaming: 'game-controller-outline',
  news: 'newspaper-outline',
};

export default function DiscoverScreen() {
  const { colors, isDark } = useTheme();
  const [category, setCategory] = useState<ChannelCategory>('all');
  const [query, setQuery] = useState('');
  const allChannels = useChannels();

  useEffect(() => {
    bootstrapChannels().catch(() => {});
  }, []);

  const channels = useMemo(() => {
    const q = query.trim().toLowerCase();
    return allChannels.filter((c) => {
      if (category !== 'all' && c.category !== category) return false;
      // Private channels only show if owned/followed later — for now hide pure private non-owned
      if (c.settings?.visibility === 'private' && !c.isOwned) return false;
      if (!q) return true;
      return (
        c.name.toLowerCase().includes(q) ||
        c.handle.toLowerCase().includes(q) ||
        c.description.toLowerCase().includes(q)
      );
    });
  }, [category, query, allChannels]);

  const featured = useMemo(
    () => [...channels].sort((a, b) => b.members - a.members)[0],
    [channels],
  );
  const trending = useMemo(
    () => [...channels].sort((a, b) => b.members - a.members).slice(0, 6),
    [channels],
  );
  const rest = useMemo(
    () => channels.filter((c) => c.id !== featured?.id),
    [channels, featured],
  );

  return (
    <TabScene>
      <View style={[styles.container, { backgroundColor: colors.background }]}>
        <FlatList
          data={rest}
          keyExtractor={(item) => item.id}
          renderItem={({ item, index }) => (
            <Animated.View entering={FadeInDown.delay(40 + index * 40).duration(360)}>
              <ChannelRow channel={item} />
            </Animated.View>
          )}
          contentContainerStyle={channels.length === 0 ? styles.emptyList : styles.list}
          showsVerticalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
          ListHeaderComponent={
            <View style={styles.headerBlock}>
              {/* Title */}
              <Animated.View entering={FadeInDown.duration(380)} style={styles.titleBlock}>
                <Text style={[styles.kicker, { color: colors.primary }]}>
                  {t('discover.explore_vibe')}
                </Text>
                <Text style={[styles.title, { color: colors.text }]}>{t('discover.title')}</Text>
                <Text style={[styles.subtitle, { color: colors.textSecondary }]}>
                  {t('discover.subtitle')}
                </Text>
              </Animated.View>

              {/* Search */}
              <View
                style={[
                  styles.searchField,
                  {
                    backgroundColor: isDark ? colors.surfaceElevated : colors.surface,
                    borderColor: colors.border,
                  },
                ]}
              >
                <Ionicons name="search" size={18} color={colors.textMuted} />
                <TextInput
                  value={query}
                  onChangeText={setQuery}
                  placeholder={t('discover.search_placeholder')}
                  placeholderTextColor={colors.textMuted}
                  style={[styles.searchInput, { color: colors.text }]}
                />
                {query.length > 0 ? (
                  <Pressable onPress={() => setQuery('')} hitSlop={8}>
                    <Ionicons name="close-circle" size={18} color={colors.textMuted} />
                  </Pressable>
                ) : null}
              </View>

              {/* Category chips */}
              <ScrollView
                horizontal
                showsHorizontalScrollIndicator={false}
                contentContainerStyle={styles.chips}
              >
                {CHANNEL_CATEGORIES.map((cat) => {
                  const active = category === cat;
                  return (
                    <Pressable
                      key={cat}
                      onPress={() => {
                        Haptics.selectionAsync();
                        setCategory(cat);
                      }}
                      style={[
                        styles.chip,
                        active
                          ? { backgroundColor: colors.primary, borderColor: colors.primary }
                          : {
                              backgroundColor: isDark ? colors.surfaceElevated : colors.surface,
                              borderColor: colors.border,
                            },
                      ]}
                      accessibilityRole="button"
                      accessibilityState={{ selected: active }}
                    >
                      {cat !== 'all' ? (
                        <Ionicons
                          name={CAT_ICONS[cat]}
                          size={14}
                          color={active ? colors.onPrimary : colors.textSecondary}
                        />
                      ) : (
                        <Ionicons
                          name="apps-outline"
                          size={14}
                          color={active ? colors.onPrimary : colors.textSecondary}
                        />
                      )}
                      <Text
                        style={[
                          styles.chipText,
                          { color: active ? colors.onPrimary : colors.textSecondary },
                        ]}
                      >
                        {t(`discover.cat_${cat}`)}
                      </Text>
                    </Pressable>
                  );
                })}
              </ScrollView>

              {/* Featured hero */}
              {featured ? (
                <View style={styles.section}>
                  <SectionLabel color={colors.textSecondary}>{t('discover.featured')}</SectionLabel>
                  <Animated.View entering={FadeInDown.delay(60).duration(400)}>
                    <FeaturedCard channel={featured} />
                  </Animated.View>
                </View>
              ) : null}

              {/* Trending rail */}
              {trending.length > 1 ? (
                <View style={styles.section}>
                  <SectionLabel color={colors.textSecondary}>{t('discover.trending')}</SectionLabel>
                  <ScrollView
                    horizontal
                    showsHorizontalScrollIndicator={false}
                    contentContainerStyle={styles.trendRail}
                    decelerationRate="fast"
                  >
                    {trending.map((ch, i) => (
                      <Animated.View
                        key={ch.id}
                        entering={FadeInRight.delay(50 + i * 45).duration(360)}
                      >
                        <TrendCard channel={ch} />
                      </Animated.View>
                    ))}
                  </ScrollView>
                </View>
              ) : null}

              {rest.length > 0 ? (
                <SectionLabel color={colors.textSecondary}>{t('discover.for_you')}</SectionLabel>
              ) : null}
            </View>
          }
          ListEmptyComponent={
            <EmptyState
              icon="compass-outline"
              title={t('discover.empty_title')}
              description={t('discover.empty_hint')}
            />
          }
        />

        <Pressable
          onPress={() => {
            Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
            router.push('/channel/create');
          }}
          style={({ pressed }) => [
            styles.fab,
            {
              backgroundColor: colors.primary,
              shadowColor: colors.primary,
            },
            pressed && { transform: [{ scale: 0.96 }], opacity: 0.92 },
          ]}
          accessibilityRole="button"
          accessibilityLabel={t('channel_create.title')}
        >
          <Ionicons name="add" size={28} color={colors.onPrimary} />
        </Pressable>
      </View>
    </TabScene>
  );
}

function SectionLabel({ children, color }: { children: string; color: string }) {
  return <Text style={[styles.sectionLabel, { color }]}>{children}</Text>;
}

function FeaturedCard({ channel }: { channel: Channel }) {
  const { colors } = useTheme();
  return (
    <Pressable
      onPress={() => {
        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
        router.push(`/channel/${channel.id}`);
      }}
      style={({ pressed }) => [styles.featured, pressed && { transform: [{ scale: 0.985 }] }]}
      accessibilityRole="button"
      accessibilityLabel={t('discover.open_channel', { name: channel.name })}
    >
      <ChannelCover url={channel.coverUri} handle={channel.handle} style={StyleSheet.absoluteFill} />
      <View style={styles.featuredScrim} />
      <View style={styles.featuredTop}>
        <View style={styles.livePill}>
          <View style={styles.liveDot} />
          <Text style={styles.liveText}>{t('discover.live')}</Text>
        </View>
        {channel.verified ? (
          <View style={styles.verifiedPill}>
            <Ionicons name="checkmark-circle" size={12} color="#FFF" />
            <Text style={styles.verifiedText}>{t('discover.verified_badge')}</Text>
          </View>
        ) : null}
      </View>
      <View style={styles.featuredBottom}>
        <ChannelLogo
          url={channel.avatarUri}
          name={channel.name}
          handle={channel.handle}
          size={40}
          style={styles.featuredAvatar}
        />
        <View style={styles.featuredMeta}>
          <Text style={styles.featuredName} numberOfLines={1}>
            {channel.name}
          </Text>
          <Text style={styles.featuredSub} numberOfLines={1}>
            {channel.handle} · {t('discover.members', { count: formatCount(channel.members) })}
          </Text>
          <Text style={styles.featuredDesc} numberOfLines={2}>
            {channel.description}
          </Text>
        </View>
        <FollowButton id={channel.id} />
      </View>
    </Pressable>
  );
}

function TrendCard({ channel }: { channel: Channel }) {
  const { colors } = useTheme();
  return (
    <Pressable
      onPress={() => router.push(`/channel/${channel.id}`)}
      style={({ pressed }) => [
        styles.trendCard,
        { backgroundColor: colors.surfaceMuted },
        pressed && { opacity: 0.92 },
      ]}
      accessibilityRole="button"
      accessibilityLabel={t('discover.open_channel', { name: channel.name })}
    >
      <ChannelCover url={channel.coverUri} handle={channel.handle} style={StyleSheet.absoluteFill} />
      <View style={styles.trendScrim} />
      <View style={styles.trendTop}>
        <View style={[styles.catMini, { backgroundColor: 'rgba(0,0,0,0.4)' }]}>
          <Ionicons name={CAT_ICONS[channel.category]} size={11} color="#FFF" />
        </View>
        {channel.verified ? (
          <Ionicons name="checkmark-circle" size={16} color={colors.primary} />
        ) : null}
      </View>
      <View style={styles.trendBottom}>
        <ChannelLogo
          url={channel.avatarUri}
          name={channel.name}
          handle={channel.handle}
          size={40}
          style={styles.trendAvatar}
        />
        <Text style={styles.trendName} numberOfLines={1}>
          {channel.name}
        </Text>
        <Text style={styles.trendMembers} numberOfLines={1}>
          {formatCount(channel.members)}
        </Text>
      </View>
    </Pressable>
  );
}

function ChannelRow({ channel }: { channel: Channel }) {
  const { colors, isDark } = useTheme();
  return (
    <Pressable
      onPress={() => router.push(`/channel/${channel.id}`)}
      style={({ pressed }) => [
        styles.row,
        {
          backgroundColor: isDark ? colors.surface : colors.surface,
          borderColor: colors.border,
        },
        pressed && { opacity: 0.9 },
      ]}
      accessibilityRole="button"
      accessibilityLabel={t('discover.open_channel', { name: channel.name })}
    >
      <View style={styles.rowMedia}>
        <ChannelCover
          url={channel.coverUri}
          handle={channel.handle}
          style={[styles.rowCover, { backgroundColor: colors.surfaceMuted }]}
        />
        <ChannelLogo
          url={channel.avatarUri}
          name={channel.name}
          handle={channel.handle}
          size={40}
          style={[styles.rowAvatar, { borderColor: isDark ? colors.surface : colors.surface }]}
        />
      </View>
      <View style={styles.rowBody}>
        <View style={styles.nameRow}>
          <Text style={[styles.rowName, { color: colors.text }]} numberOfLines={1}>
            {channel.name}
          </Text>
          {channel.verified ? (
            <Ionicons name="checkmark-circle" size={15} color={colors.primary} />
          ) : null}
        </View>
        <Text style={[styles.rowMeta, { color: colors.textSecondary }]} numberOfLines={1}>
          {channel.handle} · {t('discover.members', { count: formatCount(channel.members) })}
        </Text>
        <Text style={[styles.rowDesc, { color: colors.textSecondary }]} numberOfLines={2}>
          {channel.description}
        </Text>
        <View style={styles.rowFooter}>
          <View style={[styles.catChip, { backgroundColor: colors.surfaceMuted }]}>
            <Ionicons name={CAT_ICONS[channel.category]} size={11} color={colors.textSecondary} />
            <Text style={[styles.catChipText, { color: colors.textSecondary }]}>
              {t(`discover.cat_${channel.category}`)}
            </Text>
          </View>
          <Text style={[styles.postsMeta, { color: colors.textMuted }]}>
            {t('discover.posts_count', { count: channel.posts.length })}
          </Text>
        </View>
      </View>
      <FollowButton id={channel.id} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  list: { paddingBottom: Spacing.xxxl, paddingHorizontal: Spacing.xl, gap: Spacing.md },
  emptyList: { flexGrow: 1 },
  headerBlock: { gap: Spacing.md, paddingBottom: Spacing.sm },
  titleBlock: { gap: 4, paddingTop: Spacing.sm },
  kicker: {
    ...Typography.micro,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 1,
  },
  title: { ...Typography.h1, letterSpacing: -0.5 },
  subtitle: { ...Typography.body, lineHeight: 21 },
  searchField: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
    paddingHorizontal: Spacing.md,
    height: 46,
    borderRadius: Radii.xl,
    borderWidth: 1,
  },
  searchInput: { flex: 1, ...Typography.body, fontSize: 15, padding: 0 },
  chips: { gap: Spacing.sm, paddingVertical: 2 },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm,
    borderRadius: Radii.pill,
    borderWidth: 1,
  },
  chipText: { ...Typography.caption, fontWeight: '700' },
  section: { gap: Spacing.sm },
  sectionLabel: {
    ...Typography.micro,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 1,
    marginTop: Spacing.xs,
  },
  featured: {
    width: FEATURED_W,
    height: 220,
    borderRadius: Radii.xl + 4,
    overflow: 'hidden',
    justifyContent: 'space-between',
  },
  featuredScrim: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(11,16,32,0.45)',
  },
  featuredTop: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    padding: Spacing.md,
  },
  livePill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: Radii.pill,
    backgroundColor: 'rgba(0,0,0,0.4)',
  },
  liveDot: { width: 6, height: 6, borderRadius: 3, backgroundColor: '#EF4444' },
  liveText: { ...Typography.micro, color: '#FFF', fontWeight: '700' },
  verifiedPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: Radii.pill,
    backgroundColor: 'rgba(79, 70, 229,0.85)',
  },
  verifiedText: { ...Typography.micro, color: '#FFF', fontWeight: '700' },
  featuredBottom: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: Spacing.sm,
    padding: Spacing.md,
  },
  featuredAvatar: {
    width: 48,
    height: 48,
    borderRadius: Radii.lg,
    borderWidth: 2,
    borderColor: 'rgba(255,255,255,0.5)',
  },
  featuredMeta: { flex: 1, gap: 2 },
  featuredName: { ...Typography.bodyStrong, color: '#FFF', fontSize: 17 },
  featuredSub: { ...Typography.micro, color: 'rgba(255,255,255,0.78)' },
  featuredDesc: { ...Typography.caption, color: 'rgba(255,255,255,0.88)', marginTop: 2 },
  trendRail: { gap: Spacing.sm },
  trendCard: {
    width: TREND_W,
    height: TREND_H,
    borderRadius: Radii.xl,
    overflow: 'hidden',
  },
  trendScrim: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(11,16,32,0.35)',
  },
  trendTop: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    padding: Spacing.sm,
  },
  catMini: {
    width: 26,
    height: 26,
    borderRadius: Radii.pill,
    alignItems: 'center',
    justifyContent: 'center',
  },
  trendBottom: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    padding: Spacing.sm + 2,
    gap: 4,
    backgroundColor: 'rgba(11,16,32,0.5)',
  },
  trendAvatar: { width: 28, height: 28, borderRadius: Radii.sm },
  trendName: { ...Typography.caption, color: '#FFF', fontWeight: '700' },
  trendMembers: { ...Typography.micro, color: 'rgba(255,255,255,0.7)' },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.md,
    padding: Spacing.sm + 2,
    borderRadius: Radii.xl,
    borderWidth: 1,
  },
  rowMedia: { width: 72, height: 72 },
  rowCover: {
    width: 72,
    height: 72,
    borderRadius: Radii.lg,
  },
  rowAvatar: {
    position: 'absolute',
    right: -4,
    bottom: -4,
    width: 28,
    height: 28,
    borderRadius: Radii.sm,
    borderWidth: 2,
  },
  rowBody: { flex: 1, gap: 2 },
  nameRow: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  rowName: { ...Typography.bodyStrong, flexShrink: 1 },
  rowMeta: { ...Typography.micro },
  rowDesc: { ...Typography.caption, marginTop: 1 },
  rowFooter: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
    marginTop: 4,
  },
  catChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: Radii.pill,
  },
  catChipText: { ...Typography.micro, fontWeight: '700', fontSize: 10 },
  postsMeta: { ...Typography.micro },
  fab: {
    position: 'absolute',
    right: Spacing.lg,
    bottom: Spacing.lg,
    width: 58,
    height: 58,
    borderRadius: Radii.pill,
    alignItems: 'center',
    justifyContent: 'center',
    shadowOpacity: 0.35,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 6 },
    elevation: 8,
  },
});
