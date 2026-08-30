import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { Image } from 'expo-image';
import { router } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useMemo, useState } from 'react';
import {
  FlatList,
  Pressable,
  ScrollView,
  StyleSheet,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { formatCount } from '@/components/ui/follow-button';
import { Text, TextInput } from '@/components/ui/text';
import { Radii, Spacing, Typography } from '@/constants/theme';
import { appAlert } from '@/data/dialog-store';
import { APP_ICONS, type AppIconId } from '@/data/theme-app-icons';
import {
  THEME_CATEGORIES,
  applyTheme,
  canChangeAppIcon,
  setAppIcon,
  useAppIcon,
  installTheme,
  toggleLikeTheme,
  useActiveThemeId,
  useInstalledThemeIds,
  useLikedThemeIds,
  useThemeCatalog,
  type ThemeCategory,
  type ThemePack,
} from '@/data/theme-store';
import { useTheme } from '@/hooks/use-theme';
import { t } from '@/i18n';

export default function ThemeMarketplaceScreen() {
  const { colors, isDark } = useTheme();
  const catalog = useThemeCatalog();
  const installed = useInstalledThemeIds();
  const liked = useLikedThemeIds();
  const activeId = useActiveThemeId();

  const [category, setCategory] = useState<ThemeCategory>('all');
  const [query, setQuery] = useState('');

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return catalog.filter((p) => {
      if (category === 'mine' && !p.isOwned) return false;
      if (category !== 'all' && category !== 'mine' && p.category !== category) return false;
      if (!q) return true;
      return (
        p.name.toLowerCase().includes(q) ||
        p.author.toLowerCase().includes(q) ||
        p.description.toLowerCase().includes(q)
      );
    });
  }, [catalog, category, query]);

  const featured = filtered.find((p) => p.isOfficial) ?? filtered[0];
  const rest = filtered.filter((p) => p.id !== featured?.id);

  return (
    <SafeAreaView style={[styles.safe, { backgroundColor: colors.background }]} edges={['top', 'bottom']}>
      <StatusBar style={isDark ? 'light' : 'dark'} />

      <View style={[styles.header, { borderBottomColor: colors.divider }]}>
        <Pressable onPress={() => router.back()} hitSlop={10} style={styles.iconBtn}>
          <Ionicons name="chevron-back" size={24} color={colors.text} />
        </Pressable>
        <View style={{ flex: 1 }}>
          <Text style={[styles.headerTitle, { color: colors.text }]}>{t('themes.title')}</Text>
          <Text style={[styles.headerSub, { color: colors.textSecondary }]}>
            {t('themes.subtitle')}
          </Text>
        </View>
        <Pressable
          onPress={() => router.push('/themes/create')}
          style={[styles.createBtn, { backgroundColor: colors.primary }]}
        >
          <Ionicons name="color-palette" size={16} color={colors.onPrimary} />
          <Text style={[styles.createBtnText, { color: colors.onPrimary }]}>
            {t('themes.create')}
          </Text>
        </Pressable>
      </View>

      <FlatList
        data={rest}
        keyExtractor={(item) => item.id}
        contentContainerStyle={styles.list}
        showsVerticalScrollIndicator={false}
        ListHeaderComponent={
          <View style={styles.listHeader}>
            <View
              style={[
                styles.search,
                { backgroundColor: colors.surfaceMuted, borderColor: colors.border },
              ]}
            >
              <Ionicons name="search" size={16} color={colors.textMuted} />
              <TextInput
                value={query}
                onChangeText={setQuery}
                placeholder={t('themes.search')}
                placeholderTextColor={colors.textMuted}
                style={[styles.searchInput, { color: colors.text }]}
              />
            </View>

            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={styles.chips}
            >
              {THEME_CATEGORIES.map((cat) => {
                const active = category === cat;
                return (
                  <Pressable
                    key={cat}
                    onPress={() => setCategory(cat)}
                    style={[
                      styles.chip,
                      active
                        ? { backgroundColor: colors.primary }
                        : {
                            backgroundColor: colors.surface,
                            borderColor: colors.border,
                          },
                    ]}
                  >
                    <Text
                      style={[
                        styles.chipText,
                        { color: active ? colors.onPrimary : colors.textSecondary },
                      ]}
                    >
                      {t(`themes.cat_${cat}`)}
                    </Text>
                  </Pressable>
                );
              })}
            </ScrollView>

            <AppIconPicker />

            {featured ? (
              <>
                <Text style={[styles.section, { color: colors.textSecondary }]}>
                  {t('themes.featured')}
                </Text>
                <ThemeHero
                  pack={featured}
                  active={activeId === featured.id}
                  installed={installed.has(featured.id) || !!featured.isOwned}
                  liked={liked.has(featured.id)}
                />
              </>
            ) : null}

            <Text style={[styles.section, { color: colors.textSecondary }]}>
              {t('themes.browse')}
            </Text>
          </View>
        }
        renderItem={({ item }) => (
          <ThemeRow
            pack={item}
            active={activeId === item.id}
            installed={installed.has(item.id) || !!item.isOwned}
            liked={liked.has(item.id)}
          />
        )}
        ListEmptyComponent={
          <Text style={[styles.empty, { color: colors.textMuted }]}>{t('themes.empty')}</Text>
        }
      />
    </SafeAreaView>
  );
}

