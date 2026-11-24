import { Ionicons } from '@expo/vector-icons';
import { Image } from 'expo-image';
import * as Haptics from 'expo-haptics';
import * as ImagePicker from 'expo-image-picker';
import { router } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Dimensions, Modal, Pressable, StyleSheet, Switch, View } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, {
  FadeIn,
  FadeInDown,
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
} from 'react-native-reanimated';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';

import { RoundBtn, SideTool, Waveform } from '@/components/camera/camera-ui';
import { FilterStrip } from '@/components/media/filter-strip';
import { FilteredPhoto } from '@/components/media/filtered-photo';
import { Text, TextInput } from '@/components/ui/text';
import { Palette, Radii, Spacing, Typography } from '@/constants/theme';
import { bakeFilter } from '@/data/bake-filter';
import { storyDurationSec, type CapturedItem } from '@/data/camera-modes';
import { appAlert } from '@/data/dialog-store';
import type { StoryVisibility } from '@/data/mock';
import type { FilterId } from '@/data/photo-filters';
import { useProfile } from '@/data/profile-store';
import {
  buildMentionCaption,
  buildPollCaption,
  buildQuestionCaption,
  pollValidationError,
  type StoryPosition,
} from '@/data/story-composition';
import { queueStoryPublish } from '@/data/story-store';
import { useTheme } from '@/hooks/use-theme';
import { t } from '@/i18n';

/**
 * What happens to a story after the shutter: text, stickers, the filter, who
 * sees it and for how long, then publish.
 *
 * Socialize extras over the Instagram editor: audience (public / contacts /
 * close), anonymous post, comments on or off, anonymous replies, and a
 * lifetime the author picks.
 *
 * It is handed what the camera produced and nothing else. `item` is null for
 * a story that is only text.
 */

type EditTool = 'text' | 'sticker' | 'draw' | 'music' | 'filter' | null;
type StickerKind = 'poll' | 'question' | 'mention' | null;

const { width: W, height: H } = Dimensions.get('window');
// The brand violet leads; the rest are the user's own choices, so blue
// stays available as one of them rather than as the product's colour.
const ACCENTS = ['#4F46E5', '#111827', '#10B981', '#FF6FB5', '#F59E0B', '#2D5BFF', '#EF4444', '#FFFFFF'];

/**
 * How long a story stays up. Must stay inside the server's 1..72 bound —
 * see StoryTTLMinHours / StoryTTLMaxHours in the stories module.
 */
const TTL_CHOICES = [1, 3, 6, 12, 24, 36, 48, 72] as const;

