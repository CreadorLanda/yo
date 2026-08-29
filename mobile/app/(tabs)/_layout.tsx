import { createMaterialTopTabNavigator } from '@react-navigation/material-top-tabs';
import { Image } from 'expo-image';
import { router, withLayoutContext } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { AppIcon } from '@/components/ui/app-icon';
import { Radii, Spacing, Typography } from '@/constants/theme';
import { useProfile } from '@/data/profile-store';
import { useTheme } from '@/hooks/use-theme';
import { t } from '@/i18n';

const { Navigator } = createMaterialTopTabNavigator();
const MaterialTopTabs = withLayoutContext(Navigator);

export default function TabLayout() {
  const { colors, isDark, layout } = useTheme();
  const profile = useProfile();

  // headerStyle from theme packs (GB-style): brand | minimal | colored
  const headerBg =
    layout.headerStyle === 'minimal'
      ? colors.background
      : layout.headerStyle === 'colored'
        ? colors.primary
        : isDark
          ? colors.surface
          : colors.primary;
  const headerFg =
    layout.headerStyle === 'minimal'
      ? colors.text
      : layout.headerStyle === 'colored' || !isDark
        ? colors.onPrimary
        : colors.text;
  const headerMuted =
    layout.headerStyle === 'minimal'
      ? colors.textMuted
      : layout.headerStyle === 'colored' || !isDark
        ? 'rgba(255,255,255,0.65)'
        : colors.textMuted;
  const indicatorColor =
    layout.headerStyle === 'minimal' || isDark ? colors.primary : colors.onPrimary;

  // Where the switcher sits, and what it shows. Both were theme knobs the
  // creator has always offered and nothing ever read — a person could set the
  // tab bar to the bottom and watch it stay exactly where it was.
  const tabsAtBottom = layout.tabBarPosition === 'bottom';
  const showLabels = layout.tabBarLabels !== 'icons';
  const showIcons = layout.tabBarLabels !== 'labels';

  return (
    <SafeAreaView
      style={[styles.safe, { backgroundColor: headerBg }]}
      // A bar at the bottom has to clear the home indicator; one at the top
      // never touched it.
      edges={tabsAtBottom ? ['top', 'bottom'] : ['top']}
    >
      <StatusBar style="light" />

      <View
        style={[
          styles.header,
          { backgroundColor: headerBg },
          isDark && { borderBottomWidth: 1, borderBottomColor: colors.divider },
        ]}
      >
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
                { borderColor: isDark ? colors.border : 'rgba(255,255,255,0.35)' },
              ]}
              contentFit="cover"
            />
          </Pressable>
          <Text style={[styles.brand, { color: headerFg }]}>Yo</Text>
        </View>
        <View style={styles.headerActions}>
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
        </View>
      </View>

      <MaterialTopTabs
        tabBarPosition={tabsAtBottom ? 'bottom' : 'top'}
        screenOptions={{
          sceneStyle: { backgroundColor: colors.background },
          tabBarStyle: [
            styles.tabBar,
            { backgroundColor: headerBg },
            isDark && { borderBottomWidth: 1, borderBottomColor: colors.divider },
          ],
          tabBarIndicatorStyle: [
            styles.indicator,
            { backgroundColor: indicatorColor },
            // The indicator marks the edge the bar meets the content on, so
            // it swaps ends with the bar. Left at the bottom, it reads as an
            // underline floating in the gesture area.
            tabsAtBottom && { top: 0, bottom: undefined },
          ],
          tabBarLabelStyle: styles.tabLabel,
          tabBarActiveTintColor: headerFg,
          tabBarInactiveTintColor: headerMuted,
          tabBarPressColor: isDark ? 'rgba(255,255,255,0.06)' : 'rgba(255,255,255,0.12)',
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

const styles = StyleSheet.create({
  safe: {
    flex: 1,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: Spacing.lg,
    paddingVertical: Spacing.sm,
  },
  brandRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
  },
  headerAvatar: {
    width: 34,
    height: 34,
    borderRadius: Radii.pill,
    borderWidth: 1,
  },
  brand: {
    ...Typography.h2,
    letterSpacing: -0.3,
  },
  headerActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.xs,
  },
  iconBtn: {
    width: 38,
    height: 38,
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
    ...Typography.bodyStrong,
    textTransform: 'none',
    fontSize: 14,
  },
});