function ThemeHero({
  pack,
  active,
  installed,
  liked,
}: {
  pack: ThemePack;
  active: boolean;
  installed: boolean;
  liked: boolean;
}) {
  const { colors } = useTheme();
  return (
    <View
      style={[
        styles.hero,
        { backgroundColor: colors.surface, borderColor: active ? colors.primary : colors.border },
      ]}
    >
      <SwatchStrip colors={pack.swatches} tall />
      <View style={styles.heroBody}>
        <View style={styles.heroTop}>
          <View style={{ flex: 1 }}>
            <View style={styles.nameRow}>
              <Text style={[styles.heroName, { color: colors.text }]} numberOfLines={1}>
                {pack.name}
              </Text>
              {pack.isOfficial ? (
                <Ionicons name="checkmark-circle" size={15} color={colors.primary} />
              ) : null}
              {pack.isOwned ? (
                <View style={[styles.ownedPill, { backgroundColor: `${colors.primary}18` }]}>
                  <Text style={[styles.ownedText, { color: colors.primary }]}>
                    {t('themes.yours')}
                  </Text>
                </View>
              ) : null}
            </View>
            <Text style={[styles.author, { color: colors.textSecondary }]}>
              {/* A pack that ships with the app has no install count to show,
                  and inventing one — this card used to claim 128,400 — tells
                  the reader something about popularity that is not true. */}
              {pack.author} ·{' '}
              {pack.isOfficial
                ? t('themes.bundled')
                : `${formatCount(pack.downloads)} ${t('themes.installs')}`}
            </Text>
          </View>
          <Pressable onPress={() => toggleLikeTheme(pack.id)} hitSlop={8}>
            <Ionicons
              name={liked ? 'heart' : 'heart-outline'}
              size={20}
              color={liked ? '#FF3040' : colors.textMuted}
            />
          </Pressable>
        </View>
        <Text style={[styles.desc, { color: colors.textSecondary }]} numberOfLines={2}>
          {pack.description}
        </Text>
        <View style={styles.heroActions}>
          <ActionButton
            label={
              active
                ? t('themes.active')
                : installed
                  ? t('themes.apply')
                  : t('themes.install')
            }
            primary
            done={active}
            onPress={() => {
              Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
              if (!installed) installTheme(pack.id);
              applyTheme(pack.id);
            }}
          />
          <ActionButton
            label={pack.isOwned ? t('themes.edit') : t('themes.customize')}
            onPress={() =>
              router.push(
                pack.isOwned
                  ? { pathname: '/themes/create', params: { edit: pack.id } }
                  : { pathname: '/themes/create', params: { fork: pack.id } },
              )
            }
          />
        </View>
      </View>
    </View>
  );
}