export function StoryComposer({
  item,
  initialCaption = '',
  initialFilter = 'none',
  onDiscard,
}: {
  item: CapturedItem | null;
  /** A forwarded message's text, or what was typed before going to the editor. */
  initialCaption?: string;
  /** The filter that was on the viewfinder when the photo was taken. */
  initialFilter?: FilterId;
  /** Back to the camera, dropping what was captured. */
  onDiscard: () => void;
}) {
  const profile = useProfile();
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();

  // A text story may carry a picture behind the words; it is still a text
  // story, so it never gets the photo tools (filter, caption tap zone).
  const [textBackgroundUri, setTextBackgroundUri] = useState<string | null>(null);
  const mediaUri = item?.uri ?? textBackgroundUri;
  const isVideo = item?.kind === 'video';
  const isAudio = item?.kind === 'audio';
  const audioSec = Math.round((item?.durationMs ?? 0) / 1000);
  const textOnly = !item;

  const [caption, setCaption] = useState(initialCaption);
  const [accent, setAccent] = useState(ACCENTS[0]);
  const [audience, setAudience] = useState<StoryVisibility>('contacts');
  // Mirrors the server bound (StoryTTLMinHours..StoryTTLMaxHours). Offering
  // a value the server would clamp means telling the author a story lasts
  // longer than it will.
  const [ttlHours, setTtlHours] = useState(24);
  const [postAnonymous, setPostAnonymous] = useState(false);
  const [allowComments, setAllowComments] = useState(true);
  const [allowAnonReplies, setAllowAnonReplies] = useState(true);
  const [activeTool, setActiveTool] = useState<EditTool>(textOnly ? 'text' : null);
  const [sticker, setSticker] = useState<StickerKind>(null);
  const [pollOptions, setPollOptions] = useState([t('stories.poll_yes'), t('stories.poll_no')]);
  const [mentionHandle, setMentionHandle] = useState('');
  const [stickerPosition, setStickerPosition] = useState<StoryPosition>({ x: 0.5, y: 0.4 });
  const [privacyOpen, setPrivacyOpen] = useState(false);
  // The share panel covers the lower part of the canvas; a sticker dragged
  // under it could be neither seen nor edited, so it is kept above it.
  const [footerHeight, setFooterHeight] = useState(0);
  const stickerMaxBottom = H - footerHeight - Spacing.sm;
  const publishLock = useRef(false);
  // A filter never survives onto a video: the bake is a still-image pass.
  const [filter, setFilter] = useState<FilterId>(isVideo || isAudio ? 'none' : initialFilter);

  const chooseTextBackground = async () => {
    const result = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], quality: 0.9 });
    if (result.canceled || !result.assets[0]) return;
    setTextBackgroundUri(result.assets[0].uri);
  };

  const buildInteractiveCaption = (): string => {
    if (sticker === 'poll') {
      return buildPollCaption(caption, pollOptions, stickerPosition, mentionHandle);
    }
    if (sticker === 'question') {
      return buildQuestionCaption(caption, stickerPosition, mentionHandle);
    }
    if (sticker === 'mention') {
      return buildMentionCaption(caption, mentionHandle, stickerPosition);
    }
    return caption.trim();
  };

  /**
   * WhatsApp-style: close the composer immediately and publish in background.
   * Upload + API run via queueStoryPublish; a global toast reports status.
   */
  const publish = async () => {
    if (publishLock.current) return;
    const hasMention = sticker === 'mention' && !!mentionHandle.trim();
    if (sticker === 'mention' && !hasMention) {
      appAlert(t('stories.mention'), t('stories.mention_handle'));
      return;
    }

    let kind: 'image' | 'video' | 'text' | 'audio' | 'poll' | 'question' = 'text';

    if (sticker === 'poll') {
      kind = 'poll';
      if (pollValidationError(caption, pollOptions)) {
        appAlert(t('stories.poll_mode'), t('stories.poll_invalid_options'));
        return;
      }
    } else if (sticker === 'question') {
      kind = 'question';
      if (!caption.trim()) {
        appAlert(t('stories.question_mode'), t('stories.question_placeholder'));
        return;
      }
    } else if (textOnly) {
      kind = 'text';
      if (!caption.trim() && !hasMention) {
        appAlert(t('stories.sent_notice'), t('stories.creator_need_name') || 'Add a caption');
        return;
      }
    } else if (isAudio && mediaUri) {
      kind = 'audio';
    } else if (mediaUri) {
      kind = isVideo ? 'video' : 'image';
    } else if (caption.trim() || hasMention) {
      kind = 'text';
    } else {
      appAlert(t('stories.sent_notice'), 'Pick a photo, video, audio, or write something.');
      return;
    }

    publishLock.current = true;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);

    // The filter is written into the file here, once, on the way out. Video
    // is left alone: a colour matrix over a moving picture is per-frame work
    // this does not do yet, and the strip is hidden for it.
    const outUri =
      mediaUri && !isVideo && !isAudio ? await bakeFilter(mediaUri, filter) : mediaUri;

    const bodyCaption =
      sticker === 'poll' || sticker === 'question' || sticker === 'mention'
        ? buildInteractiveCaption()
        : caption.trim();

    queueStoryPublish({
      kind,
      caption: bodyCaption,
      localMediaUri: outUri,
      mediaMimeType:
        kind === 'video' ? 'video/mp4' : kind === 'audio' ? 'audio/mp4' : 'image/jpeg',
      audioDurationMs: kind === 'audio' ? item?.durationMs : undefined,
      accent,
      visibility: audience,
      ttlHours,
      isAnonymous: postAnonymous,
      // Both toggles have been on this screen from the start and neither
      // reached the server, so the choice was discarded on publish.
      allowComments,
      allowAnonymousReplies: allowComments && allowAnonReplies,
      durationSec: storyDurationSec(kind, item?.durationMs),
      authorName: profile.name || 'You',
      authorUsername: profile.username,
      authorAvatar: profile.avatarUri,
    });

    // Leave immediately — status continues on the toast + your story ring.
    router.back();
  };

  const solidBg = isAudio || sticker === 'poll' || sticker === 'question' || (textOnly && !mediaUri);
  return (
    <View
      style={[
        styles.root,
        solidBg && {
          backgroundColor: isAudio ? '#12141A' : accent,
        },
      ]}
    >
      <StatusBar style="light" />

      {/* Through Skia when a filter is picked, so what is on screen is what
          the file will contain. An <Image> with a tint over it would look the
          same here and lose the colour on save. */}
      {!solidBg && mediaUri ? (
        isVideo || filter === 'none' ? (
          <Image source={{ uri: mediaUri }} style={StyleSheet.absoluteFill} contentFit="cover" />
        ) : (
          <FilteredPhoto uri={mediaUri} filter={filter} style={StyleSheet.absoluteFill} />
        )
      ) : null}
      {!solidBg && mediaUri ? <View style={styles.editScrim} /> : null}
      {!solidBg && textOnly && mediaUri ? <View style={styles.textImageScrim} /> : null}
      {solidBg ? (
        <>
          <View style={[StyleSheet.absoluteFill, { backgroundColor: isAudio ? '#12141A' : accent }]} />
          <View style={styles.textOrbA} />
          <View style={styles.textOrbB} />
        </>
      ) : null}

      <SafeAreaView style={styles.editChrome} edges={['top']} pointerEvents="box-none">
        <View style={styles.topBar}>
          <RoundBtn onPress={onDiscard} icon="close" />
          <View style={styles.topRightCluster}>
            <RoundBtn onPress={() => setPrivacyOpen(true)} icon="people-outline" />
            {(textOnly || isAudio) && (
              <RoundBtn
                onPress={() => setAccent(ACCENTS[(ACCENTS.indexOf(accent) + 1) % ACCENTS.length])}
                icon="color-palette-outline"
              />
            )}
            {textOnly ? (
              <RoundBtn onPress={chooseTextBackground} icon="image-outline" />
            ) : null}
          </View>
        </View>

        <View style={[styles.sideRail, { top: insets.top + 72 }]}>
          <SideTool
            icon="text"
            label="Aa"
            active={activeTool === 'text'}
            onPress={() => setActiveTool((cur) => (cur === 'text' ? null : 'text'))}
          />
          <SideTool
            icon="happy-outline"
            label={t('stories.stickers')}
            active={activeTool === 'sticker'}
            onPress={() => setActiveTool((cur) => (cur === 'sticker' ? null : 'sticker'))}
          />
          <SideTool
            icon="brush-outline"
            label={t('stories.draw')}
            active={activeTool === 'draw'}
            onPress={() => setActiveTool((cur) => (cur === 'draw' ? null : 'draw'))}
          />
          <SideTool
            icon="musical-notes-outline"
            label={t('stories.music')}
            active={activeTool === 'music'}
            onPress={() => setActiveTool((cur) => (cur === 'music' ? null : 'music'))}
          />
          {/* Photos only. A colour matrix over a moving picture is per-frame
              work this does not do yet, and offering the tool on a video would
              promise a filter that never reaches the file. */}
          {!isVideo && !isAudio && !textOnly && mediaUri ? (
            <SideTool
              icon="color-filter-outline"
              label={t('filters.title')}
              active={activeTool === 'filter'}
              onPress={() => setActiveTool((cur) => (cur === 'filter' ? null : 'filter'))}
            />
          ) : null}
        </View>

        {activeTool === 'filter' && mediaUri ? (
          <View style={styles.filterTray}>
            <FilterStrip uri={mediaUri} value={filter} onChange={setFilter} />
          </View>
        ) : null}

        <View style={styles.editBody} pointerEvents="box-none">
          {isAudio ? (
            <View style={styles.audioEditCard}>
              <View style={styles.audioOrb}>
                <Ionicons name="mic" size={36} color="#FFF" />
              </View>
              <Text style={styles.audioReady}>{t('stories.audio_ready', { sec: audioSec })}</Text>
              <Waveform live />
            </View>
          ) : null}

          {(textOnly || activeTool === 'text' || isAudio) &&
          sticker !== 'poll' &&
          sticker !== 'question' ? (
            <TextInput
              value={caption}
              onChangeText={setCaption}
              placeholder={t('stories.caption_placeholder')}
              placeholderTextColor="rgba(255,255,255,0.45)"
              multiline
              maxLength={220}
              textAlign="center"
              autoFocus={textOnly || activeTool === 'text'}
              style={[styles.storyTextInput, textOnly && styles.storyTextInputLarge]}
            />
          ) : mediaUri && !textOnly && sticker !== 'poll' && sticker !== 'question' ? (
            <Pressable onPress={() => setActiveTool('text')} style={styles.captionTapZone}>
              {caption ? (
                <Text style={styles.overlayCaption}>{caption}</Text>
              ) : (
                <Text style={styles.overlayCaptionHint}>{t('stories.tap_add_text')}</Text>
              )}
            </Pressable>
          ) : null}

          {isVideo ? (
            <View style={styles.videoBadge}>
              <Ionicons name="play" size={14} color="#FFF" />
              <Text style={styles.videoBadgeText}>
                {item?.boomerang ? 'Boomerang' : 'Video'}
              </Text>
            </View>
          ) : null}
        </View>

        {activeTool === 'sticker' ? (
          <Animated.View entering={FadeIn.duration(180)} style={styles.stickerTray}>
            <StickerChip
              label={t('stories.poll_mode')}
              icon="stats-chart"
              onPress={() => {
                setSticker('poll');
                setActiveTool(null);
              }}
            />
            <StickerChip
              label={t('stories.question_mode')}
              icon="help-circle"
              onPress={() => {
                setSticker('question');
                setActiveTool(null);
              }}
            />
            <StickerChip
              label={t('stories.mention')}
              icon="at"
              onPress={() => {
                setStickerPosition({ x: 0.5, y: 0.58 });
                setSticker('mention');
                setActiveTool(null);
              }}
            />
            <StickerChip
              label={t('stories.link')}
              icon="link"
              onPress={() => {
                setCaption((c) => (c ? c : 'https://'));
                setActiveTool('text');
              }}
            />
          </Animated.View>
        ) : null}

        {activeTool === 'music' ? (
          <Animated.View entering={FadeInDown.duration(200)} style={styles.musicCard}>
            <Ionicons name="musical-notes" size={18} color="#FFF" />
            <View style={{ flex: 1 }}>
              <Text style={styles.musicTitle}>{t('stories.music_pick')}</Text>
              <Text style={styles.musicSub}>{t('stories.music_hint')}</Text>
            </View>
          </Animated.View>
        ) : null}
      </SafeAreaView>

      {/* Share footer: audience + toggles + share */}
      <View
        style={[styles.shareFooter, { paddingBottom: Math.max(insets.bottom, 14) }]}
        onLayout={(e) => setFooterHeight(e.nativeEvent.layout.height)}
      >
        <Text style={styles.audienceHeading}>{t('stories.audience_label')}</Text>
        <View style={styles.audienceRow}>
          <AudienceChip
            active={audience === 'public'}
            icon="globe-outline"
            label={t('stories.privacy_public')}
            accent={colors.primary}
            onPress={() => setAudience('public')}
          />
          <AudienceChip
            active={audience === 'contacts'}
            avatarUri={profile.avatarUri}
            label={t('stories.privacy_contacts')}
            onPress={() => setAudience('contacts')}
          />
          <AudienceChip
            active={audience === 'close'}
            icon="star"
            label={t('stories.privacy_close')}
            accent="#10B981"
            onPress={() => setAudience('close')}
          />
        </View>

        <Text style={styles.audienceHeading}>{t('stories.duration_label')}</Text>
        <View style={styles.ttlRow}>
          {TTL_CHOICES.map((h) => (
            <Pressable
              key={h}
              onPress={() => setTtlHours(h)}
              style={[
                styles.ttlChip,
                {
                  borderColor: ttlHours === h ? colors.primary : 'rgba(255,255,255,0.18)',
                  backgroundColor: ttlHours === h ? colors.primary : 'transparent',
                },
              ]}
              accessibilityRole="radio"
              accessibilityState={{ selected: ttlHours === h }}
            >
              <Text
                style={[
                  styles.ttlChipText,
                  { color: ttlHours === h ? colors.onPrimary : 'rgba(255,255,255,0.75)' },
                ]}
              >
                {h === 1
                  ? t('stories.duration_1h')
                  : h === 72
                    ? t('stories.duration_max')
                    : t('stories.duration_hours', { count: h })}
              </Text>
            </Pressable>
          ))}
        </View>

        <View style={styles.toggleCard}>
          <ToggleRow
            icon="eye-off-outline"
            title={t('stories.post_anonymous')}
            hint={t('stories.post_anonymous_hint')}
            value={postAnonymous}
            onChange={setPostAnonymous}
          />
          <View style={styles.toggleDivider} />
          <ToggleRow
            icon="chatbubbles-outline"
            title={t('stories.allow_comments')}
            hint={t('stories.allow_comments_hint')}
            value={allowComments}
            onChange={setAllowComments}
          />
          {allowComments ? (
            <>
              <View style={styles.toggleDivider} />
              <ToggleRow
                icon="person-outline"
                title={t('stories.allow_anon_replies')}
                hint={t('stories.allow_anon_replies_hint')}
                value={allowAnonReplies}
                onChange={setAllowAnonReplies}
              />
            </>
          ) : null}
        </View>

        <Pressable
          onPress={publish}
          style={({ pressed }) => [
            styles.shareBtn,
            { backgroundColor: colors.primary },
            pressed && { transform: [{ scale: 0.98 }], opacity: 0.92 },
          ]}
        >
          <Text style={[styles.shareBtnText, { color: colors.onPrimary }]}>
            {t('stories.share_story')}
          </Text>
          <Ionicons name="arrow-forward" size={18} color={colors.onPrimary} />
        </Pressable>
      </View>

      {sticker === 'poll' ? (
        <DraggableStoryElement
          position={stickerPosition}
          onPositionChange={setStickerPosition}
          minY={insets.top + 110}
          maxBottom={stickerMaxBottom}
        >
          <Animated.View entering={FadeInDown.springify()} style={[styles.pollCard, { backgroundColor: colors.surface }]}>
            <DragHint />
            <Text style={[styles.stickerEyebrow, { color: colors.textSecondary }]}>{t('stories.poll_mode')}</Text>
            <TextInput
              value={caption}
              onChangeText={setCaption}
              placeholder={t('stories.poll_placeholder')}
              placeholderTextColor={colors.textMuted}
              style={[styles.stickerTitle, { color: colors.text }]}
            />
            {pollOptions.map((option, index) => (
              <View key={`poll-option-${index}`} style={styles.pollOptionRow}>
                <View style={{ flex: 1 }}>
                  <PollOption
                    value={option}
                    placeholder={t('stories.poll_option', { index: index + 1 })}
                    onChange={(value) =>
                      setPollOptions((current) => current.map((it, i) => (i === index ? value : it)))
                    }
                  />
                </View>
                {pollOptions.length > 2 ? (
                  <Pressable
                    onPress={() => setPollOptions((current) => current.filter((_, i) => i !== index))}
                    accessibilityRole="button"
                    accessibilityLabel={t('stories.poll_remove_option')}
                    hitSlop={8}
                  >
                    <Ionicons name="close-circle" size={20} color={colors.textSecondary} />
                  </Pressable>
                ) : null}
              </View>
            ))}
            {pollOptions.length < 3 ? (
              <Pressable
                onPress={() => setPollOptions((current) => (current.length < 3 ? [...current, ''] : current))}
                style={[styles.pollOptionAdd, { borderColor: colors.border }]}
                accessibilityRole="button"
              >
                <Ionicons name="add-circle-outline" size={18} color={colors.primary} />
                <Text style={[styles.pollOptionAddText, { color: colors.primary }]}>
                  {t('stories.poll_add_option')}
                </Text>
              </Pressable>
            ) : null}
          </Animated.View>
        </DraggableStoryElement>
      ) : null}

      {sticker === 'question' ? (
        <DraggableStoryElement
          position={stickerPosition}
          onPositionChange={setStickerPosition}
          minY={insets.top + 110}
          maxBottom={stickerMaxBottom}
        >
          <Animated.View entering={FadeInDown.springify()} style={[styles.questionCard, { backgroundColor: colors.surface }]}>
            <DragHint />
            <Text style={[styles.stickerEyebrow, { color: colors.textSecondary }]}>{t('stories.question_mode')}</Text>
            <TextInput
              value={caption}
              onChangeText={setCaption}
              placeholder={t('stories.question_placeholder')}
              placeholderTextColor={colors.textMuted}
              style={[styles.stickerTitle, { color: colors.text }]}
            />
            <View style={[styles.answerBox, { backgroundColor: colors.surfaceMuted }]}>
              <Text style={[styles.answerHint, { color: colors.primary }]}>
                {t('stories.answer_placeholder')}
              </Text>
            </View>
          </Animated.View>
        </DraggableStoryElement>
      ) : null}

      {sticker === 'mention' ? (
        <DraggableStoryElement
          position={stickerPosition}
          onPositionChange={setStickerPosition}
          minY={insets.top + 110}
          maxBottom={stickerMaxBottom}
        >
          <View style={[styles.mentionSticker, { backgroundColor: colors.surface }]}>
            <DragHint />
            <Text style={[styles.mentionPrefix, { color: colors.primary }]}>@</Text>
            <TextInput
              value={mentionHandle}
              onChangeText={setMentionHandle}
              placeholder={t('stories.mention_handle')}
              placeholderTextColor={colors.textMuted}
              autoCapitalize="none"
              autoCorrect={false}
              autoFocus
              maxLength={40}
              style={[styles.mentionInput, { color: colors.text }]}
            />
          </View>
        </DraggableStoryElement>
      ) : null}

      <PrivacySheet
        visible={privacyOpen}
        audience={audience}
        onSelect={(v) => {
          setAudience(v);
          setPrivacyOpen(false);
        }}
        onClose={() => setPrivacyOpen(false)}
      />
    </View>
  );
}

