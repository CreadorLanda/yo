import { Ionicons, MaterialIcons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { Image } from 'expo-image';
import * as ImagePicker from 'expo-image-picker';
import { router, useLocalSearchParams } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useEffect, useMemo, useState, type ReactNode } from 'react';
import {
  Pressable,
  ScrollView,
  StyleSheet,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Text, TextInput } from '@/components/ui/text';
import { Radii, Spacing, Typography } from '@/constants/theme';
import { appAlert } from '@/data/dialog-store';
import { persistThemeImage } from '@/data/theme-assets';
import { loadFontFamily } from '@/data/theme-font-assets';
import { FONT_FAMILIES, type FontFamilyId } from '@/data/theme-fonts';
import {
  ICON_SETS,
  ICON_SLOTS,
  resolveIcon,
  type IconSet,
  type IconSlot,
  type ThemeIcons,
} from '@/data/theme-icons';
import {
  BUBBLE_SHAPES,
  COMPOSER_STYLES,
  CSS_THEME_TEMPLATE,
  DATE_PILL_STYLES,
  DEFAULT_LAYOUT,
  DENSITIES,
  REPLY_STYLES,
  SEND_STYLES,
  SYSTEM_STYLES,
  WALLPAPER_ANIMATIONS,
  bubbleRadii,
  createThemePack,
  forkTheme,
  generateThemeFromAiPrompt,
  getPackById,
  type BubbleShape,
  type ChatChrome,
  type ComposerStyle,
  type DatePillStyle,
  type MessageDensity,
  type ReplyStyle,
  type SendButtonStyle,
  type SystemMsgStyle,
  type ThemeLayout,
  type ThemeMode,
  type ThemePack,
  type WallpaperAnimation,
} from '@/data/theme-store';
import { useTheme } from '@/hooks/use-theme';
import { t } from '@/i18n';

const PRESET_PRIMARIES = [
  '#4F46E5', '#EF4444', '#F59E0B', '#10B981', '#06B6D4', '#2D5BFF',
  '#EC4899', '#A3E635', '#F97316', '#171717', '#E879F9', '#FB8A7E',
];
const PRESET_BACKGROUNDS_LIGHT = ['#F7F9FC', '#FFF8F5', '#F0FDFA', '#FDF4FF', '#FAFAFA', '#F7F6F1', '#EEF1F6'];
const PRESET_BACKGROUNDS_DARK = ['#0E0F13', '#07080C', '#120814', '#050605', '#0A0A0A', '#12150F', '#131419'];
const WALLPAPERS_LIGHT = ['#EEF1F6', '#E8F5E9', '#FFF3E0', '#E3F2FD', '#F3E5F5', '#FCE4EC', '#E0F7FA', '#FFFDE7'];
const WALLPAPERS_DARK = ['#0E0F13', '#12141C', '#0A0C09', '#160A18', '#0C0E14', '#181210', '#042F2E', '#1A1F16'];

type DesignMode = ThemeMode | 'both';
type EditorTab =
  | 'colors'
  | 'chat'
  | 'layout'
  | 'positions'
  | 'icons'
  | 'effects'
  | 'css'
  | 'ai';

