import {
  createMaterialTopTabNavigator,
  type MaterialTopTabBarProps,
} from '@react-navigation/material-top-tabs';
import { Image } from 'expo-image';
import { router, withLayoutContext } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { Animated, Pressable, StyleSheet, View, type LayoutChangeEvent } from 'react-native';
import { useState } from 'react';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';

import { AppIcon } from '@/components/ui/app-icon';
import { GlassSurface } from '@/components/ui/glass-surface';
import { LiquidBackdrop } from '@/components/ui/liquid-backdrop';
import { Text } from '@/components/ui/text';
import { Radii, Sizes, Spacing, Typography } from '@/constants/theme';
import { isLiquidLayout, withAlpha } from '@/data/theme-model';
import { useProfile } from '@/data/profile-store';
import { useTheme } from '@/hooks/use-theme';
import { t } from '@/i18n';

const { Navigator } = createMaterialTopTabNavigator();
const MaterialTopTabs = withLayoutContext(Navigator);

export default function TabLayout() {
  const { colors, isDark, layout } = useTheme();
  const profile = useProfile();

  // Liquid overrides the header style: the flow has to run behind the header
  // as well as the list, or the screen reads as a lid on a lava lamp.
  const liquid = isLiquidLayout(layout);

  // headerStyle from theme packs (GB-style): brand | minimal | colored
  const headerBg = liquid
    ? 'transparent'
    : layout.headerStyle === 'minimal'
      ? colors.background
      : layout.headerStyle === 'colored'
        ? colors.primary
        : isDark
          ? colors.surface
          : colors.primary;
  const headerFg =
    liquid || layout.headerStyle === 'minimal'
      ? colors.text
      : layout.headerStyle === 'colored' || !isDark
        ? colors.onPrimary
        : colors.text;
  const headerMuted =
    liquid || layout.headerStyle === 'minimal'
      ? colors.textMuted
      : layout.headerStyle === 'colored' || !isDark
        ? 'rgba(255,255,255,0.65)'
        : colors.textMuted;
  const indicatorColor =
    liquid || layout.headerStyle === 'minimal' || isDark ? colors.primary : colors.onPrimary;

  // Where the switcher sits, and what it shows. Both were theme knobs the
  // creator has always offered and nothing ever read — a person could set the
  // tab bar to the bottom and watch it stay exactly where it was.
  const tabsAtBottom = layout.tabBarPosition === 'bottom';
  const showLabels = layout.tabBarLabels !== 'icons';
  const showIcons = layout.tabBarLabels !== 'labels';

  // The status bar follows the header, not the scheme: a minimal header in
  // light mode is pale, and white status icons on it disappear.
  const statusStyle = headerFg === colors.text ? (isDark ? 'light' : 'dark') : 'light';

  return (
    <SafeAreaView
      style={[styles.safe, { backgroundColor: liquid ? colors.background : headerBg }]}
      // The bottom bar pads itself for the home indicator, so its own
      // surface runs to the edge instead of stopping above a strip of header
      // colour.
      edges={['top']}
    >
      <StatusBar style={statusStyle} />
      {liquid ? (
        <LiquidBackdrop
          tint={colors.primary}
          accent={colors.info}
          base={colors.background}
          dark={isDark}
        />
      ) : null}

      <View style={[styles.header, { backgroundColor: headerBg }]}>
        <View style={styles.brandRow}>
          <Pressable
            onPress={() => router.push('/profile')}
            hitSlop={8}
            accessibilityLabel={t('profile.title')}
          >
            <Image
              source={{ uri: profile.avatarUri }}
              style={[
                styles.headerAvatar,
                {
                  borderColor:
                    headerFg === colors.text ? colors.border : 'rgba(255,255,255,0.35)',
                },
              ]}
              contentFit="cover"
            />
          </Pressable>
          <Text style={[styles.brand, { color: headerFg }]}>ZwoSocial</Text>
        </View>
        {/* On liquid the actions sit in one glass capsule, the way the
            system groups toolbar buttons over moving content. */}
        <HeaderActions liquid={liquid}>
          <Pressable hitSlop={8} style={styles.iconBtn} onPress={() => router.push('/search')} accessibilityLabel={t('common.search')}>
            <AppIcon slot="search" size={22} color={headerFg} />
          </Pressable>
          <Pressable
            hitSlop={8}
            style={styles.iconBtn}
            onPress={() => router.push('/calls')}
            accessibilityLabel={t('calls.title')}
          >
            <AppIcon slot="calls" size={22} color={headerFg} />
          </Pressable>
          <Pressable
            hitSlop={8}
            style={styles.iconBtn}
            onPress={() => router.push('/settings')}
            accessibilityLabel={t('settings.title')}
          >
            <AppIcon slot="settings" size={21} color={headerFg} />
          </Pressable>
        </HeaderActions>
      </View>

      <MaterialTopTabs
        tabBarPosition={tabsAtBottom ? 'bottom' : 'top'}
        // At the bottom the strip becomes a navigation bar: the swipeable
        // pager stays, but an underline in the gesture area is not how
        // anybody expects bottom navigation to look.
        tabBar={
          tabsAtBottom
            ? (props: MaterialTopTabBarProps) => (
                liquid ? (
                  <LiquidNavBar {...props} showLabels={showLabels} showIcons={showIcons} />
                ) : (
                  <BottomNavBar {...props} showLabels={showLabels} showIcons={showIcons} />
                )
              )
            : undefined
        }
        screenOptions={{
          sceneStyle: { backgroundColor: liquid ? 'transparent' : colors.background },
          tabBarStyle: [
            styles.tabBar,
            {
              backgroundColor: headerBg,
              borderBottomWidth: liquid ? 0 : StyleSheet.hairlineWidth,
              borderBottomColor: colors.divider,
            },
          ],
          tabBarIndicatorStyle: [styles.indicator, { backgroundColor: indicatorColor }],
          tabBarLabelStyle: styles.tabLabel,
          tabBarActiveTintColor: headerFg,
          tabBarInactiveTintColor: headerMuted,
          tabBarPressColor:
            headerFg === colors.text ? withAlpha(colors.text, 0.06) : 'rgba(255,255,255,0.12)',
          tabBarShowLabel: showLabels,
          tabBarShowIcon: showIcons,
          swipeEnabled: true,
          animationEnabled: true,
          lazy: false,
          lazyPreloadDistance: 2,
        }}
      >
        <MaterialTopTabs.Screen
          name="index"
          options={{
            title: t('tabs.chats'),
            tabBarIcon: ({ color }: { color: string }) => <AppIcon slot="chats" size={20} color={color} />,
          }}
        />
        <MaterialTopTabs.Screen
          name="stories"
          options={{
            title: t('tabs.stories'),
            tabBarIcon: ({ color }: { color: string }) => <AppIcon slot="stories" size={20} color={color} />,
          }}
        />
        <MaterialTopTabs.Screen
          name="explore"
          options={{
            title: t('tabs.discover'),
            tabBarIcon: ({ color }: { color: string }) => <AppIcon slot="discover" size={20} color={color} />,
          }}
        />
      </MaterialTopTabs>
    </SafeAreaView>
  );
}