// ── Subcomponents ───────────────────────────────────────────────────────────

function AudienceChip({
  active,
  label,
  onPress,
  avatarUri,
  icon,
  accent,
}: {
  active: boolean;
  label: string;
  onPress: () => void;
  avatarUri?: string;
  icon?: keyof typeof Ionicons.glyphMap;
  accent?: string;
}) {
  return (
    <Pressable
      onPress={onPress}
      style={[
        styles.audienceChip,
        active && { borderColor: accent ?? '#FFF', backgroundColor: 'rgba(255,255,255,0.14)' },
      ]}
    >
      {avatarUri ? (
        <Image source={{ uri: avatarUri }} style={styles.audienceAvatar} contentFit="cover" />
      ) : (
        <View style={[styles.audienceIcon, { backgroundColor: accent ?? '#6B7280' }]}>
          <Ionicons name={icon ?? 'globe-outline'} size={14} color="#FFF" />
        </View>
      )}
      <Text style={styles.audienceLabel} numberOfLines={1}>
        {label}
      </Text>
    </Pressable>
  );
}

function ToggleRow({
  icon,
  title,
  hint,
  value,
  onChange,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  title: string;
  hint: string;
  value: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <View style={styles.toggleRow}>
      <Ionicons name={icon} size={18} color="rgba(255,255,255,0.85)" />
      <View style={{ flex: 1 }}>
        <Text style={styles.toggleTitle}>{title}</Text>
        <Text style={styles.toggleHint}>{hint}</Text>
      </View>
      <Switch
        value={value}
        onValueChange={onChange}
        trackColor={{ false: 'rgba(255,255,255,0.18)', true: Palette.brand[600] }}
        thumbColor="#FFF"
      />
    </View>
  );
}

