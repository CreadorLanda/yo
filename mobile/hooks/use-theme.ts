import { useMemo } from 'react';
import { useColorScheme as useSystemScheme } from 'react-native';

import type { ThemeIcons } from '@/data/theme-icons';
import { isLiquidLayout } from '@/data/theme-model';
import {
  getResolvedChat,
  getResolvedColors,
  getResolvedIcons,
  getResolvedLayout,
  layoutMetrics,
  useActiveThemeId,
  useSchemePreference,
  useThemeStoreRev,
  type ChatChrome,
  type ThemeLayout,
  type ThemeTokens,
} from '@/data/theme-store';

/**
 * App theme hook.
 * Merges marketplace packs + personal GB-style overrides.
 */
export function useTheme() {
  const system = useSystemScheme() ?? 'light';
  const pref = useSchemePreference();
  const activeId = useActiveThemeId();
  const rev = useThemeStoreRev();

  const scheme = pref === 'system' ? (system === 'dark' ? 'dark' : 'light') : pref;

  const colors = useMemo(
    () => getResolvedColors(scheme) as ThemeTokens,
    // rev invalidates every pack / chrome / personal change
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [scheme, activeId, pref, rev],
  );

  const layout = useMemo(
    () => getResolvedLayout() as ThemeLayout,
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [activeId, rev],
  );

  const chat = useMemo(
    () => getResolvedChat(scheme) as ChatChrome,
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [scheme, activeId, pref, rev],
  );

  const icons = useMemo(
    () => getResolvedIcons() as ThemeIcons,
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [activeId, rev],
  );

  const metrics = useMemo(() => layoutMetrics(layout), [layout]);

  // What a top-level screen paints its ground with. Normally the background;
  // under liquid, nothing, so the flow drawn behind the tab shell shows.
  // Only screens that live inside that shell should use it: a pushed screen
  // that went transparent would show the one under it.
  const canvas = isLiquidLayout(layout) ? 'transparent' : colors.background;

  return {
    scheme,
    colors,
    chat,
    layout,
    icons,
    metrics,
    canvas,
    isDark: scheme === 'dark',
    activeThemeId: activeId,
    schemePreference: pref,
  };
}