function ThemeRow({
  pack,
  active,
  installed,
  liked,
}: {
  pack: ThemePack;
  active: boolean;
  installed: boolean;
  liked: boolean;
}) {
  const { colors } = useTheme();
  return (
    <View
      style={[
        styles.row,
        {
          backgroundColor: colors.surface,
          borderColor: active ? colors.primary : colors.border,
        },
      ]}
    >
      <SwatchStrip colors={pack.swatches} />
      <View style={styles.rowBody}>
        <View style={styles.nameRow}>
          <Text style={[styles.rowName, { color: colors.text }]} numberOfLines={1}>
            {pack.name}
          </Text>
          {active ? (
            <View style={[styles.activeDot, { backgroundColor: colors.primary }]} />
          ) : null}
        </View>
        <Text style={[styles.author, { color: colors.textSecondary }]} numberOfLines={1}>
          {pack.author} · {formatCount(pack.likes)} ♥
        </Text>
      </View>
      <Pressable onPress={() => toggleLikeTheme(pack.id)} hitSlop={6} style={styles.likeBtn}>
        <Ionicons
          name={liked ? 'heart' : 'heart-outline'}
          size={18}
          color={liked ? '#FF3040' : colors.textMuted}
        />
      </Pressable>
      <Pressable
        onPress={() => {
          Haptics.selectionAsync();
          router.push(
            pack.isOwned
              ? { pathname: '/themes/create', params: { edit: pack.id } }
              : { pathname: '/themes/create', params: { fork: pack.id } },
          );
        }}
        hitSlop={6}
        style={styles.likeBtn}
      >
        <Ionicons name="create-outline" size={18} color={colors.textMuted} />
      </Pressable>
      <Pressable
        onPress={() => {
          Haptics.selectionAsync();
          if (!installed) installTheme(pack.id);
          applyTheme(pack.id);
        }}
        style={[
          styles.rowCta,
          {
            backgroundColor: active ? colors.surfaceMuted : colors.primary,
            borderColor: active ? colors.border : colors.primary,
          },
        ]}
      >
        <Text
          style={[
            styles.rowCtaText,
            { color: active ? colors.text : colors.onPrimary },
          ]}
        >
          {active ? t('themes.active') : installed ? t('themes.apply') : t('themes.get')}
        </Text>
      </Pressable>
    </View>
  );
}

function SwatchStrip({ colors: swatches, tall }: { colors: string[]; tall?: boolean }) {
  return (
    <View style={[styles.swatches, tall && styles.swatchesTall]}>
      {swatches.slice(0, 4).map((c, i) => (
        <View
          key={`${c}-${i}`}
          style={[
            tall ? styles.swatchTall : styles.swatch,
            { backgroundColor: c, marginLeft: i === 0 ? 0 : tall ? -10 : -6 },
            { zIndex: 4 - i },
          ]}
        />
      ))}
    </View>
  );
}

function ActionButton({
  label,
  onPress,
  primary,
  done,
}: {
  label: string;
  onPress: () => void;
  primary?: boolean;
  done?: boolean;
}) {
  const { colors } = useTheme();
  return (
    <Pressable
      onPress={onPress}
      disabled={done}
      style={[
        styles.actionBtn,
        {
          backgroundColor: primary
            ? done
              ? colors.surfaceMuted
              : colors.primary
            : 'transparent',
          borderColor: primary ? 'transparent' : colors.border,
        },
      ]}
    >
      <Text
        style={[
          styles.actionBtnText,
          {
            color: primary
              ? done
                ? colors.text
                : colors.onPrimary
              : colors.text,
          },
        ]}
      >
        {label}
      </Text>
    </Pressable>
  );
}

/**
 * The four alternate launcher icons, drawn from the same artwork as the packs
 * they are named for.
 *
 * Rendered only where it can actually work. Alternate icons need the config
 * plugin to have run through a prebuild, so in Expo Go and on the web the
 * native side is simply not there — and a row of tiles that silently do
 * nothing is worse than no row at all.
 */
const ICON_PREVIEWS: Record<AppIconId, number> = {
  default: require('@/assets/images/icon.png'),
  sunset: require('@/assets/images/app-icons/sunset.png'),
  phosphor: require('@/assets/images/app-icons/phosphor.png'),
  sakura: require('@/assets/images/app-icons/sakura.png'),
  void: require('@/assets/images/app-icons/void.png'),
};