function StickerChip({
  label,
  icon,
  onPress,
}: {
  label: string;
  icon: keyof typeof Ionicons.glyphMap;
  onPress: () => void;
}) {
  return (
    <Pressable onPress={onPress} style={styles.stickerChip}>
      <Ionicons name={icon} size={16} color="#FFF" />
      <Text style={styles.stickerChipText}>{label}</Text>
    </Pressable>
  );
}

function PollOption({
  value,
  placeholder,
  onChange,
}: {
  value: string;
  placeholder: string;
  onChange: (v: string) => void;
}) {
  const { colors } = useTheme();
  return (
    <View style={[styles.pollOption, { backgroundColor: colors.surfaceMuted }]}>
      <TextInput
        value={value}
        onChangeText={onChange}
        placeholder={placeholder}
        placeholderTextColor={colors.textSecondary}
        style={[styles.pollOptionInput, { color: colors.text }]}
        maxLength={28}
      />
    </View>
  );
}

function DragHint() {
  const { colors } = useTheme();
  return (
    <View style={styles.dragHintRow}>
      <Ionicons name="move" size={13} color={colors.textSecondary} />
      <Text style={[styles.dragHint, { color: colors.textSecondary }]}>{t('stories.move_sticker')}</Text>
    </View>
  );
}