function BottomNavBar({
  state,
  descriptors,
  navigation,
  showLabels,
  showIcons,
}: MaterialTopTabBarProps & { showLabels: boolean; showIcons: boolean }) {
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();

  return (
    <View
      style={[
        styles.bottomBar,
        {
          backgroundColor: colors.surface,
          borderTopColor: colors.divider,
          paddingBottom: insets.bottom,
        },
      ]}
      accessibilityRole="tablist"
    >
      {state.routes.map((route, index) => {
        const focused = state.index === index;
        const { options } = descriptors[route.key];
        const label = typeof options.title === 'string' ? options.title : route.name;
        const color = focused ? colors.primary : colors.textSecondary;

        const onPress = () => {
          const event = navigation.emit({
            type: 'tabPress',
            target: route.key,
            canPreventDefault: true,
          });
          if (!focused && !event.defaultPrevented) navigation.navigate(route.name);
        };

        return (
          <Pressable
            key={route.key}
            onPress={onPress}
            style={styles.bottomItem}
            accessibilityRole="tab"
            accessibilityState={{ selected: focused }}
            accessibilityLabel={label}
          >
            {showIcons ? (
              <View
                style={[
                  styles.bottomPill,
                  focused && { backgroundColor: withAlpha(colors.primary, 0.14) },
                ]}
              >
                {options.tabBarIcon?.({ focused, color })}
              </View>
            ) : null}
            {showLabels ? (
              <Text
                style={[
                  styles.bottomLabel,
                  { color: focused ? colors.text : colors.textSecondary },
                  focused && styles.bottomLabelActive,
                ]}
                numberOfLines={1}
              >
                {label}
              </Text>
            ) : null}
          </Pressable>
        );
      })}
    </View>
  );
}