export default function ThemeCreatorScreen() {
  const { colors, isDark } = useTheme();
  const params = useLocalSearchParams<{ edit?: string; fork?: string }>();

  const source = useMemo(() => {
    const id = params.edit || params.fork;
    return id ? getPackById(String(id)) : undefined;
  }, [params.edit, params.fork]);

  const editingOwned = !!(params.edit && source?.isOwned);
  const forking = !!(params.fork && source);

  const [tab, setTab] = useState<EditorTab>('colors');
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [designMode, setDesignMode] = useState<DesignMode>('both');
  const [primary, setPrimary] = useState('#4F46E5');
  const [background, setBackground] = useState(isDark ? '#0E0F13' : '#F7F9FC');
  const [surface, setSurface] = useState(isDark ? '#191A21' : '#FFFFFF');
  const [text, setText] = useState(isDark ? '#ECEDF2' : '#111827');
  const [category, setCategory] = useState<ThemePack['category']>('minimal');
  const [chat, setChat] = useState<Partial<ChatChrome>>({});
  const [layout, setLayout] = useState<ThemeLayout>({ ...DEFAULT_LAYOUT });
  const [icons, setIcons] = useState<ThemeIcons>({});
  const [customCss, setCustomCss] = useState(CSS_THEME_TEMPLATE);
  const [aiPrompt, setAiPrompt] = useState('');
  const [aiBusy, setAiBusy] = useState(false);

  useEffect(() => {
    if (!source) return;
    const schemeKey: ThemeMode = isDark ? 'dark' : 'light';
    const tok = source.tokens[schemeKey] ?? source.tokens.light ?? source.tokens.dark ?? {};
    setName(editingOwned ? source.name : forking ? `${source.name}`.slice(0, 32) : source.name);
    setDescription(source.description);
    setCategory(source.category);
    if (tok.primary) setPrimary(tok.primary);
    if (tok.background) setBackground(tok.background);
    if (tok.surface) setSurface(tok.surface);
    if (tok.text) setText(tok.text);
    setLayout({ ...DEFAULT_LAYOUT, ...source.layout });
    const ch = source.chat?.[schemeKey] ?? source.chat?.light ?? source.chat?.dark ?? {};
    setChat({ ...ch });
    setIcons({ ...(source.icons ?? {}) });
    if (source.customCss) setCustomCss(source.customCss);
    if (source.aiPrompt) setAiPrompt(source.aiPrompt);
    if (forking) setName(`${source.name} (edit)`.slice(0, 40));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [source?.id]);

  const bgOptions = designMode === 'dark' ? PRESET_BACKGROUNDS_DARK : PRESET_BACKGROUNDS_LIGHT;
  const wallOptions = designMode === 'dark' ? WALLPAPERS_DARK : WALLPAPERS_LIGHT;
  const canSave = name.trim().length >= 2;

  const bubbleMine = chat.bubbleMine ?? primary;
  const bubbleTheirs = chat.bubbleTheirs ?? surface;
  const wallpaper = chat.wallpaper ?? (designMode === 'dark' ? '#131419' : '#EEF1F6');
  const wallpaperImage = chat.wallpaperImage ?? '';
  const textMine = chat.textMine ?? (designMode === 'dark' ? background : '#FFFFFF');
  const textTheirs = chat.textTheirs ?? text;

  const previewRadiiMine = bubbleRadii(layout, true, true, layout.myBubbleSide);
  const previewRadiiTheirs = bubbleRadii(layout, false, true, layout.myBubbleSide);
  const mineEnd = layout.myBubbleSide === 'right';
  const fontSize = Math.round(14 * layout.fontScale);

  const patchLayout = <K extends keyof ThemeLayout>(key: K, value: ThemeLayout[K]) => {
    setLayout((prev) => ({ ...prev, [key]: value }));
  };

  const pickWallpaperPhoto = async () => {
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'],
      quality: 0.85,
      allowsEditing: true,
      aspect: [9, 16],
    });
    if (result.canceled || !result.assets[0]) return;
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    // Copied out of the picker's cache first. Storing the cache URI is how a
    // wallpaper survives until the OS reclaims the directory and the theme
    // comes back with a grey rectangle where the photo was.
    const stored = await persistThemeImage(result.assets[0].uri);
    setChat((p) => ({ ...p, wallpaperImage: stored }));
  };

  const pickSlotIcon = async (slot: IconSlot) => {
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'],
      quality: 0.9,
      allowsEditing: true,
      aspect: [1, 1],
    });
    if (result.canceled || !result.assets[0]) return;
    Haptics.selectionAsync().catch(() => {});
    const stored = await persistThemeImage(result.assets[0].uri);
    setIcons((prev) => ({ ...prev, [slot]: stored }));
  };

  const clearSlotIcon = (slot: IconSlot) => {
    setIcons((prev) => ({ ...prev, [slot]: '' }));
  };

  const clearWallpaperPhoto = () => {
    setChat((p) => ({ ...p, wallpaperImage: '' }));
  };

  const runAi = () => {
    if (aiPrompt.trim().length < 3) {
      appAlert(t('themes.ai_title'), t('themes.ai_need_prompt'));
      return;
    }
    setAiBusy(true);
    // Tiny delay so the button feels intentional
    setTimeout(() => {
      const draft = generateThemeFromAiPrompt(aiPrompt);
      setName(draft.name);
      setDescription(draft.description);
      setCategory(draft.category);
      setPrimary(draft.primary);
      setBackground(draft.background);
      setSurface(draft.surface);
      setText(draft.text);
      setDesignMode(draft.mode);
      setChat((prev) => ({ ...prev, ...draft.chat }));
      setLayout((prev) => ({ ...prev, ...draft.layout }));
      setCustomCss(draft.customCss);
      setAiBusy(false);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      setTab('colors');
    }, 420);
  };

  const save = () => {
    if (!canSave) {
      appAlert(t('themes.creator_title'), t('themes.creator_need_name'));
      return;
    }
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);

    let editId = editingOwned ? String(params.edit) : undefined;
    let forkFromId = forking ? String(params.fork) : undefined;

    if (params.edit && source && !source.isOwned) {
      const forked = forkTheme(source.id, ' (edit)');
      if (forked) {
        editId = forked.id;
        forkFromId = source.id;
      }
    }

    createThemePack({
      name,
      description,
      category,
      mode: designMode,
      primary,
      background,
      surface,
      text,
      chat: {
        wallpaper,
        wallpaperImage,
        bubbleMine,
        bubbleTheirs,
        textMine,
        textTheirs,
        ...chat,
      },
      layout,
      icons,
      customCss,
      aiPrompt: aiPrompt || undefined,
      editId,
      forkFromId: editId ? undefined : forkFromId,
    });
    router.replace('/themes');
  };

  const tabs: { id: EditorTab; label: string; icon: keyof typeof Ionicons.glyphMap }[] = [
    { id: 'colors', label: t('themes.tab_colors'), icon: 'color-palette' },
    { id: 'chat', label: t('themes.tab_chat'), icon: 'chatbubbles' },
    { id: 'layout', label: t('themes.tab_layout'), icon: 'shapes' },
    { id: 'positions', label: t('themes.tab_positions'), icon: 'move' },
    { id: 'icons', label: t('themes.tab_icons'), icon: 'apps' },
    { id: 'effects', label: t('themes.tab_effects'), icon: 'sparkles' },
    { id: 'css', label: t('themes.tab_css'), icon: 'code-slash' },
    { id: 'ai', label: t('themes.tab_ai'), icon: 'hardware-chip' },
  ];

  return (
    <SafeAreaView style={[styles.safe, { backgroundColor: colors.background }]} edges={['top', 'bottom']}>
      <StatusBar style={isDark ? 'light' : 'dark'} />

      <View style={[styles.header, { borderBottomColor: colors.divider }]}>
        <Pressable onPress={() => router.back()} hitSlop={10} style={styles.iconBtn}>
          <Ionicons name="close" size={24} color={colors.text} />
        </Pressable>
        <View style={{ flex: 1 }}>
          <Text style={[styles.headerTitle, { color: colors.text }]}>
            {editingOwned
              ? t('themes.edit_title')
              : forking
                ? t('themes.fork_title')
                : t('themes.creator_title')}
          </Text>
          <Text style={[styles.headerSub, { color: colors.textSecondary }]}>
            {t('themes.creator_gb_hint')}
          </Text>
        </View>
        <Pressable
          onPress={save}
          disabled={!canSave}
          style={[
            styles.saveBtn,
            { backgroundColor: canSave ? colors.primary : colors.surfaceMuted },
          ]}
        >
          <Text style={[styles.saveText, { color: canSave ? colors.onPrimary : colors.textMuted }]}>
            {t('themes.save_apply')}
          </Text>
        </Pressable>
      </View>

      {/* Live preview */}
      <View style={[styles.preview, { backgroundColor: wallpaper, borderColor: colors.border }]}>
        {wallpaperImage ? (
          <Image
            source={{ uri: wallpaperImage }}
            style={StyleSheet.absoluteFill}
            contentFit="cover"
          />
        ) : null}
        {wallpaperImage || layout.wallpaperDim > 0 ? (
          <View
            pointerEvents="none"
            style={[
              StyleSheet.absoluteFill,
              { backgroundColor: `#000000${Math.round((layout.wallpaperDim / 100) * 255)
                .toString(16)
                .padStart(2, '0')}` },
            ]}
          />
        ) : null}
        {layout.wallpaperPattern ? (
          <View style={styles.patternOverlay} pointerEvents="none">
            {Array.from({ length: 18 }).map((_, i) => (
              <View
                key={i}
                style={[
                  styles.patternDot,
                  {
                    left: `${(i * 37) % 100}%`,
                    top: `${(i * 53) % 100}%`,
                    backgroundColor: `${primary}22`,
                  },
                ]}
              />
            ))}
          </View>
        ) : null}
        <View style={[styles.previewMsgRow, { justifyContent: mineEnd ? 'flex-start' : 'flex-end' }]}>
          <View
            style={[
              styles.previewBubble,
              {
                backgroundColor: bubbleTheirs,
                maxWidth: `${layout.fullWidthBubbles ? 92 : layout.bubbleMaxWidth}%`,
                paddingHorizontal: layout.bubblePaddingH,
                paddingVertical: layout.bubblePaddingV,
                opacity: layout.dimIncoming ? 0.85 : 1,
                ...previewRadiiTheirs,
                ...(layout.bubbleShadow
                  ? {
                      shadowColor: '#000',
                      shadowOpacity: 0.04 + layout.bubbleShadowStrength * 0.12,
                      shadowRadius: 6,
                      shadowOffset: { width: 0, height: 2 },
                      elevation: 2,
                    }
                  : null),
              },
            ]}
          >
            <Text
              font={layout.fontFamily}
              style={{
                color: textTheirs,
                fontSize,
                lineHeight: fontSize + 4 + layout.lineHeightExtra,
                letterSpacing: layout.letterSpacing,
              }}
            >
              {t('themes.preview_theirs')}
            </Text>
            <Text style={{ color: `${textTheirs}99`, fontSize: layout.metaSize, alignSelf: 'flex-end' }}>
              10:21
            </Text>
          </View>
        </View>
        <View style={[styles.previewMsgRow, { justifyContent: mineEnd ? 'flex-end' : 'flex-start' }]}>
          <View
            style={[
              styles.previewBubble,
              {
                backgroundColor: bubbleMine,
                maxWidth: `${layout.fullWidthBubbles ? 92 : layout.bubbleMaxWidth}%`,
                paddingHorizontal: layout.bubblePaddingH,
                paddingVertical: layout.bubblePaddingV,
                ...previewRadiiMine,
              },
            ]}
          >
            <Text
              font={layout.fontFamily}
              style={{
                color: textMine,
                fontSize,
                lineHeight: fontSize + 4 + layout.lineHeightExtra,
                letterSpacing: layout.letterSpacing,
                fontWeight: layout.boldOutgoing ? '700' : '400',
              }}
            >
              {t('themes.preview_mine')}
            </Text>
            <Text style={{ color: `${textMine}AA`, fontSize: layout.metaSize, alignSelf: 'flex-end' }}>
              10:22 ✓✓
            </Text>
          </View>
        </View>
      </View>

      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.tabs}
        style={{ borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.divider }}
      >
        {tabs.map((item) => {
          const active = tab === item.id;
          return (
            <Pressable
              key={item.id}
              onPress={() => setTab(item.id)}
              style={[
                styles.tab,
                active && { backgroundColor: `${colors.primary}18`, borderColor: colors.primary },
                !active && { borderColor: colors.border, backgroundColor: colors.surface },
              ]}
            >
              <Ionicons name={item.icon} size={15} color={active ? colors.primary : colors.textSecondary} />
              <Text
                style={{
                  ...Typography.caption,
                  fontWeight: '700',
                  fontSize: 13,
                  color: active ? colors.primary : colors.textSecondary,
                }}
              >
                {item.label}
              </Text>
            </Pressable>
          );
        })}
      </ScrollView>

      <ScrollView contentContainerStyle={styles.body} keyboardShouldPersistTaps="handled">
        {tab === 'colors' ? (
          <>
            <Label color={colors.textSecondary}>{t('themes.field_name')}</Label>
            <TextInput
              value={name}
              onChangeText={setName}
              placeholder={t('themes.field_name_ph')}
              placeholderTextColor={colors.textMuted}
              style={[styles.input, { color: colors.text, backgroundColor: colors.surfaceMuted }]}
              maxLength={40}
            />
            <Label color={colors.textSecondary}>{t('themes.field_desc')}</Label>
            <TextInput
              value={description}
              onChangeText={setDescription}
              placeholder={t('themes.field_desc_ph')}
              placeholderTextColor={colors.textMuted}
              style={[styles.input, { color: colors.text, backgroundColor: colors.surfaceMuted }]}
              maxLength={120}
            />
            <Label color={colors.textSecondary}>{t('themes.design_for')}</Label>
            <Segment
              options={[
                ['both', t('themes.mode_both')],
                ['light', t('themes.mode_light')],
                ['dark', t('themes.mode_dark')],
              ]}
              value={designMode}
              onChange={setDesignMode}
              colors={colors}
            />
            <Label color={colors.textSecondary}>{t('themes.primary')}</Label>
            <ColorRow
              options={PRESET_PRIMARIES}
              value={primary}
              onChange={(c) => {
                setPrimary(c);
                setChat((prev) => ({ ...prev, bubbleMine: c, sendBtnBg: c }));
              }}
              ring={colors.border}
            />
            <Label color={colors.textSecondary}>{t('themes.background')}</Label>
            <ColorRow
              options={bgOptions}
              value={background}
              onChange={(c) => {
                setBackground(c);
                setSurface(designMode === 'dark' ? blendPreview(c, '#FFFFFF', 0.08) : '#FFFFFF');
              }}
              ring={colors.border}
            />
            <Label color={colors.textSecondary}>{t('themes.surface')}</Label>
            <ColorRow
              options={[surface, ...bgOptions, '#FFFFFF', '#191A21', '#1C0F20']}
              value={surface}
              onChange={setSurface}
              ring={colors.border}
            />
            <Label color={colors.textSecondary}>{t('themes.text_color')}</Label>
            <ColorRow
              options={['#111827', '#0A0A0A', '#ECEDF2', '#F8FAFC', '#1C1412', '#F0FDFA']}
              value={text}
              onChange={setText}
              ring={colors.border}
            />
            <Label color={colors.textSecondary}>{t('themes.category')}</Label>
            <ChipRow
              options={(['minimal', 'neon', 'pastel', 'nature', 'midnight'] as const).map((c) => ({
                id: c,
                label: t(`themes.cat_${c}`),
              }))}
              value={category}
              onChange={setCategory}
              colors={colors}
            />
          </>
        ) : null}

        {tab === 'chat' ? (
          <>
            <Text style={[styles.sectionLead, { color: colors.textSecondary }]}>
              {t('themes.chat_lead')}
            </Text>

            <Label color={colors.textSecondary}>{t('themes.wallpaper_photo')}</Label>
            <View style={styles.photoRow}>
              <Pressable
                onPress={pickWallpaperPhoto}
                style={[styles.photoBtn, { backgroundColor: colors.primary }]}
              >
                <Ionicons name="image" size={18} color={colors.onPrimary} />
                <Text style={[styles.photoBtnText, { color: colors.onPrimary }]}>
                  {wallpaperImage ? t('themes.change_photo') : t('themes.pick_photo')}
                </Text>
              </Pressable>
              {wallpaperImage ? (
                <Pressable
                  onPress={clearWallpaperPhoto}
                  style={[styles.photoBtn, { backgroundColor: colors.surfaceMuted }]}
                >
                  <Ionicons name="trash-outline" size={18} color={colors.danger} />
                  <Text style={[styles.photoBtnText, { color: colors.danger }]}>
                    {t('themes.remove_photo')}
                  </Text>
                </Pressable>
              ) : null}
            </View>
            {wallpaperImage ? (
              <Image
                source={{ uri: wallpaperImage }}
                style={[styles.photoThumb, { borderColor: colors.border }]}
                contentFit="cover"
              />
            ) : null}

            <Label color={colors.textSecondary}>
              {t('themes.wallpaper_dim')}: {layout.wallpaperDim}%
            </Label>
            <StepRow
              value={layout.wallpaperDim}
              min={0}
              max={80}
              step={5}
              onChange={(v) => patchLayout('wallpaperDim', v)}
              colors={colors}
            />

            <Label color={colors.textSecondary}>{t('themes.wallpaper')}</Label>
            <ColorRow
              options={wallOptions}
              value={wallpaper}
              onChange={(c) => setChat((p) => ({ ...p, wallpaper: c }))}
              ring={colors.border}
            />
            <ToggleRow
              label={t('themes.wallpaper_pattern')}
              value={layout.wallpaperPattern}
              onChange={(v) => patchLayout('wallpaperPattern', v)}
              colors={colors}
            />
            <ToggleRow
              label={t('themes.wallpaper_blur')}
              value={layout.wallpaperBlur}
              onChange={(v) => patchLayout('wallpaperBlur', v)}
              colors={colors}
            />
            <Label color={colors.textSecondary}>{t('themes.wallpaper_animation')}</Label>
            <ChipRow
              options={WALLPAPER_ANIMATIONS.map((a) => ({
                id: a,
                label: t(`themes.wallpaper_anim_${a}`),
              }))}
              value={layout.wallpaperAnimation}
              onChange={(v) => patchLayout('wallpaperAnimation', v as WallpaperAnimation)}
              colors={colors}
            />
            <Text style={[styles.cssHint, { color: colors.textMuted }]}>
              {t('themes.wallpaper_animation_hint')}
            </Text>

            <Label color={colors.textSecondary}>{t('themes.bubble_mine')}</Label>
            <ColorRow
              options={[...PRESET_PRIMARIES, bubbleMine]}
              value={bubbleMine}
              onChange={(c) => setChat((p) => ({ ...p, bubbleMine: c }))}
              ring={colors.border}
            />
            <Label color={colors.textSecondary}>{t('themes.bubble_theirs')}</Label>
            <ColorRow
              options={[surface, '#FFFFFF', '#191A21', '#1A1D28', '#171B15', bubbleTheirs]}
              value={bubbleTheirs}
              onChange={(c) => setChat((p) => ({ ...p, bubbleTheirs: c }))}
              ring={colors.border}
            />
            <Label color={colors.textSecondary}>{t('themes.text_mine')}</Label>
            <ColorRow
              options={['#FFFFFF', '#0A0A0A', '#0B0C10', '#F4FFE8', textMine]}
              value={textMine}
              onChange={(c) => setChat((p) => ({ ...p, textMine: c }))}
              ring={colors.border}
            />
            <Label color={colors.textSecondary}>{t('themes.text_theirs')}</Label>
            <ColorRow
              options={['#111827', '#ECEDF2', '#F8FAFC', textTheirs]}
              value={textTheirs}
              onChange={(c) => setChat((p) => ({ ...p, textTheirs: c }))}
              ring={colors.border}
            />
            <Label color={colors.textSecondary}>{t('themes.send_btn_color')}</Label>
            <ColorRow
              options={[...PRESET_PRIMARIES, chat.sendBtnBg ?? primary]}
              value={chat.sendBtnBg ?? primary}
              onChange={(c) => setChat((p) => ({ ...p, sendBtnBg: c }))}
              ring={colors.border}
            />
          </>
        ) : null}

        {tab === 'layout' ? (
          <>
            <Text style={[styles.sectionLead, { color: colors.textSecondary }]}>
              {t('themes.layout_lead')}
            </Text>
            <Label color={colors.textSecondary}>{t('themes.bubble_shape')}</Label>
            <ChipRow
              options={BUBBLE_SHAPES.map((s) => ({ id: s, label: t(`themes.shape_${s}`) }))}
              value={layout.bubbleShape}
              onChange={(s) => {
                patchLayout('bubbleShape', s as BubbleShape);
                if (s === 'square' || s === 'pill') patchLayout('showTails', false);
                if (s === 'tail') patchLayout('showTails', true);
              }}
              colors={colors}
            />
            <ToggleRow label={t('themes.show_tails')} value={layout.showTails} onChange={(v) => patchLayout('showTails', v)} colors={colors} />
            <Label color={colors.textSecondary}>{t('themes.bubble_radius')}: {layout.bubbleRadius}</Label>
            <StepRow value={layout.bubbleRadius} min={4} max={28} step={2} onChange={(v) => patchLayout('bubbleRadius', v)} colors={colors} />
            <Label color={colors.textSecondary}>{t('themes.bubble_pad_h')}: {layout.bubblePaddingH}</Label>
            <StepRow value={layout.bubblePaddingH} min={6} max={22} step={1} onChange={(v) => patchLayout('bubblePaddingH', v)} colors={colors} />
            <Label color={colors.textSecondary}>{t('themes.bubble_pad_v')}: {layout.bubblePaddingV}</Label>
            <StepRow value={layout.bubblePaddingV} min={4} max={18} step={1} onChange={(v) => patchLayout('bubblePaddingV', v)} colors={colors} />
            <Label color={colors.textSecondary}>{t('themes.font_family')}</Label>
            <ChipRow
              options={FONT_FAMILIES.map((f) => ({ id: f.id, label: f.label }))}
              value={layout.fontFamily}
              onChange={(v) => {
                const id = v as FontFamilyId;
                // Register the faces now so the preview above changes on this
                // tap rather than on the one after it.
                loadFontFamily(id).catch(() => {});
                patchLayout('fontFamily', id);
              }}
              colors={colors}
            />
            <Text style={[styles.cssHint, { color: colors.textMuted }]}>
              {t('themes.font_family_hint')}
            </Text>
            <Label color={colors.textSecondary}>{t('themes.font_scale')}: {Math.round(layout.fontScale * 100)}%</Label>
            <StepRow value={Math.round(layout.fontScale * 100)} min={85} max={135} step={5} onChange={(v) => patchLayout('fontScale', v / 100)} colors={colors} />
            <Label color={colors.textSecondary}>{t('themes.letter_spacing')}: {layout.letterSpacing}</Label>
            <StepRow value={Math.round(layout.letterSpacing * 10)} min={-5} max={15} step={1} onChange={(v) => patchLayout('letterSpacing', v / 10)} colors={colors} />
            <Label color={colors.textSecondary}>{t('themes.line_extra')}: {layout.lineHeightExtra}</Label>
            <StepRow value={layout.lineHeightExtra} min={0} max={8} step={1} onChange={(v) => patchLayout('lineHeightExtra', v)} colors={colors} />
            <Label color={colors.textSecondary}>{t('themes.bubble_width')}: {layout.bubbleMaxWidth}%</Label>
            <StepRow value={layout.bubbleMaxWidth} min={60} max={92} step={2} onChange={(v) => patchLayout('bubbleMaxWidth', v)} colors={colors} />
            <ToggleRow label={t('themes.full_width')} value={layout.fullWidthBubbles} onChange={(v) => patchLayout('fullWidthBubbles', v)} colors={colors} />
            <Label color={colors.textSecondary}>{t('themes.density')}</Label>
            <ChipRow
              options={DENSITIES.map((d) => ({ id: d, label: t(`themes.density_${d}`) }))}
              value={layout.density}
              onChange={(d) => patchLayout('density', d as MessageDensity)}
              colors={colors}
            />
            <Label color={colors.textSecondary}>{t('themes.composer_style')}</Label>
            <ChipRow
              options={COMPOSER_STYLES.map((s) => ({ id: s, label: t(`themes.composer_${s}`) }))}
              value={layout.composerStyle}
              onChange={(s) => patchLayout('composerStyle', s as ComposerStyle)}
              colors={colors}
            />
            <Label color={colors.textSecondary}>{t('themes.send_style')}</Label>
            <ChipRow
              options={SEND_STYLES.map((s) => ({ id: s, label: t(`themes.send_${s}`) }))}
              value={layout.sendButtonStyle}
              onChange={(s) => patchLayout('sendButtonStyle', s as SendButtonStyle)}
              colors={colors}
            />
            <Label color={colors.textSecondary}>{t('themes.input_radius')}: {layout.inputRadius}</Label>
            <StepRow value={layout.inputRadius} min={8} max={28} step={2} onChange={(v) => patchLayout('inputRadius', v)} colors={colors} />
            <Label color={colors.textSecondary}>{t('themes.reply_style')}</Label>
            <ChipRow
              options={REPLY_STYLES.map((s) => ({ id: s, label: t(`themes.reply_${s}`) }))}
              value={layout.replyStyle}
              onChange={(s) => patchLayout('replyStyle', s as ReplyStyle)}
              colors={colors}
            />
            <Label color={colors.textSecondary}>{t('themes.date_pill_style')}</Label>
            <ChipRow
              options={DATE_PILL_STYLES.map((s) => ({ id: s, label: t(`themes.date_${s}`) }))}
              value={layout.datePillStyle}
              onChange={(s) => patchLayout('datePillStyle', s as DatePillStyle)}
              colors={colors}
            />
            <Label color={colors.textSecondary}>{t('themes.system_style')}</Label>
            <ChipRow
              options={SYSTEM_STYLES.map((s) => ({ id: s, label: t(`themes.system_${s}`) }))}
              value={layout.systemMsgStyle}
              onChange={(s) => patchLayout('systemMsgStyle', s as SystemMsgStyle)}
              colors={colors}
            />
          </>
        ) : null}

        {tab === 'positions' ? (
          <>
            <Text style={[styles.sectionLead, { color: colors.textSecondary }]}>
              {t('themes.positions_lead')}
            </Text>
            <Label color={colors.textSecondary}>{t('themes.my_side')}</Label>
            <Segment
              options={[['right', t('themes.side_right')], ['left', t('themes.side_left')]]}
              value={layout.myBubbleSide}
              onChange={(v) => patchLayout('myBubbleSide', v as 'left' | 'right')}
              colors={colors}
            />
            <Label color={colors.textSecondary}>{t('themes.avatar_pos')}</Label>
            <ChipRow
              options={[
                { id: 'left', label: t('themes.pos_left') },
                { id: 'right', label: t('themes.pos_right') },
                { id: 'hidden', label: t('themes.pos_hidden') },
              ]}
              value={layout.avatarPosition}
              onChange={(v) => patchLayout('avatarPosition', v as ThemeLayout['avatarPosition'])}
              colors={colors}
            />
            <Label color={colors.textSecondary}>{t('themes.check_pos')}</Label>
            <Segment
              options={[['left', t('themes.pos_left')], ['right', t('themes.pos_right')]]}
              value={layout.selectionCheckSide}
              onChange={(v) => patchLayout('selectionCheckSide', v as 'left' | 'right')}
              colors={colors}
            />
            <Label color={colors.textSecondary}>{t('themes.attach_side')}</Label>
            <Segment
              options={[['left', t('themes.pos_left')], ['right', t('themes.pos_right')]]}
              value={layout.attachSide}
              onChange={(v) => patchLayout('attachSide', v as 'left' | 'right')}
              colors={colors}
            />
            <Label color={colors.textSecondary}>{t('themes.tab_bar_pos')}</Label>
            <Segment
              options={[['top', t('themes.pos_top')], ['bottom', t('themes.pos_bottom')]]}
              value={layout.tabBarPosition}
              onChange={(v) => patchLayout('tabBarPosition', v as 'top' | 'bottom')}
              colors={colors}
            />
            <Label color={colors.textSecondary}>{t('themes.tab_bar_labels')}</Label>
            <ChipRow
              options={[
                { id: 'labels', label: t('themes.tab_labels_labels') },
                { id: 'icons', label: t('themes.tab_labels_icons') },
                { id: 'both', label: t('themes.tab_labels_both') },
              ]}
              value={layout.tabBarLabels}
              onChange={(v) => patchLayout('tabBarLabels', v as ThemeLayout['tabBarLabels'])}
              colors={colors}
            />
            <Label color={colors.textSecondary}>{t('themes.header_style')}</Label>
            <ChipRow
              options={[
                { id: 'brand', label: t('themes.header_brand') },
                { id: 'minimal', label: t('themes.header_minimal') },
                { id: 'colored', label: t('themes.header_colored') },
              ]}
              value={layout.headerStyle}
              onChange={(v) => patchLayout('headerStyle', v as ThemeLayout['headerStyle'])}
              colors={colors}
            />
            <Label color={colors.textSecondary}>{t('themes.list_avatar')}: {layout.listAvatarSize}</Label>
            <StepRow value={layout.listAvatarSize} min={36} max={64} step={2} onChange={(v) => patchLayout('listAvatarSize', v)} colors={colors} />
            <Label color={colors.textSecondary}>{t('themes.gap_group')}: {layout.gapAfterGroup}</Label>
            <StepRow value={layout.gapAfterGroup} min={2} max={16} step={1} onChange={(v) => patchLayout('gapAfterGroup', v)} colors={colors} />
            <ToggleRow label={t('themes.center_dates')} value={layout.centerDatePills} onChange={(v) => patchLayout('centerDatePills', v)} colors={colors} />
            <ToggleRow label={t('themes.chat_header_compact')} value={layout.chatHeaderCompact} onChange={(v) => patchLayout('chatHeaderCompact', v)} colors={colors} />
          </>
        ) : null}

        {tab === 'icons' ? (
          <>
            <Text style={[styles.sectionLead, { color: colors.textSecondary }]}>
              {t('themes.icons_lead')}
            </Text>
            <Label color={colors.textSecondary}>{t('themes.icon_set')}</Label>
            <ChipRow
              options={ICON_SETS.map((set) => ({ id: set, label: t(`themes.icon_set_${set}`) }))}
              value={layout.iconSet}
              onChange={(v) => patchLayout('iconSet', v as IconSet)}
              colors={colors}
            />
            <Label color={colors.textSecondary}>
              {t('themes.icon_scale')}: {Math.round(layout.iconScale * 100)}%
            </Label>
            <StepRow
              value={Math.round(layout.iconScale * 100)}
              min={80}
              max={140}
              step={5}
              onChange={(v) => patchLayout('iconScale', v / 100)}
              colors={colors}
            />
            <Label color={colors.textSecondary}>{t('themes.icon_custom')}</Label>
            <Text style={[styles.cssHint, { color: colors.textMuted }]}>
              {t('themes.icon_custom_hint')}
            </Text>
            <View style={styles.iconGrid}>
              {ICON_SLOTS.map((slot) => {
                const drawn = resolveIcon(slot, layout.iconSet, icons);
                return (
                  <View
                    key={slot}
                    style={[styles.iconCell, { backgroundColor: colors.surfaceMuted }]}
                  >
                    <Pressable
                      onPress={() => pickSlotIcon(slot)}
                      style={[styles.iconPreview, { backgroundColor: colors.surface }]}
                      accessibilityLabel={t(`themes.slot_${slot}`)}
                    >
                      {drawn.kind === 'image' ? (
                        <Image
                          source={{ uri: drawn.uri }}
                          style={styles.iconPreviewImage}
                          contentFit="contain"
                        />
                      ) : drawn.glyph.family === 'material' ? (
                        <MaterialIcons
                          name={drawn.glyph.name as keyof typeof MaterialIcons.glyphMap}
                          size={22}
                          color={colors.text}
                        />
                      ) : (
                        <Ionicons
                          name={drawn.glyph.name as keyof typeof Ionicons.glyphMap}
                          size={22}
                          color={colors.text}
                        />
                      )}
                    </Pressable>
                    <Text style={[styles.iconCellLabel, { color: colors.textSecondary }]} numberOfLines={1}>
                      {t(`themes.slot_${slot}`)}
                    </Text>
                    {icons[slot] ? (
                      <Pressable onPress={() => clearSlotIcon(slot)} hitSlop={6}>
                        <Text style={[styles.iconCellReset, { color: colors.primary }]}>
                          {t('themes.icon_reset')}
                        </Text>
                      </Pressable>
                    ) : null}
                  </View>
                );
              })}
            </View>
          </>
        ) : null}

        {tab === 'effects' ? (
          <>
            <Text style={[styles.sectionLead, { color: colors.textSecondary }]}>
              {t('themes.effects_lead')}
            </Text>
            <ToggleRow label={t('themes.amoled')} value={layout.amoledBlack} onChange={(v) => patchLayout('amoledBlack', v)} colors={colors} />
            <Text style={[styles.cssHint, { color: colors.textMuted }]}>
              {t('themes.amoled_hint')}
            </Text>
            <ToggleRow label={t('themes.glass')} value={layout.glassChrome} onChange={(v) => patchLayout('glassChrome', v)} colors={colors} />
            <Text style={[styles.cssHint, { color: colors.textMuted }]}>
              {t('themes.glass_hint')}
            </Text>
            {layout.glassChrome ? (
              <>
                <Label color={colors.textSecondary}>{t('themes.glass_intensity')}: {layout.glassIntensity}</Label>
                <StepRow value={layout.glassIntensity} min={10} max={100} step={5} onChange={(v) => patchLayout('glassIntensity', v)} colors={colors} />
              </>
            ) : null}
            <ToggleRow label={t('themes.bubble_shadow')} value={layout.bubbleShadow} onChange={(v) => patchLayout('bubbleShadow', v)} colors={colors} />
            <Label color={colors.textSecondary}>{t('themes.shadow_strength')}: {Math.round(layout.bubbleShadowStrength * 100)}%</Label>
            <StepRow value={Math.round(layout.bubbleShadowStrength * 100)} min={0} max={100} step={10} onChange={(v) => patchLayout('bubbleShadowStrength', v / 100)} colors={colors} />
            <Label color={colors.textSecondary}>{t('themes.emoji_scale')}: {Math.round(layout.emojiScale * 100)}%</Label>
            <StepRow value={Math.round(layout.emojiScale * 100)} min={80} max={160} step={5} onChange={(v) => patchLayout('emojiScale', v / 100)} colors={colors} />
            <Label color={colors.textSecondary}>{t('themes.reaction_scale')}: {Math.round(layout.reactionScale * 100)}%</Label>
            <StepRow value={Math.round(layout.reactionScale * 100)} min={80} max={150} step={5} onChange={(v) => patchLayout('reactionScale', v / 100)} colors={colors} />
            <Label color={colors.textSecondary}>{t('themes.meta_size')}: {layout.metaSize}</Label>
            <StepRow value={layout.metaSize} min={10} max={14} step={1} onChange={(v) => patchLayout('metaSize', v)} colors={colors} />
            <ToggleRow label={t('themes.large_timestamps')} value={layout.largeTimestamps} onChange={(v) => patchLayout('largeTimestamps', v)} colors={colors} />
            <ToggleRow label={t('themes.timestamp_inside')} value={layout.timestampInside} onChange={(v) => patchLayout('timestampInside', v)} colors={colors} />
            <ToggleRow label={t('themes.bold_outgoing')} value={layout.boldOutgoing} onChange={(v) => patchLayout('boldOutgoing', v)} colors={colors} />
            <ToggleRow label={t('themes.dim_incoming')} value={layout.dimIncoming} onChange={(v) => patchLayout('dimIncoming', v)} colors={colors} />
            <ToggleRow label={t('themes.group_sender_bold')} value={layout.groupSenderBold} onChange={(v) => patchLayout('groupSenderBold', v)} colors={colors} />
            <ToggleRow label={t('themes.link_underline')} value={layout.linkUnderline} onChange={(v) => patchLayout('linkUnderline', v)} colors={colors} />
            <ToggleRow label={t('themes.swipe_reply')} value={layout.swipeReply} onChange={(v) => patchLayout('swipeReply', v)} colors={colors} />
            <ToggleRow label={t('themes.selection_highlight')} value={layout.selectionHighlight} onChange={(v) => patchLayout('selectionHighlight', v)} colors={colors} />
            <ToggleRow label={t('themes.show_online_dot')} value={layout.showOnlineDot} onChange={(v) => patchLayout('showOnlineDot', v)} colors={colors} />
            <ToggleRow label={t('themes.show_header_border')} value={layout.showHeaderBorder} onChange={(v) => patchLayout('showHeaderBorder', v)} colors={colors} />
            <ToggleRow label={t('themes.show_typing')} value={layout.showTypingDots} onChange={(v) => patchLayout('showTypingDots', v)} colors={colors} />
            <ToggleRow label={t('themes.enter_sends')} value={layout.enterSends} onChange={(v) => patchLayout('enterSends', v)} colors={colors} />
            <ToggleRow label={t('themes.haptics_react')} value={layout.hapticsOnReact} onChange={(v) => patchLayout('hapticsOnReact', v)} colors={colors} />
            <ToggleRow label={t('themes.squircle')} value={layout.squircleCorners} onChange={(v) => patchLayout('squircleCorners', v)} colors={colors} />
          </>
        ) : null}

        {tab === 'css' ? (
          <>
            <Text style={[styles.sectionLead, { color: colors.textSecondary }]}>
              {t('themes.css_lead')}
            </Text>
            <Text style={[styles.cssHint, { color: colors.textMuted }]}>
              {t('themes.css_vars_hint')}
            </Text>
            <TextInput
              value={customCss}
              onChangeText={setCustomCss}
              multiline
              autoCapitalize="none"
              autoCorrect={false}
              spellCheck={false}
              placeholderTextColor={colors.textMuted}
              style={[
                styles.cssInput,
                {
                  color: colors.text,
                  backgroundColor: colors.surfaceMuted,
                  borderColor: colors.border,
                },
              ]}
            />
            <Pressable
              onPress={() => setCustomCss(CSS_THEME_TEMPLATE)}
              style={[styles.secondaryBtn, { borderColor: colors.border }]}
            >
              <Ionicons name="refresh" size={16} color={colors.textSecondary} />
              <Text style={{ color: colors.textSecondary, fontWeight: '700' }}>
                {t('themes.css_reset')}
              </Text>
            </Pressable>
          </>
        ) : null}

        {tab === 'ai' ? (
          <>
            <Text style={[styles.sectionLead, { color: colors.textSecondary }]}>
              {t('themes.ai_lead')}
            </Text>
            <TextInput
              value={aiPrompt}
              onChangeText={setAiPrompt}
              multiline
              placeholder={t('themes.ai_placeholder')}
              placeholderTextColor={colors.textMuted}
              style={[
                styles.aiInput,
                {
                  color: colors.text,
                  backgroundColor: colors.surfaceMuted,
                  borderColor: colors.border,
                },
              ]}
            />
            <View style={styles.chipWrap}>
              {[
                t('themes.ai_ex1'),
                t('themes.ai_ex2'),
                t('themes.ai_ex3'),
                t('themes.ai_ex4'),
              ].map((ex) => (
                <Pressable
                  key={ex}
                  onPress={() => setAiPrompt(ex)}
                  style={[styles.chip, { backgroundColor: colors.surfaceMuted }]}
                >
                  <Text style={{ ...Typography.caption, fontWeight: '600', color: colors.textSecondary }}>
                    {ex}
                  </Text>
                </Pressable>
              ))}
            </View>
            <Pressable
              onPress={runAi}
              disabled={aiBusy}
              style={[styles.bottomCta, { backgroundColor: colors.primary, opacity: aiBusy ? 0.7 : 1 }]}
            >
              <Ionicons name="sparkles" size={18} color={colors.onPrimary} />
              <Text style={[styles.bottomCtaText, { color: colors.onPrimary }]}>
                {aiBusy ? t('themes.ai_generating') : t('themes.ai_generate')}
              </Text>
            </Pressable>
          </>
        ) : null}

        {tab !== 'ai' ? (
          <Pressable
            onPress={save}
            style={[
              styles.bottomCta,
              { backgroundColor: canSave ? colors.primary : colors.surfaceMuted },
            ]}
          >
            <Ionicons name="sparkles" size={18} color={canSave ? colors.onPrimary : colors.textMuted} />
            <Text style={[styles.bottomCtaText, { color: canSave ? colors.onPrimary : colors.textMuted }]}>
              {t('themes.save_apply')}
            </Text>
          </Pressable>
        ) : null}
      </ScrollView>
    </SafeAreaView>
  );
}

