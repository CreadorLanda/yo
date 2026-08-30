import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { router } from 'expo-router';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Dimensions, FlatList, Pressable, StyleSheet, View } from 'react-native';
import Animated, {
  FadeIn,
  useAnimatedStyle,
  useSharedValue,
  withSpring,
  withTiming,
} from 'react-native-reanimated';

import { Text } from '@/components/ui/text';
import { Radii, Spacing, Typography } from '@/constants/theme';
import { CachedImage } from '@/components/ui/cached-image';
import type { StickerDTO } from '@/data/api/stickers';
import { bootstrapStickers, useRecentStickers, useStickerPacks } from '@/data/sticker-store';
import { useTheme } from '@/hooks/use-theme';
import { t } from '@/i18n';

const COLUMNS = 4;
const RECENTS_TAB = '__recents__';

const AnimatedPressable = Animated.createAnimatedComponent(Pressable);

/**
 * Sticker tray for the composer.
 *
 * Layout follows the convention people already know: a grid of stickers
 * with a row of pack tabs pinned to the bottom, recents first. Animated
 * stickers play in the grid — expo-image decodes animated WebP natively,
 * so no extra runtime is needed.
 */
export function StickerPicker({
  visible,
  onPick,
  height,
}: {
  visible: boolean;
  onPick: (sticker: StickerDTO) => void;
  height: number;
}) {
  const { colors } = useTheme();
  const { packs, loaded } = useStickerPacks();
  const recents = useRecentStickers();
  const [activeTab, setActiveTab] = useState<string>(RECENTS_TAB);
  const pagerRef = useRef<FlatList>(null);

  useEffect(() => {
    if (visible) void bootstrapStickers();
  }, [visible]);

  // Land on the first pack when there is nothing recent to show yet.
  useEffect(() => {
    if (activeTab === RECENTS_TAB && recents.length === 0 && packs.length > 0) {
      setActiveTab(packs[0].id);
    }
  }, [recents.length, packs, activeTab]);

  /**
   * Recents plus every pack, as pages. Swiping sideways moves between
   * packs the same way the tabs do, so the tray behaves like a gallery
   * instead of forcing a tap on the right icon each time.
   */
  const pages = useMemo(
    () => [
      { id: RECENTS_TAB, stickers: recents },
      ...packs.map((p) => ({ id: p.id, stickers: p.stickers ?? [] })),
    ],
    [packs, recents],
  );

  const index = Math.max(0, pages.findIndex((p) => p.id === activeTab));
  const width = Dimensions.get('window').width;
  const size = (width - Spacing.md * 2) / COLUMNS;

  // Keep the pager in step when a tab is tapped.
  useEffect(() => {
    if (!visible) return;
    pagerRef.current?.scrollToIndex({ index, animated: true });
  }, [index, visible]);

  if (!visible) return null;

  return (
    <Animated.View
      entering={FadeIn.duration(140)}
      style={[styles.sheet, { height, backgroundColor: colors.surfaceElevated }]}
    >
      {pages.every((p) => p.stickers.length === 0) ? (
        <EmptyTray hasPacks={packs.length > 0} loaded={loaded} />
      ) : (
        <FlatList
          ref={pagerRef}
          data={pages}
          horizontal
          pagingEnabled
          showsHorizontalScrollIndicator={false}
          keyExtractor={(p) => p.id}
          initialScrollIndex={index}
          getItemLayout={(_d, i) => ({ length: width, offset: width * i, index: i })}
          onMomentumScrollEnd={(e) => {
            const next = Math.round(e.nativeEvent.contentOffset.x / width);
            const page = pages[next];
            if (page && page.id !== activeTab) setActiveTab(page.id);
          }}
          renderItem={({ item: page }) => (
            <View style={{ width }}>
              {page.stickers.length === 0 ? (
                <EmptyTray hasPacks={packs.length > 0} loaded={loaded} />
              ) : (
                <FlatList
                  data={page.stickers}
                  numColumns={COLUMNS}
                  keyExtractor={(s) => `${page.id}:${s.id}`}
                  contentContainerStyle={styles.grid}
                  keyboardShouldPersistTaps="handled"
                  showsVerticalScrollIndicator={false}
                  renderItem={({ item }) => (
                    <StickerCell sticker={item} size={size} onPick={onPick} />
                  )}
                />
              )}
            </View>
          )}
        />
      )}

      {/* Pack tabs */}
      <View style={[styles.tabs, { borderTopColor: colors.divider, backgroundColor: colors.surface }]}>
        <TabButton
          active={activeTab === RECENTS_TAB}
          onPress={() => setActiveTab(RECENTS_TAB)}
          colors={colors}
        >
          <Ionicons
            name="time-outline"
            size={20}
            color={activeTab === RECENTS_TAB ? colors.primary : colors.textMuted}
          />
        </TabButton>

        <FlatList
          data={packs}
          horizontal
          keyExtractor={(p) => p.id}
          showsHorizontalScrollIndicator={false}
          style={styles.tabList}
          renderItem={({ item }) => {
            const active = activeTab === item.id;
            const icon = item.tray_url ?? item.stickers?.[0]?.url;
            return (
              <TabButton active={active} onPress={() => setActiveTab(item.id)} colors={colors}>
                {icon ? (
                  <CachedImage
                    url={icon}
                    style={styles.tabIcon}
                    contentFit="contain"
                    transition={80}
                  />
                ) : (
                  <Ionicons
                    name="happy-outline"
                    size={20}
                    color={active ? colors.primary : colors.textMuted}
                  />
                )}
              </TabButton>
            );
          }}
        />

        <Pressable
          onPress={() => router.push('/stickers')}
          hitSlop={8}
          style={styles.tabAdd}
          accessibilityRole="button"
          accessibilityLabel={t('stickers.manage')}
        >
          <Ionicons name="add" size={22} color={colors.textSecondary} />
        </Pressable>
      </View>
    </Animated.View>
  );
}