function AppIconPicker() {
  const { colors } = useTheme();
  const current = useAppIcon();

  if (!canChangeAppIcon()) return null;

  return (
    <>
      <Text style={[styles.section, { color: colors.textSecondary }]}>
        {t('themes.app_icon')}
      </Text>
      <Text style={[styles.appIconHint, { color: colors.textMuted }]}>
        {t('themes.app_icon_hint')}
      </Text>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.chips}
      >
        {APP_ICONS.map((icon) => {
          const active = current === icon.id;
          return (
            <Pressable
              key={icon.id}
              onPress={() => {
                Haptics.selectionAsync().catch(() => {});
                // iOS shows a system dialog here that can be declined, so the
                // tile only moves once the swap has actually happened.
                setAppIcon(icon.id).then((ok) => {
                  if (!ok) appAlert(t('themes.app_icon'), t('themes.app_icon_failed'));
                });
              }}
              style={styles.appIconCell}
              accessibilityRole="button"
              accessibilityState={{ selected: active }}
              accessibilityLabel={icon.label}
            >
              <Image
                source={ICON_PREVIEWS[icon.id]}
                style={[
                  styles.appIconImage,
                  { borderColor: active ? colors.primary : colors.border },
                  active && styles.appIconImageActive,
                ]}
                contentFit="cover"
              />
              <Text
                style={[
                  styles.appIconLabel,
                  { color: active ? colors.primary : colors.textSecondary },
                ]}
                numberOfLines={1}
              >
                {icon.label}
              </Text>
            </Pressable>
          );
        })}
      </ScrollView>
    </>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1 },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm,
    borderBottomWidth: StyleSheet.hairlineWidth,
    gap: Spacing.sm,
  },
  iconBtn: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
  headerTitle: { ...Typography.bodyStrong, fontSize: 16 },
  headerSub: { ...Typography.micro },
  createBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: Spacing.md,
    height: 34,
    borderRadius: Radii.pill,
  },
  createBtnText: { ...Typography.caption, fontWeight: '700' },
  list: { padding: Spacing.lg, gap: Spacing.md, paddingBottom: Spacing.xxxl },
  listHeader: { gap: Spacing.md, marginBottom: Spacing.sm },
  search: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
    height: 44,
    borderRadius: Radii.xl,
    borderWidth: 1,
    paddingHorizontal: Spacing.md,
  },
  searchInput: { flex: 1, ...Typography.body, fontSize: 15, padding: 0 },
  chips: { gap: Spacing.sm },
  chip: {
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm,
    borderRadius: Radii.pill,
    borderWidth: 1,
    borderColor: 'transparent',
  },
  chipText: { ...Typography.caption, fontWeight: '700' },
  appIconHint: {
    ...Typography.caption,
    marginBottom: Spacing.sm,
  },
  appIconCell: {
    alignItems: 'center',
    gap: 6,
    width: 74,
  },
  appIconImage: {
    width: 60,
    height: 60,
    borderRadius: 14,
    borderWidth: 1,
  },
  appIconImageActive: {
    borderWidth: 2,
  },
  appIconLabel: {
    ...Typography.micro,
    textAlign: 'center',
  },
  section: {
    ...Typography.micro,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 0.8,
    marginTop: Spacing.xs,
  },
  hero: {
    borderRadius: Radii.xl,
    borderWidth: 1.5,
    overflow: 'hidden',
  },
  heroBody: { padding: Spacing.md, gap: Spacing.sm },
  heroTop: { flexDirection: 'row', alignItems: 'flex-start', gap: Spacing.sm },
  nameRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  heroName: { ...Typography.h3, fontSize: 18, flexShrink: 1 },
  ownedPill: {
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: Radii.pill,
  },
  ownedText: { ...Typography.micro, fontWeight: '700' },
  author: { ...Typography.caption },
  desc: { ...Typography.caption, lineHeight: 18 },
  heroActions: { flexDirection: 'row', gap: Spacing.sm, marginTop: 4 },
  actionBtn: {
    paddingHorizontal: Spacing.lg,
    height: 36,
    borderRadius: Radii.pill,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
  },
  actionBtnText: { ...Typography.caption, fontWeight: '700' },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.md,
    padding: Spacing.sm + 2,
    borderRadius: Radii.xl,
    borderWidth: 1.5,
  },
  rowBody: { flex: 1, gap: 2 },
  rowName: { ...Typography.bodyStrong, fontSize: 14 },
  activeDot: { width: 7, height: 7, borderRadius: 4 },
  likeBtn: { padding: 4 },
  rowCta: {
    paddingHorizontal: Spacing.md,
    height: 32,
    borderRadius: Radii.pill,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
  },
  rowCtaText: { ...Typography.micro, fontWeight: '700' },
  swatches: { flexDirection: 'row', alignItems: 'center', paddingLeft: 4 },
  swatchesTall: {
    height: 72,
    paddingHorizontal: Spacing.md,
    paddingTop: Spacing.md,
  },
  swatch: {
    width: 28,
    height: 28,
    borderRadius: 14,
    borderWidth: 2,
    borderColor: 'rgba(255,255,255,0.9)',
  },
  swatchTall: {
    width: 40,
    height: 40,
    borderRadius: 20,
    borderWidth: 2,
    borderColor: 'rgba(255,255,255,0.9)',
  },
  empty: { ...Typography.body, textAlign: 'center', padding: Spacing.xxl },
});