function HeaderActions({ liquid, children }: { liquid: boolean; children: React.ReactNode }) {
  const { colors } = useTheme();
  // Only liquid gets glass here. Other glass themes frost the chat chrome,
  // and a blurred rectangle behind three icons on a solid header is noise.
  if (!liquid) return <View style={styles.headerActions}>{children}</View>;
  return (
    <GlassSurface
      color={colors.surface}
      style={[
        styles.headerActions,
        styles.headerCapsule,
        { borderColor: withAlpha(colors.text, 0.12) },
      ]}
    >
      {children}
    </GlassSurface>
  );
}

/**
 * The bottom bar as a floating sheet of glass.
 *
 * The selection is one shape that travels, driven by the pager's own
 * position, so it follows a swipe under the finger rather than jumping when
 * the swipe ends. Halfway between two tabs it stretches, the way a drop of
 * liquid elongates as it is pulled, and settles back to its width when it
 * arrives.
 */
function LiquidNavBar({
  state,
  descriptors,
  navigation,
  position,
  showLabels,
  showIcons,
}: MaterialTopTabBarProps & { showLabels: boolean; showIcons: boolean }) {
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const [width, setWidth] = useState(0);

  const count = state.routes.length;
  const itemW = width > 0 ? (width - CAPSULE_PAD * 2) / count : 0;

  const steps: number[] = [];
  const shifts: number[] = [];
  const stretch: number[] = [];
  for (let i = 0; i < count; i++) {
    steps.push(i);
    shifts.push(i * itemW);
    stretch.push(1);
    if (i < count - 1) {
      steps.push(i + 0.5);
      shifts.push((i + 0.5) * itemW);
      stretch.push(1.32);
    }
  }
  const animated = count > 1 && itemW > 0;

  return (
    <View
      style={[styles.liquidWrap, { paddingBottom: Math.max(insets.bottom, Spacing.md) }]}
      accessibilityRole="tablist"
    >
      <GlassSurface
        color={colors.surface}
        style={[styles.capsule, { borderColor: withAlpha(colors.text, 0.12) }]}
      >
        <View
          style={styles.capsuleRow}
          onLayout={(e: LayoutChangeEvent) => setWidth(e.nativeEvent.layout.width)}
        >
          {animated ? (
            <Animated.View
              pointerEvents="none"
              style={[
                styles.liquidIndicator,
                {
                  width: itemW,
                  backgroundColor: withAlpha(colors.primary, 0.2),
                  borderColor: withAlpha(colors.primary, 0.35),
                  transform: [
                    { translateX: position.interpolate({ inputRange: steps, outputRange: shifts }) },
                    { scaleX: position.interpolate({ inputRange: steps, outputRange: stretch }) },
                  ],
                },
              ]}
            />
          ) : null}

          {state.routes.map((route, index) => {
            const focused = state.index === index;
            const { options } = descriptors[route.key];
            const label = typeof options.title === 'string' ? options.title : route.name;

            const onPress = () => {
              const event = navigation.emit({
                type: 'tabPress',
                target: route.key,
                canPreventDefault: true,
              });
              if (!focused && !event.defaultPrevented) navigation.navigate(route.name);
            };

            return (
              <Pressable
                key={route.key}
                onPress={onPress}
                style={styles.liquidItem}
                accessibilityRole="tab"
                accessibilityState={{ selected: focused }}
                accessibilityLabel={label}
              >
                {showIcons
                  ? options.tabBarIcon?.({
                      focused,
                      color: focused ? colors.primary : colors.textSecondary,
                    })
                  : null}
                {showLabels ? (
                  <Text
                    style={[
                      styles.bottomLabel,
                      { color: focused ? colors.text : colors.textSecondary },
                      focused && styles.bottomLabelActive,
                    ]}
                    numberOfLines={1}
                  >
                    {label}
                  </Text>
                ) : null}
              </Pressable>
            );
          })}
        </View>
        {/* The lit rim along the top edge, what makes a translucent panel
            read as a thickness of glass instead of a tinted hole. */}
        <View
          pointerEvents="none"
          style={[styles.capsuleRim, { backgroundColor: withAlpha('#FFFFFF', 0.28) }]}
        />
      </GlassSurface>
    </View>
  );
}