/**
 * A sticker the author can drag. The position is stored as a fraction of the
 * screen, so the viewer places it the same way on a phone of another size —
 * see clampStoryPosition in data/story-composition.
 */
function DraggableStoryElement({
  position,
  onPositionChange,
  minY,
  maxBottom,
  children,
}: {
  position: StoryPosition;
  onPositionChange: (position: StoryPosition) => void;
  /** Highest the sticker's top edge may go, in screen pixels. */
  minY: number;
  /** Lowest its bottom edge may go: the top of whatever covers the canvas. */
  maxBottom: number;
  children: ReactNode;
}) {
  const [height, setHeight] = useState(0);
  // `position` is the sticker's centre, as a fraction of the screen — the
  // same reference the viewer places it by. Internally the drag works on the
  // top edge, which is what the bounds are about.
  const maxTop = Math.max(minY, maxBottom - height);
  const initialTop = Math.min(maxTop, Math.max(minY, position.y * H - height / 2));
  const x = useSharedValue(position.x * W);
  const y = useSharedValue(initialTop);
  // Seeded from plain numbers: reading `.value` during render is what
  // Reanimated's strict mode warns about.
  const startX = useSharedValue(position.x * W);
  const startY = useSharedValue(initialTop);

  // Re-clamp when the sticker or the panel below it changes size, so a
  // sticker that grows (a third poll option) never slides under the panel.
  useEffect(() => {
    const top = Math.min(maxTop, Math.max(minY, position.y * H - height / 2));
    x.value = position.x * W;
    y.value = top;
    const centre = (top + height / 2) / H;
    if (height > 0 && Math.abs(centre - position.y) * H > 0.5) {
      onPositionChange({ x: position.x, y: centre });
    }
  }, [position.x, position.y, minY, maxTop, height, onPositionChange, x, y]);

  const half = height / 2;
  const drag = Gesture.Pan()
    .onBegin(() => {
      startX.value = x.value;
      startY.value = y.value;
    })
    .onUpdate((event) => {
      x.value = Math.min(W - 160, Math.max(160, startX.value + event.translationX));
      y.value = Math.min(maxTop, Math.max(minY, startY.value + event.translationY));
    })
    .onEnd(() => {
      runOnJS(onPositionChange)({ x: x.value / W, y: (y.value + half) / H });
    });

  const animatedPosition = useAnimatedStyle(() => ({
    transform: [{ translateX: x.value - W / 2 }, { translateY: y.value - H / 2 }],
  }));

  return (
    <GestureDetector gesture={drag}>
      <Animated.View
        style={[styles.draggableOverlay, animatedPosition]}
        onLayout={(e) => setHeight(e.nativeEvent.layout.height)}
      >
        {children}
      </Animated.View>
    </GestureDetector>
  );
}

