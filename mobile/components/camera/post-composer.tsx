import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { router } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useRef, useState } from 'react';
import {
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  useWindowDimensions,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { SlideThumb } from '@/components/post/slide-thumb';
import { Text, TextInput } from '@/components/ui/text';
import { CameraColors, Radii, Spacing, Typography } from '@/constants/theme';
import type { PostKind, PostVisibility } from '@/data/api/posts';
import { POST_CAPTION_MAX, POST_MAX_ITEMS, type CapturedItem } from '@/data/camera-modes';
import { queuePostPublish } from '@/data/post-store';
import { useProfile } from '@/data/profile-store';
import { useTheme } from '@/hooks/use-theme';
import { t } from '@/i18n';

/**
 * The last step for a post or a reel: look at what was captured, write a
 * caption, choose who sees it, share.
 *
 * Unlike a story there is nothing to draw on, so this is a form under the
 * pictures rather than an editor over them. Sharing closes the camera at
 * once; the upload carries on behind the profile grid.
 */
export function PostComposer({
  kind,
  items,
  onRemove,
  onBack,
}: {
  kind: PostKind;
  items: CapturedItem[];
  onRemove: (index: number) => void;
  /** Back to the camera, keeping what was captured. */
  onBack: () => void;
}) {
  const { colors } = useTheme();
  const profile = useProfile();
  const { width: W } = useWindowDimensions();
  const [caption, setCaption] = useState('');
  const [visibility, setVisibility] = useState<PostVisibility>('contacts');
  const [page, setPage] = useState(0);
  const publishLock = useRef(false);

  // A post is framed 4:5, as the camera showed it. A reel is tall, so it is
  // shown smaller to leave the caption on screen.
  const slideW = kind === 'reel' ? Math.round(W * 0.5) : W;
  const slideH = kind === 'reel' ? Math.round((slideW * 16) / 9) : Math.round((W * 5) / 4);
  const left = POST_CAPTION_MAX - caption.length;

  const share = () => {
    if (publishLock.current || items.length === 0) return;
    publishLock.current = true;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    queuePostPublish({
      kind,
      caption: caption.trim(),
      visibility,
      items,
      authorName: profile.name,
      authorUsername: profile.username,
      authorAvatar: profile.avatarUri,
    });
    // Leave at once: the toast and the grid tile report how it goes.
    router.back();
  };

  return (
    <View style={styles.root}>
      <StatusBar style="light" />
      <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
        <View style={styles.header}>
          <Pressable
            onPress={onBack}
            hitSlop={10}
            style={styles.headerBtn}
            accessibilityRole="button"
            accessibilityLabel={t('common.back')}
          >
            <Ionicons name="chevron-back" size={26} color={CameraColors.onStage} />
          </Pressable>
          <Text style={styles.heading}>{t(kind === 'reel' ? 'posts.new_reel' : 'posts.new_post')}</Text>
          <View style={styles.headerBtn} />
        </View>

        <KeyboardAvoidingView style={styles.safe} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
          <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={styles.body}>
            <View style={kind === 'reel' ? styles.reelStage : undefined}>
              <ScrollView
                horizontal
                pagingEnabled
                showsHorizontalScrollIndicator={false}
                style={{ width: slideW, height: slideH }}
                onMomentumScrollEnd={(e) => setPage(Math.round(e.nativeEvent.contentOffset.x / slideW))}
              >
                {items.map((item, index) => (
                  <View key={item.uri} style={{ width: slideW, height: slideH }}>
                    <SlideThumb
                      uri={item.uri}
                      kind={item.kind === 'video' ? 'video' : 'image'}
                      style={[styles.slide, kind === 'reel' && styles.slideReel]}
                    />
                    {item.kind === 'video' ? (
                      <View style={styles.videoMark}>
                        <Ionicons name="videocam" size={14} color={CameraColors.onStage} />
                      </View>
                    ) : null}
                    {items.length > 1 ? (
                      <Pressable
                        onPress={() => {
                          onRemove(index);
                          setPage((p) => Math.max(0, Math.min(p, items.length - 2)));
                        }}
                        style={styles.remove}
                        hitSlop={8}
                        accessibilityRole="button"
                        accessibilityLabel={t('camera.remove_item', { n: index + 1 })}
                      >
                        <Ionicons name="trash-outline" size={18} color={CameraColors.onStage} />
                      </Pressable>
                    ) : null}
                  </View>
                ))}
              </ScrollView>
            </View>

            {kind === 'post' ? (
              <View style={styles.pager}>
                <View style={styles.dots}>
                  {items.length > 1
                    ? items.map((item, index) => (
                        <View key={item.uri} style={[styles.dot, index === page && styles.dotOn]} />
                      ))
                    : null}
                </View>
                {items.length < POST_MAX_ITEMS ? (
                  <Pressable onPress={onBack} hitSlop={8} style={styles.addMore} accessibilityRole="button">
                    <Ionicons name="add" size={18} color={CameraColors.onStage} />
                    <Text style={styles.addMoreText}>
                      {t('posts.add_more')} {items.length}/{POST_MAX_ITEMS}
                    </Text>
                  </Pressable>
                ) : (
                  <Text style={styles.addMoreText}>
                    {items.length}/{POST_MAX_ITEMS}
                  </Text>
                )}
              </View>
            ) : null}

            <View style={styles.form}>
              <TextInput
                value={caption}
                onChangeText={setCaption}
                placeholder={t('posts.caption_placeholder')}
                placeholderTextColor={CameraColors.onStageFaint}
                multiline
                maxLength={POST_CAPTION_MAX}
                style={styles.caption}
              />
              {/* Only once it matters: a counter that is always there is noise. */}
              {left <= 200 ? <Text style={styles.counter}>{left}</Text> : null}

              <Text style={styles.section}>{t('posts.audience_label')}</Text>
              <View style={styles.audience} accessibilityRole="radiogroup">
                <AudienceOption
                  icon="people-outline"
                  label={t('posts.audience_contacts')}
                  hint={t('posts.audience_contacts_hint')}
                  on={visibility === 'contacts'}
                  onPress={() => setVisibility('contacts')}
                />
                <View style={styles.divider} />
                <AudienceOption
                  icon="globe-outline"
                  label={t('posts.audience_public')}
                  hint={t('posts.audience_public_hint')}
                  on={visibility === 'public'}
                  onPress={() => setVisibility('public')}
                />
              </View>
            </View>
          </ScrollView>

          <View style={styles.footer}>
            <Pressable
              onPress={share}
              style={({ pressed }) => [
                styles.share,
                { backgroundColor: colors.primary },
                pressed && styles.sharePressed,
              ]}
              accessibilityRole="button"
            >
              <Text style={[styles.shareText, { color: colors.onPrimary }]}>{t('posts.share')}</Text>
            </Pressable>
          </View>
        </KeyboardAvoidingView>
      </SafeAreaView>
    </View>
  );
}

function AudienceOption({
  icon,
  label,
  hint,
  on,
  onPress,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  hint: string;
  on: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [styles.option, pressed && styles.optionPressed]}
      accessibilityRole="radio"
      accessibilityState={{ selected: on }}
    >
      <Ionicons name={icon} size={22} color={on ? CameraColors.onStage : CameraColors.onStageMuted} />
      <View style={styles.optionBody}>
        <Text style={styles.optionLabel}>{label}</Text>
        <Text style={styles.optionHint}>{hint}</Text>
      </View>
      <Ionicons
        name={on ? 'radio-button-on' : 'radio-button-off'}
        size={22}
        color={on ? CameraColors.onStage : CameraColors.onStageFaint}
      />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: CameraColors.stage },
  safe: { flex: 1 },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: Spacing.sm,
    height: 52,
  },
  headerBtn: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  heading: { ...Typography.h3, color: CameraColors.onStage },
  body: { paddingBottom: Spacing.xl },

  reelStage: { alignItems: 'center', paddingVertical: Spacing.md },
  slide: { width: '100%', height: '100%', backgroundColor: CameraColors.surface },
  slideReel: { borderRadius: Radii.lg },
  videoMark: {
    position: 'absolute',
    left: Spacing.md,
    bottom: Spacing.md,
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: CameraColors.scrim,
    alignItems: 'center',
    justifyContent: 'center',
  },
  remove: {
    position: 'absolute',
    right: Spacing.md,
    top: Spacing.md,
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: CameraColors.scrim,
    alignItems: 'center',
    justifyContent: 'center',
  },

  pager: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: Spacing.lg,
    paddingTop: Spacing.md,
    minHeight: 36,
  },
  dots: { flexDirection: 'row', gap: 6 },
  dot: { width: 6, height: 6, borderRadius: 3, backgroundColor: CameraColors.onStageFaint },
  dotOn: { backgroundColor: CameraColors.onStage },
  addMore: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  addMoreText: { ...Typography.label, color: CameraColors.onStageMuted, fontVariant: ['tabular-nums'] },

  form: { paddingHorizontal: Spacing.lg, paddingTop: Spacing.lg },
  caption: {
    ...Typography.body,
    color: CameraColors.onStage,
    minHeight: 72,
    textAlignVertical: 'top',
    paddingVertical: 0,
  },
  counter: { ...Typography.micro, color: CameraColors.onStageMuted, textAlign: 'right' },
  section: {
    ...Typography.label,
    color: CameraColors.onStageMuted,
    marginTop: Spacing.xl,
    marginBottom: Spacing.sm,
  },
  audience: {
    borderRadius: Radii.lg,
    backgroundColor: CameraColors.surface,
    overflow: 'hidden',
  },
  divider: { height: StyleSheet.hairlineWidth, backgroundColor: CameraColors.hairline, marginLeft: 50 },
  option: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.md,
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.md,
    minHeight: 60,
  },
  optionPressed: { backgroundColor: CameraColors.hairline },
  optionBody: { flex: 1 },
  optionLabel: { ...Typography.bodyStrong, color: CameraColors.onStage },
  optionHint: { ...Typography.caption, color: CameraColors.onStageMuted },

  footer: { paddingHorizontal: Spacing.lg, paddingTop: Spacing.sm, paddingBottom: Spacing.sm },
  share: { height: 52, borderRadius: Radii.pill, alignItems: 'center', justifyContent: 'center' },
  sharePressed: { opacity: 0.88 },
  shareText: { ...Typography.bodyStrong },
});