const CAPSULE_PAD = 6;

const styles = StyleSheet.create({
  safe: {
    flex: 1,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingLeft: Spacing.lg,
    paddingRight: Spacing.sm,
    height: 56,
  },
  brandRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.md,
  },
  headerAvatar: {
    width: Sizes.headerAvatar,
    height: Sizes.headerAvatar,
    borderRadius: Radii.pill,
    borderWidth: StyleSheet.hairlineWidth,
  },
  brand: {
    ...Typography.h2,
  },
  headerActions: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  iconBtn: {
    width: Sizes.hitTarget,
    height: Sizes.hitTarget,
    borderRadius: Radii.pill,
    alignItems: 'center',
    justifyContent: 'center',
  },
  tabBar: {
    elevation: 0,
    shadowOpacity: 0,
    borderBottomWidth: 0,
  },
  indicator: {
    height: 3,
    borderTopLeftRadius: 2,
    borderTopRightRadius: 2,
  },
  tabLabel: {
    ...Typography.label,
    fontSize: 14,
    textTransform: 'none',
  },

  bottomBar: {
    flexDirection: 'row',
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  bottomItem: {
    flex: 1,
    height: Sizes.tabBar,
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing.xs,
  },
  bottomPill: {
    width: 56,
    height: 30,
    borderRadius: Radii.pill,
    alignItems: 'center',
    justifyContent: 'center',
  },
  bottomLabel: {
    ...Typography.micro,
  },
  bottomLabelActive: {
    fontWeight: '600',
  },

  headerCapsule: {
    borderRadius: Radii.pill,
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: Spacing.xxs,
  },
  liquidWrap: {
    paddingHorizontal: Spacing.xl,
    paddingTop: Spacing.sm,
    backgroundColor: 'transparent',
  },
  capsule: {
    height: Sizes.tabBar,
    borderRadius: Radii.pill,
    borderWidth: StyleSheet.hairlineWidth,
  },
  capsuleRow: {
    flex: 1,
    flexDirection: 'row',
    padding: CAPSULE_PAD,
  },
  capsuleRim: {
    position: 'absolute',
    top: 0,
    left: Spacing.xl,
    right: Spacing.xl,
    height: StyleSheet.hairlineWidth,
  },
  liquidIndicator: {
    position: 'absolute',
    top: CAPSULE_PAD,
    bottom: CAPSULE_PAD,
    left: CAPSULE_PAD,
    borderRadius: Radii.pill,
    borderWidth: StyleSheet.hairlineWidth,
  },
  liquidItem: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing.xxs,
  },
});