function PrivacySheet({
  visible,
  audience,
  onSelect,
  onClose,
}: {
  visible: boolean;
  audience: StoryVisibility;
  onSelect: (v: StoryVisibility) => void;
  onClose: () => void;
}) {
  const { colors } = useTheme();
  const options: { id: StoryVisibility; title: string; hint: string; icon: keyof typeof Ionicons.glyphMap }[] = [
    {
      id: 'public',
      title: t('stories.privacy_public'),
      hint: t('stories.privacy_public_hint'),
      icon: 'globe-outline',
    },
    {
      id: 'contacts',
      title: t('stories.privacy_contacts'),
      hint: t('stories.privacy_contacts_hint'),
      icon: 'people-outline',
    },
    {
      id: 'close',
      title: t('stories.privacy_close'),
      hint: t('stories.privacy_close_hint'),
      icon: 'star-outline',
    },
  ];

  return (
    <Modal transparent visible={visible} animationType="slide" onRequestClose={onClose}>
      <Pressable style={styles.sheetBackdrop} onPress={onClose}>
        <Pressable style={styles.privacySheet} onPress={(e) => e.stopPropagation()}>
          <View style={styles.sheetGrip} />
          <Text style={styles.privacyTitle}>{t('stories.status_privacy')}</Text>
          {options.map((item) => {
            const active = audience === item.id;
            return (
              <Pressable key={item.id} onPress={() => onSelect(item.id)} style={styles.privacyRow}>
                <View style={[styles.privacyIcon, active && { backgroundColor: colors.primary }]}>
                  <Ionicons name={item.icon} size={18} color="#FFF" />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.privacyRowText}>{item.title}</Text>
                  <Text style={styles.privacyRowHint}>{item.hint}</Text>
                </View>
                <Ionicons
                  name={active ? 'checkmark-circle' : 'ellipse-outline'}
                  size={22}
                  color={active ? colors.primary : 'rgba(255,255,255,0.35)'}
                />
              </Pressable>
            );
          })}
        </Pressable>
      </Pressable>
    </Modal>
  );
}