/** One sticker. Springs down on press so a tap feels like it landed. */
function StickerCell({
  sticker,
  size,
  onPick,
}: {
  sticker: StickerDTO;
  size: number;
  onPick: (s: StickerDTO) => void;
}) {
  const scale = useSharedValue(1);
  const style = useAnimatedStyle(() => ({ transform: [{ scale: scale.value }] }));

  return (
    <AnimatedPressable
      onPressIn={() => {
        scale.value = withSpring(0.82, { damping: 14, stiffness: 320 });
      }}
      onPressOut={() => {
        scale.value = withSpring(1, { damping: 12, stiffness: 260 });
      }}
      onPress={() => {
        Haptics.selectionAsync().catch(() => {});
        onPick(sticker);
      }}
      style={[{ width: size, height: size, padding: Spacing.xs }, style]}
      accessibilityRole="button"
      accessibilityLabel={sticker.emojis || t('stickers.sticker')}
    >
      <CachedImage
        url={sticker.url}
        style={styles.sticker}
        contentFit="contain"
        transition={100}
      />
    </AnimatedPressable>
  );
}

function TabButton({
  active,
  onPress,
  colors,
  children,
}: {
  active: boolean;
  onPress: () => void;
  colors: ReturnType<typeof useTheme>['colors'];
  children: React.ReactNode;
}) {
  const bg = useSharedValue(active ? 1 : 0);
  useEffect(() => {
    bg.value = withTiming(active ? 1 : 0, { duration: 140 });
  }, [active, bg]);

  const style = useAnimatedStyle(() => ({
    opacity: 0.55 + bg.value * 0.45,
  }));

  return (
    <AnimatedPressable
      onPress={onPress}
      style={[
        styles.tabBtn,
        active && { backgroundColor: colors.surfaceMuted },
        style,
      ]}
    >
      {children}
    </AnimatedPressable>
  );
}

function EmptyTray({ hasPacks, loaded }: { hasPacks: boolean; loaded: boolean }) {
  const { colors } = useTheme();
  return (
    <View style={styles.empty}>
      <Ionicons name="happy-outline" size={40} color={colors.textMuted} />
      <Text style={[styles.emptyTitle, { color: colors.text }]}>
        {hasPacks ? t('stickers.empty_recents') : t('stickers.empty_title')}
      </Text>
      {!hasPacks && loaded ? (
        <Pressable onPress={() => router.push('/stickers')} hitSlop={8}>
          <Text style={[styles.emptyCta, { color: colors.primary }]}>
            {t('stickers.import_cta')}
          </Text>
        </Pressable>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  sheet: {
    borderTopLeftRadius: Radii.lg,
    borderTopRightRadius: Radii.lg,
    overflow: 'hidden',
  },
  grid: {
    padding: Spacing.md,
    paddingBottom: Spacing.sm,
  },
  sticker: {
    width: '100%',
    height: '100%',
  },
  tabs: {
    flexDirection: 'row',
    alignItems: 'center',
    borderTopWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: Spacing.xs,
    height: 52,
  },
  tabList: {
    flex: 1,
  },
  tabBtn: {
    width: 40,
    height: 40,
    borderRadius: Radii.sm,
    alignItems: 'center',
    justifyContent: 'center',
    marginHorizontal: 2,
  },
  tabIcon: {
    width: 26,
    height: 26,
  },
  tabAdd: {
    width: 36,
    height: 36,
    alignItems: 'center',
    justifyContent: 'center',
  },
  empty: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing.sm,
  },
  emptyTitle: {
    ...Typography.bodyStrong,
  },
  emptyCta: {
    ...Typography.body,
    fontWeight: '600',
  },
});