// ── Atoms ───────────────────────────────────────────────────────────────────

function Label({ children, color }: { children: ReactNode; color: string }) {
  return <Text style={[styles.label, { color }]}>{children}</Text>;
}

function ColorRow({
  options,
  value,
  onChange,
  ring,
}: {
  options: string[];
  value: string;
  onChange: (c: string) => void;
  ring: string;
}) {
  const unique = Array.from(new Set(options.filter(Boolean)));
  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.colorRow}>
      {unique.map((c) => {
        const active = value?.toLowerCase() === c.toLowerCase();
        return (
          <Pressable
            key={c}
            onPress={() => {
              Haptics.selectionAsync();
              onChange(c);
            }}
            style={[
              styles.colorDot,
              {
                backgroundColor: c,
                borderColor: active ? '#4F46E5' : ring,
                borderWidth: active ? 3 : 1,
                transform: [{ scale: active ? 1.08 : 1 }],
              },
            ]}
          />
        );
      })}
    </ScrollView>
  );
}

function Segment<T extends string>({
  options,
  value,
  onChange,
  colors,
}: {
  options: readonly (readonly [T, string])[] | [T, string][];
  value: T;
  onChange: (v: T) => void;
  colors: { primary: string; onPrimary: string; surfaceMuted: string; textSecondary: string };
}) {
  return (
    <View style={styles.segment}>
      {options.map(([id, label]) => {
        const active = value === id;
        return (
          <Pressable
            key={id}
            onPress={() => onChange(id)}
            style={[
              styles.segmentItem,
              { backgroundColor: active ? colors.primary : colors.surfaceMuted },
            ]}
          >
            <Text
              style={{
                ...Typography.caption,
                fontWeight: '700',
                fontSize: 13,
                color: active ? colors.onPrimary : colors.textSecondary,
              }}
            >
              {label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

function ChipRow<T extends string>({
  options,
  value,
  onChange,
  colors,
}: {
  options: { id: T; label: string }[];
  value: T;
  onChange: (v: T) => void;
  colors: { primary: string; onPrimary: string; surfaceMuted: string; textSecondary: string };
}) {
  return (
    <View style={styles.chipWrap}>
      {options.map((opt) => {
        const active = value === opt.id;
        return (
          <Pressable
            key={opt.id}
            onPress={() => onChange(opt.id)}
            style={[
              styles.chip,
              active ? { backgroundColor: colors.primary } : { backgroundColor: colors.surfaceMuted },
            ]}
          >
            <Text
              style={{
                ...Typography.caption,
                fontWeight: '700',
                fontSize: 13,
                color: active ? colors.onPrimary : colors.textSecondary,
              }}
            >
              {opt.label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

function ToggleRow({
  label,
  value,
  onChange,
  colors,
}: {
  label: string;
  value: boolean;
  onChange: (v: boolean) => void;
  colors: { text: string; primary: string; surfaceMuted: string; border: string };
}) {
  return (
    <Pressable
      onPress={() => onChange(!value)}
      style={[styles.toggleRow, { backgroundColor: colors.surfaceMuted }]}
    >
      <Text style={[styles.toggleLabel, { color: colors.text }]}>{label}</Text>
      <View style={[styles.toggleTrack, { backgroundColor: value ? colors.primary : colors.border }]}>
        <View style={[styles.toggleThumb, value && { alignSelf: 'flex-end' }]} />
      </View>
    </Pressable>
  );
}

function StepRow({
  value,
  min,
  max,
  step,
  onChange,
  colors,
}: {
  value: number;
  min: number;
  max: number;
  step: number;
  onChange: (v: number) => void;
  colors: {
    primary: string;
    onPrimary: string;
    surfaceMuted: string;
    text: string;
    textMuted: string;
  };
}) {
  return (
    <View style={styles.stepRow}>
      <Pressable
        onPress={() => onChange(Math.max(min, value - step))}
        style={[styles.stepBtn, { backgroundColor: colors.surfaceMuted }]}
      >
        <Ionicons name="remove" size={20} color={colors.text} />
      </Pressable>
      <Text style={[styles.stepValue, { color: colors.text }]}>{value}</Text>
      <Pressable
        onPress={() => onChange(Math.min(max, value + step))}
        style={[styles.stepBtn, { backgroundColor: colors.primary }]}
      >
        <Ionicons name="add" size={20} color={colors.onPrimary} />
      </Pressable>
    </View>
  );
}

function blendPreview(a: string, b: string, t: number) {
  const pa = hex(a);
  const pb = hex(b);
  if (!pa || !pb) return a;
  const r = Math.round(pa.r + (pb.r - pa.r) * t);
  const g = Math.round(pa.g + (pb.g - pa.g) * t);
  const bl = Math.round(pa.b + (pb.b - pa.b) * t);
  return `#${[r, g, bl].map((n) => n.toString(16).padStart(2, '0')).join('')}`;
}

function hex(h: string) {
  const s = h.replace('#', '');
  if (s.length !== 6) return null;
  return {
    r: parseInt(s.slice(0, 2), 16),
    g: parseInt(s.slice(2, 4), 16),
    b: parseInt(s.slice(4, 6), 16),
  };
}

const styles = StyleSheet.create({
  iconGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: Spacing.sm,
    marginBottom: Spacing.md,
  },
  iconCell: {
    width: 88,
    alignItems: 'center',
    gap: 4,
    paddingVertical: Spacing.sm,
    borderRadius: Radii.md,
  },
  iconPreview: {
    width: 44,
    height: 44,
    borderRadius: Radii.pill,
    alignItems: 'center',
    justifyContent: 'center',
  },
  iconPreviewImage: {
    width: 26,
    height: 26,
  },
  iconCellLabel: {
    ...Typography.caption,
  },
  iconCellReset: {
    ...Typography.caption,
    fontWeight: '600',
  },
  safe: { flex: 1 },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm + 2,
    borderBottomWidth: StyleSheet.hairlineWidth,
    gap: Spacing.sm,
  },
  iconBtn: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  headerTitle: { ...Typography.bodyStrong, fontSize: 16 },
  headerSub: { ...Typography.micro, marginTop: 2 },
  saveBtn: {
    paddingHorizontal: Spacing.lg,
    minHeight: 40,
    borderRadius: Radii.pill,
    alignItems: 'center',
    justifyContent: 'center',
  },
  saveText: { ...Typography.caption, fontWeight: '700', fontSize: 13 },
  preview: {
    marginHorizontal: Spacing.lg,
    marginTop: Spacing.md,
    borderRadius: Radii.xl,
    borderWidth: 1,
    padding: Spacing.md,
    gap: Spacing.sm,
    minHeight: 132,
    overflow: 'hidden',
  },
  patternOverlay: { ...StyleSheet.absoluteFillObject },
  patternDot: {
    position: 'absolute',
    width: 10,
    height: 10,
    borderRadius: 2,
    transform: [{ rotate: '45deg' }],
  },
  previewMsgRow: { flexDirection: 'row' },
  previewBubble: { gap: 2 },
  tabs: {
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.md,
    gap: Spacing.sm + 2,
    alignItems: 'center',
  },
  tab: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: Spacing.lg,
    paddingVertical: 12,
    minHeight: 44,
    borderRadius: Radii.pill,
    borderWidth: 1,
  },
  body: {
    padding: Spacing.lg,
    gap: Spacing.lg,
    paddingBottom: Spacing.xxxl * 1.5,
  },
  sectionLead: { ...Typography.body, lineHeight: 22 },
  label: {
    ...Typography.micro,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 0.6,
    marginBottom: -4,
  },
  input: {
    ...Typography.body,
    minHeight: 48,
    borderRadius: Radii.lg,
    paddingHorizontal: Spacing.md + 2,
    paddingVertical: Spacing.md,
  },
  segment: { flexDirection: 'row', gap: Spacing.sm + 2 },
  segmentItem: {
    flex: 1,
    minHeight: 48,
    paddingVertical: 12,
    paddingHorizontal: Spacing.md,
    borderRadius: Radii.pill,
    alignItems: 'center',
    justifyContent: 'center',
  },
  colorRow: { gap: Spacing.md, paddingVertical: 4 },
  colorDot: { width: 42, height: 42, borderRadius: 21 },
  chipWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.sm + 4 },
  chip: {
    paddingHorizontal: Spacing.lg,
    paddingVertical: 12,
    minHeight: 44,
    borderRadius: Radii.pill,
    alignItems: 'center',
    justifyContent: 'center',
  },
  toggleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: Spacing.lg,
    minHeight: 56,
    paddingVertical: Spacing.md,
    borderRadius: Radii.lg,
    gap: Spacing.md,
  },
  toggleLabel: { ...Typography.body, fontWeight: '600', flex: 1, lineHeight: 20 },
  toggleTrack: {
    width: 52,
    height: 32,
    borderRadius: 16,
    padding: 3,
    justifyContent: 'center',
  },
  toggleThumb: {
    width: 26,
    height: 26,
    borderRadius: 13,
    backgroundColor: '#FFF',
  },
  stepRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.md,
  },
  stepBtn: {
    width: 48,
    height: 48,
    borderRadius: 24,
    alignItems: 'center',
    justifyContent: 'center',
  },
  stepValue: { ...Typography.bodyStrong, minWidth: 56, textAlign: 'center', fontSize: 16 },
  photoRow: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.sm + 2 },
  photoBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: Spacing.lg,
    paddingVertical: 14,
    minHeight: 48,
    borderRadius: Radii.pill,
  },
  photoBtnText: { ...Typography.caption, fontWeight: '700', fontSize: 13 },
  photoThumb: {
    width: '100%',
    height: 120,
    borderRadius: Radii.lg,
    borderWidth: 1,
  },
  cssInput: {
    ...Typography.caption,
    fontFamily: 'monospace',
    minHeight: 220,
    borderRadius: Radii.lg,
    borderWidth: 1,
    padding: Spacing.md + 2,
    textAlignVertical: 'top',
    lineHeight: 20,
  },
  cssHint: { ...Typography.caption, lineHeight: 18, marginTop: -8 },
  aiInput: {
    ...Typography.body,
    minHeight: 110,
    borderRadius: Radii.lg,
    borderWidth: 1,
    padding: Spacing.md + 2,
    textAlignVertical: 'top',
    lineHeight: 22,
  },
  secondaryBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    minHeight: 48,
    borderRadius: Radii.pill,
    borderWidth: 1,
    paddingHorizontal: Spacing.lg,
  },
  bottomCta: {
    marginTop: Spacing.md,
    minHeight: 54,
    borderRadius: Radii.xl,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing.sm,
    paddingHorizontal: Spacing.lg,
  },
  bottomCtaText: { ...Typography.bodyStrong, fontSize: 16 },
});