// ── Styles ──────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#000' },
  audioOrb: {
    width: 96,
    height: 96,
    borderRadius: 48,
    backgroundColor: 'rgba(79, 70, 229,0.85)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  topBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: Spacing.lg,
  },
  topRightCluster: { flexDirection: 'row', gap: Spacing.sm },
  sideRail: { position: 'absolute', right: Spacing.md, gap: Spacing.lg, alignItems: 'center' },
  editChrome: { flex: 1 },
  editScrim: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(0,0,0,0.18)' },
  textImageScrim: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(0,0,0,0.38)' },
  textOrbA: {
    position: 'absolute',
    width: 260,
    height: 260,
    borderRadius: 130,
    backgroundColor: 'rgba(255,255,255,0.12)',
    top: H * 0.18,
    left: -60,
  },
  textOrbB: {
    position: 'absolute',
    width: 180,
    height: 180,
    borderRadius: 90,
    backgroundColor: 'rgba(0,0,0,0.1)',
    bottom: H * 0.28,
    right: -40,
  },
  editBody: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: Spacing.xl,
    paddingBottom: 280,
  },
  audioEditCard: { alignItems: 'center', gap: Spacing.md, marginBottom: Spacing.lg },
  audioReady: { ...Typography.bodyStrong, color: '#FFF' },
  storyTextInput: {
    width: '100%',
    fontSize: 28,
    lineHeight: 36,
    fontWeight: '700',
    color: '#FFF',
    textAlign: 'center',
  },
  storyTextInputLarge: { fontSize: 32, lineHeight: 40 },
  captionTapZone: { paddingHorizontal: Spacing.lg },
  overlayCaption: {
    ...Typography.h3,
    color: '#FFF',
    textAlign: 'center',
    textShadowColor: 'rgba(0,0,0,0.45)',
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 8,
  },
  overlayCaptionHint: { ...Typography.body, color: 'rgba(255,255,255,0.5)', textAlign: 'center' },
  videoBadge: {
    position: 'absolute',
    top: 8,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: Radii.pill,
    backgroundColor: 'rgba(0,0,0,0.45)',
  },
  videoBadgeText: { ...Typography.micro, color: '#FFF', fontWeight: '700' },
  stickerTray: { position: 'absolute', right: 64, top: 120, gap: Spacing.sm, alignItems: 'flex-end' },
  stickerChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: Radii.pill,
    backgroundColor: 'rgba(0,0,0,0.55)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.12)',
  },
  stickerChipText: { ...Typography.caption, color: '#FFF', fontWeight: '600' },
  pollCard: {
    width: '100%',
    maxWidth: 320,
    backgroundColor: '#FFF',
    borderRadius: 22,
    padding: Spacing.lg,
    gap: Spacing.sm,
  },
  questionCard: {
    width: '100%',
    maxWidth: 320,
    backgroundColor: '#FFF',
    borderRadius: 22,
    padding: Spacing.lg,
    gap: Spacing.sm,
  },
  stickerEyebrow: {
    ...Typography.micro,
    color: '#6B7280',
    textTransform: 'uppercase',
    letterSpacing: 0.8,
  },
  stickerTitle: { ...Typography.h3, color: '#111827', paddingVertical: 0 },
  draggableOverlay: {
    position: 'absolute',
    left: W / 2,
    top: H / 2,
    width: Math.min(320, W - 32),
    marginLeft: -Math.min(160, (W - 32) / 2),
  },
  dragHintRow: { width: '100%', flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 4 },
  dragHint: { ...Typography.micro, fontWeight: '600' },
  pollOptionRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm },
  pollOptionAdd: {
    minHeight: 40,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing.xs,
    borderWidth: StyleSheet.hairlineWidth,
    borderStyle: 'dashed',
    borderRadius: Radii.lg,
  },
  pollOptionAddText: { ...Typography.caption, fontWeight: '700' },
  mentionSticker: {
    width: '100%',
    minHeight: 112,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    flexWrap: 'wrap',
    paddingHorizontal: Spacing.lg,
    paddingVertical: Spacing.md,
    borderRadius: Radii.xl,
    gap: Spacing.xs,
  },
  mentionPrefix: { ...Typography.h2, fontWeight: '800' },
  mentionInput: { ...Typography.bodyStrong, minWidth: 170, textAlign: 'center' },
  pollOption: {
    minHeight: 46,
    borderRadius: Radii.lg,
    backgroundColor: '#EEF2FF',
    justifyContent: 'center',
    paddingHorizontal: Spacing.md,
  },
  pollOptionInput: { ...Typography.bodyStrong, color: '#111827' },
  answerBox: {
    minHeight: 48,
    borderRadius: Radii.lg,
    backgroundColor: '#EEF2FF',
    alignItems: 'center',
    justifyContent: 'center',
  },
  answerHint: { ...Typography.bodyStrong },
  musicCard: {
    position: 'absolute',
    left: Spacing.lg,
    right: 72,
    bottom: 300,
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.md,
    padding: Spacing.md,
    borderRadius: Radii.xl,
    backgroundColor: 'rgba(0,0,0,0.55)',
  },
  musicTitle: { ...Typography.bodyStrong, color: '#FFF', fontSize: 14 },
  musicSub: { ...Typography.micro, color: 'rgba(255,255,255,0.65)', marginTop: 2 },
  shareFooter: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    paddingHorizontal: Spacing.lg,
    gap: Spacing.sm,
    paddingTop: Spacing.md,
    backgroundColor: 'rgba(0,0,0,0.55)',
  },
  audienceHeading: {
    ...Typography.micro,
    color: 'rgba(255,255,255,0.55)',
    textTransform: 'uppercase',
    letterSpacing: 0.8,
  },
  ttlRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  ttlChip: {
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: 999,
    borderWidth: 1,
  },
  ttlChipText: { fontSize: 13, fontWeight: '600' },
  audienceRow: { flexDirection: 'row', gap: Spacing.xs },
  audienceChip: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingVertical: 10,
    paddingHorizontal: 8,
    borderRadius: Radii.pill,
    borderWidth: 1.5,
    borderColor: 'rgba(255,255,255,0.22)',
    backgroundColor: 'rgba(0,0,0,0.28)',
  },
  audienceAvatar: { width: 22, height: 22, borderRadius: 11 },
  audienceIcon: {
    width: 22,
    height: 22,
    borderRadius: 11,
    alignItems: 'center',
    justifyContent: 'center',
  },
  audienceLabel: { ...Typography.micro, color: '#FFF', fontWeight: '700', flex: 1, fontSize: 10 },
  toggleCard: {
    borderRadius: Radii.xl,
    backgroundColor: 'rgba(255,255,255,0.08)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.1)',
    overflow: 'hidden',
  },
  toggleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm + 2,
  },
  toggleDivider: { height: StyleSheet.hairlineWidth, backgroundColor: 'rgba(255,255,255,0.1)' },
  toggleTitle: { ...Typography.caption, color: '#FFF', fontWeight: '700' },
  toggleHint: { ...Typography.micro, color: 'rgba(255,255,255,0.55)', marginTop: 1 },
  filterTray: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 92,
    backgroundColor: 'rgba(10,11,15,0.82)',
  },
  shareBtn: {
    minHeight: 52,
    borderRadius: Radii.pill,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing.sm,
  },
  shareBtnText: { ...Typography.bodyStrong, fontSize: 16 },
  sheetBackdrop: { flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(0,0,0,0.45)' },
  privacySheet: {
    borderTopLeftRadius: 28,
    borderTopRightRadius: 28,
    backgroundColor: '#12141A',
    paddingHorizontal: Spacing.xl,
    paddingTop: Spacing.md,
    paddingBottom: Spacing.xxl,
  },
  sheetGrip: {
    alignSelf: 'center',
    width: 40,
    height: 4,
    borderRadius: 2,
    backgroundColor: 'rgba(255,255,255,0.28)',
    marginBottom: Spacing.lg,
  },
  privacyTitle: { ...Typography.h3, color: '#FFF', marginBottom: Spacing.md },
  privacyRow: {
    minHeight: 64,
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.md,
    paddingVertical: Spacing.sm,
  },
  privacyIcon: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: 'rgba(255,255,255,0.12)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  privacyRowText: { ...Typography.bodyStrong, color: '#FFF' },
  privacyRowHint: { ...Typography.micro, color: 'rgba(255,255,255,0.5)', marginTop: 2 },
});
