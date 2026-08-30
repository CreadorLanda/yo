import { Ionicons } from '@expo/vector-icons';
import { useCameraPermission, useMicrophonePermission } from 'react-native-vision-camera';
import {
  RecordingPresets,
  requestRecordingPermissionsAsync,
  setAudioModeAsync,
  useAudioRecorder,
} from 'expo-audio';
import { Image } from 'expo-image';
import * as Haptics from 'expo-haptics';
import * as ImagePicker from 'expo-image-picker';
import { router, useLocalSearchParams } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useEffect, useRef, useState } from 'react';
import {
  Dimensions,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  View,
} from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, {
  FadeIn,
  FadeInDown,
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withSequence,
  withSpring,
} from 'react-native-reanimated';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';

import { Text, TextInput } from '@/components/ui/text';
import { Radii, Spacing, Typography } from '@/constants/theme';
import { bakeFilter } from '@/data/bake-filter';
import { appAlert } from '@/data/dialog-store';
import type { FilterId } from '@/data/photo-filters';
import { FilteredPhoto } from '@/components/media/filtered-photo';
import { FilterStrip } from '@/components/media/filter-strip';
import { FilteredCamera, type FilteredCameraHandle } from '@/components/media/filtered-camera';
import type { StoryVisibility } from '@/data/mock';
import { useProfile } from '@/data/profile-store';
import { queueStoryPublish } from '@/data/story-store';
import { useTheme } from '@/hooks/use-theme';
import { t } from '@/i18n';

/**
 * Instagram-style story composer with Socialize extras:
 * more modes (audio), audience filters (public / contacts / close),
 * anonymous post, comments on/off, anonymous replies.
 */

type Phase = 'capture' | 'edit';
type CaptureMode = 'type' | 'normal' | 'boomerang' | 'handsfree' | 'audio' | 'live';

/**
 * How long each video mode records.
 *
 * Named because the numbers appear twice — once to cap the recording, once to
 * drive the progress ring — and two literals that must agree is one that will
 * eventually not.
 */
const BOOMERANG_SECONDS = 3;
const HANDSFREE_SECONDS = 15;
type EditTool = 'text' | 'sticker' | 'draw' | 'music' | 'filter' | null;
type StickerKind = 'poll' | 'question' | 'mention' | null;

const { width: W, height: H } = Dimensions.get('window');
// The brand violet leads; the rest are the user's own choices, so blue
// stays available as one of them rather than as the product's colour.
const ACCENTS = ['#4F46E5', '#111827', '#10B981', '#FF6FB5', '#F59E0B', '#2D5BFF', '#EF4444', '#FFFFFF'];
/** All creatable modes — live is listed but blocked until hangout ships. */
const CAPTURE_MODES: CaptureMode[] = ['type', 'normal', 'boomerang', 'handsfree', 'audio', 'live'];

/**
 * How long a story stays up. Must stay inside the server's 1..72 bound —
 * see StoryTTLMinHours / StoryTTLMaxHours in the stories module.
 */
const TTL_CHOICES = [1, 3, 6, 12, 24, 36, 48, 72] as const;

export default function CreateStoryScreen() {
  // Prefill from a forward. The composer is the same screen either way — a
  // second one for "forwarded to story" would be a copy that drifts.
  const params = useLocalSearchParams<{
    forwardText?: string;
    forwardMedia?: string;
    forwardKind?: string;
  }>();
  const profile = useProfile();
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const audioRecorder = useAudioRecorder(RecordingPresets.HIGH_QUALITY);

  // A forward arrives with its content already chosen, so it starts in the
  // editor. Opening the camera would ask for something the person just
  // handed over, and there is no way back to it from there.
  const forwarded = !!(params.forwardMedia || params.forwardText);
  const [phase, setPhase] = useState<Phase>(forwarded ? 'edit' : 'capture');
  const [captureMode, setCaptureMode] = useState<CaptureMode>('normal');
  const [mediaUri, setMediaUri] = useState<string | null>(params.forwardMedia ?? null);
  const [isVideo, setIsVideo] = useState(params.forwardKind === 'video');
  const [isAudio, setIsAudio] = useState(false);
  const [audioSec, setAudioSec] = useState(0);
  const [textOnly, setTextOnly] = useState(!!params.forwardText && !params.forwardMedia);
  const [caption, setCaption] = useState(params.forwardText ?? '');
  const [accent, setAccent] = useState(ACCENTS[0]);
  const [audience, setAudience] = useState<StoryVisibility>('contacts');
  // Mirrors the server bound (StoryTTLMinHours..StoryTTLMaxHours). Offering
  // a value the server would clamp means telling the author a story lasts
  // longer than it will.
  const [ttlHours, setTtlHours] = useState(24);
  const [postAnonymous, setPostAnonymous] = useState(false);
  const [allowComments, setAllowComments] = useState(true);
  const [allowAnonReplies, setAllowAnonReplies] = useState(true);
  const [flash, setFlash] = useState(false);
  const [frontCamera, setFrontCamera] = useState(false);
  const [activeTool, setActiveTool] = useState<EditTool>(null);
  const [sticker, setSticker] = useState<StickerKind>(null);
  const [pollA, setPollA] = useState(t('stories.poll_yes'));
  const [pollB, setPollB] = useState(t('stories.poll_no'));
  const [privacyOpen, setPrivacyOpen] = useState(false);
  const [recording, setRecording] = useState(false);
  const [audioRecording, setAudioRecording] = useState(false);
  const audioTimer = useRef<ReturnType<typeof setInterval> | null>(null);
  const audioStart = useRef(0);
  const publishLock = useRef(false);
  const [filter, setFilter] = useState<FilterId>('none');

  /**
   * The camera itself.
   *
   * There was none. `cameraFeed` was a dark rectangle with a grain overlay and
   * an icon in the middle, and pressing the shutter handed off to the system
   * camera app — so the viewfinder showed nothing, and flipping the lens did
   * nothing at all for video, because launchCameraAsync was called without
   * cameraType on that path.
   */
  const cameraRef = useRef<FilteredCameraHandle>(null);
  const stopTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const isVideoMode = captureMode === 'boomerang' || captureMode === 'handsfree';
  const { hasPermission: hasCam, requestPermission: askCam } = useCameraPermission();
  const { hasPermission: hasMic, requestPermission: askMic } = useMicrophonePermission();
  const [camReady, setCamReady] = useState(false);
  const [zoom, setZoom] = useState(0);

  const shutterScale = useSharedValue(1);
  const shutterStyle = useAnimatedStyle(() => ({ transform: [{ scale: shutterScale.value }] }));

  /**
   * Pinch to zoom.
   *
   * The camera takes zoom as 0–1 rather than a lens factor, so the gesture's
   * scale is folded in as a delta from where the pinch started. Clamped, or a
   * fast pinch drives it past the end and the next one starts from nowhere.
   */
  const zoomStart = useSharedValue(0);
  const pinch = Gesture.Pinch()
    .onStart(() => {
      zoomStart.value = zoom;
    })
    .onUpdate((e) => {
      const next = Math.min(1, Math.max(0, zoomStart.value + (e.scale - 1) * 0.35));
      runOnJS(setZoom)(next);
    });

  useEffect(() => {
    setAudioModeAsync({ playsInSilentMode: true, allowsRecording: true }).catch(() => {});
    return () => {
      if (audioTimer.current) clearInterval(audioTimer.current);
    };
  }, []);

  useEffect(() => {
    if (captureMode === 'type' && phase === 'capture') {
      setTextOnly(true);
      setMediaUri(null);
      setIsVideo(false);
      setIsAudio(false);
      setSticker(null);
      setPhase('edit');
      setActiveTool('text');
    }
  }, [captureMode, phase]);

  const selectCaptureMode = (mode: CaptureMode) => {
    if (mode === 'live') {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
      appAlert(t('stories.go_live'), t('stories.live_coming_soon') || 'Live is coming soon.');
      return;
    }
    setCaptureMode(mode);
  };

  const lastGalleryThumb = mediaUri && !isAudio ? mediaUri : null;

  const enterEdit = (opts: {
    uri?: string | null;
    video?: boolean;
    audio?: boolean;
    audioSec?: number;
    asText?: boolean;
  }) => {
    setMediaUri(opts.uri ?? null);
    setIsVideo(!!opts.video);
    setIsAudio(!!opts.audio);
    setAudioSec(opts.audioSec ?? 0);
    setTextOnly(!!opts.asText);
    setPhase('edit');
    setActiveTool(opts.asText ? 'text' : null);
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
  };

  const discardToCapture = () => {
    setPhase('capture');
    setMediaUri(null);
    setTextOnly(false);
    setIsAudio(false);
    setIsVideo(false);
    setAudioSec(0);
    setCaption('');
    setSticker(null);
    setActiveTool(null);
    if (captureMode === 'type' || captureMode === 'audio') {
      setCaptureMode('normal');
    }
  };

  const pickFromLibrary = async () => {
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images', 'videos'],
      quality: 0.9,
      videoMaxDuration: 60,
    });
    if (result.canceled || !result.assets[0]) return;
    const asset = result.assets[0];
    enterEdit({ uri: asset.uri, video: asset.type === 'video' });
  };

  const stopAudioRecording = async () => {
    if (audioTimer.current) {
      clearInterval(audioTimer.current);
      audioTimer.current = null;
    }
    setAudioRecording(false);
    try {
      await audioRecorder.stop();
      const uri = audioRecorder.uri;
      const sec = Math.max(1, Math.round((Date.now() - audioStart.current) / 1000));
      if (uri) enterEdit({ uri, audio: true, audioSec: sec });
    } catch {
      // ignore cancel/errors
    }
  };

  const startAudioRecording = async () => {
    const perm = await requestRecordingPermissionsAsync();
    if (!perm.granted) {
      appAlert(t('stories.voice_mode'), t('stories.tap_to_record'));
      return;
    }
    try {
      await audioRecorder.prepareToRecordAsync();
      audioRecorder.record();
      setAudioRecording(true);
      audioStart.current = Date.now();
      setAudioSec(0);
      audioTimer.current = setInterval(() => {
        setAudioSec(Math.round((Date.now() - audioStart.current) / 1000));
      }, 250);
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    } catch {
      setAudioRecording(false);
    }
  };

  const takePhoto = async () => {
    shutterScale.value = withSequence(
      withSpring(0.86, { damping: 12, stiffness: 280 }),
      withSpring(1, { damping: 14, stiffness: 220 }),
    );
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);

    if (captureMode === 'type') {
      enterEdit({ asText: true });
      return;
    }

    if (captureMode === 'audio') {
      if (audioRecording) await stopAudioRecording();
      else await startAudioRecording();
      return;
    }

    const wantsVideo = captureMode === 'boomerang' || captureMode === 'handsfree';

    // Permission is asked here rather than on mount: someone who opens the
    // composer to type a text story should not be met with a camera prompt.
    if (!hasCam) {
      const granted = await askCam();
      if (!granted) {
        await pickFromLibrary();
        return;
      }
    }
    if (wantsVideo && !hasMic) {
      // A silent video is worth more than no video, so a refused microphone
      // does not stop the recording — it just records without sound.
      await askMic();
    }

    const cam = cameraRef.current;
    if (!cam) return;

    if (wantsVideo) {
      // Tap to start, tap to stop. That is what "handsfree" always meant, and
      // it was never true: the old path handed off to the system camera, which
      // has its own button and its own idea of how long a recording lasts.
      if (recording) {
        await cam.stopRecording();
        return;
      }
      setRecording(true);
      try {
        await cam.startRecording((path: string) => {
          setRecording(false);
          enterEdit({ uri: path, video: true });
        });
        // The cap is ours to enforce: the recorder runs until told to stop, so
        // a mode that promises three seconds has to hold itself to it.
        const cap = captureMode === 'boomerang' ? BOOMERANG_SECONDS : HANDSFREE_SECONDS;
        stopTimer.current = setTimeout(() => {
          void cam.stopRecording();
        }, cap * 1000);
      } catch {
        setRecording(false);
        appAlert(t('stories.capture_failed_title'), t('stories.capture_failed_body'));
      }
      return;
    }

    try {
      const path = await cam.takePhoto();
      if (path) enterEdit({ uri: path });
    } catch {
      appAlert(t('stories.capture_failed_title'), t('stories.capture_failed_body'));
    }
  };

  const buildInteractiveCaption = (): string => {
    if (sticker === 'poll') {
      return JSON.stringify({
        q: caption.trim(),
        a: (pollA || t('stories.poll_yes')).trim(),
        b: (pollB || t('stories.poll_no')).trim(),
      });
    }
    if (sticker === 'question') {
      return JSON.stringify({ q: caption.trim() });
    }
    return caption.trim();
  };

  const resolveDurationSec = (kind: string): number => {
    if (kind === 'audio') return Math.min(30, Math.max(5, audioSec || 5));
    if (kind === 'video') {
      if (captureMode === 'boomerang') return BOOMERANG_SECONDS;
      if (captureMode === 'handsfree') return HANDSFREE_SECONDS;
      return 10;
    }
    if (kind === 'poll' || kind === 'question') return 8;
    if (kind === 'text') return 6;
    return 5;
  };

  /**
   * WhatsApp-style: close the composer immediately and publish in background.
   * Upload + API run via queueStoryPublish; a global toast reports status.
   */
  const publish = async () => {
    if (publishLock.current) return;

    let kind: 'image' | 'video' | 'text' | 'audio' | 'poll' | 'question' = 'text';

    if (sticker === 'poll') {
      kind = 'poll';
      if (!caption.trim()) {
        appAlert(t('stories.poll_mode'), t('stories.poll_placeholder'));
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
      if (!caption.trim()) {
        appAlert(t('stories.sent_notice'), t('stories.creator_need_name') || 'Add a caption');
        return;
      }
    } else if (isAudio && mediaUri) {
      kind = 'audio';
    } else if (mediaUri) {
      kind = isVideo ? 'video' : 'image';
    } else if (caption.trim()) {
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
      kind === 'poll' || kind === 'question' ? buildInteractiveCaption() : caption.trim();

    queueStoryPublish({
      kind,
      caption: bodyCaption,
      localMediaUri: outUri,
      mediaMimeType:
        kind === 'video' ? 'video/mp4' : kind === 'audio' ? 'audio/mp4' : 'image/jpeg',
      audioDurationMs: kind === 'audio' ? audioSec * 1000 : undefined,
      accent,
      visibility: audience,
      ttlHours,
      isAnonymous: postAnonymous,
      // Both toggles have been on this screen from the start and neither
      // reached the server, so the choice was discarded on publish.
      allowComments,
      allowAnonymousReplies: allowComments && allowAnonReplies,
      durationSec: resolveDurationSec(kind),
      authorName: profile.name || 'You',
      authorUsername: profile.username,
      authorAvatar: profile.avatarUri,
    });

    // Leave immediately — status continues on the toast + your story ring.
    router.back();
  };

  // ── CAPTURE ──────────────────────────────────────────────────────────────
  if (phase === 'capture') {
    return (
      <View style={styles.root}>
        <StatusBar style="light" />
        <GestureDetector gesture={pinch}>
        <View style={[styles.cameraFeed, captureMode === 'audio' && styles.audioFeed]}>
          {/*
            The real preview.
            
            What was here was `backgroundColor: '#0A0B0F'` and a grain overlay:
            a picture of a camera. The shutter handed off to the system camera
            app, so nothing you saw before pressing it came from a lens.
            
            Not mounted in audio mode — there is nothing to look at, and
            holding the camera open would spend battery and keep the lens
            busy for a recording that only wants the microphone.
          */}
          {captureMode !== 'audio' && hasCam ? (
            <FilteredCamera
              ref={cameraRef}
              front={frontCamera}
              /* The same matrix as the thumbnail strip and the bake. The
                 preview is the picture, not an approximation of it. */
              filter={filter}
              video={isVideoMode}
              micGranted={!!hasMic}
              /* `flash` was state nothing read — the button toggled its own
                 icon and no light came on. */
              torch={flash}
              zoom={zoom}
              isActive={phase === 'capture'}
              onReady={() => setCamReady(true)}
            />
          ) : null}
          <View style={styles.viewfinderGrain} pointerEvents="none" />
          {captureMode === 'audio' || audioRecording ? (
            <View style={styles.audioCenter}>
              <View style={[styles.audioOrb, audioRecording && styles.audioOrbLive]}>
                <Ionicons name="mic" size={40} color="#FFF" />
              </View>
              <Text style={styles.viewfinderHintText}>
                {audioRecording
                  ? t('stories.recording_audio')
                  : t('stories.tap_to_record')}
              </Text>
              {audioRecording ? (
                <Text style={styles.audioTimer}>{formatSec(audioSec)}</Text>
              ) : null}
              <Waveform live={audioRecording} />
            </View>
          ) : (
            <View style={styles.viewfinderHint} pointerEvents="none">
              {/* Only while there is nothing to see: no permission yet, or the
                  lens still warming up. Over a live preview it would be noise
                  on top of the picture. */}
              {hasCam && camReady ? null : (
                <>
              <Ionicons
                name={frontCamera ? 'person-outline' : 'camera-outline'}
                size={36}
                color="rgba(255,255,255,0.22)"
              />
              <Text style={styles.viewfinderHintText}>
                {recording ? t('stories.recording') : t('stories.tap_to_capture')}
              </Text>
                </>
              )}
            </View>
          )}
        </View>
        </GestureDetector>

        <SafeAreaView style={styles.captureChrome} edges={['top']} pointerEvents="box-none">
          <View style={[styles.topBar, { paddingTop: Spacing.xs }]}>
            <RoundBtn
              onPress={() => {
                if (audioRecording) stopAudioRecording();
                else router.back();
              }}
              icon="close"
            />
            <View style={styles.topRightCluster}>
              {captureMode !== 'audio' ? (
                <RoundBtn
                  onPress={() => setFlash((f) => !f)}
                  icon={flash ? 'flash' : 'flash-off'}
                  active={flash}
                />
              ) : null}
              <RoundBtn onPress={() => setPrivacyOpen(true)} icon="people-outline" />
            </View>
          </View>

          {/* Both side tools were drawn with no onPress at all — two buttons
              that did nothing at any point. Filters land in the next change;
              until they do, saying so beats a tap into silence. */}
          {captureMode !== 'audio' ? (
            <View style={[styles.sideRail, { top: insets.top + 72 }]}>
              <SideTool
                icon="color-filter-outline"
                label={t('stories.filters')}
                onPress={() => appAlert(t('stories.filters'), t('stories.filters_soon'))}
              />
            </View>
          ) : null}
        </SafeAreaView>

        <View style={[styles.captureBottom, { paddingBottom: Math.max(insets.bottom, 12) }]}>
          {captureMode !== 'audio' ? (
            <View style={styles.galleryRail}>
              <Pressable onPress={pickFromLibrary} style={styles.galleryCell}>
                <View style={[StyleSheet.absoluteFill, { backgroundColor: 'rgba(255,255,255,0.12)' }]} />
                <View style={styles.galleryAllOverlay}>
                  <Ionicons name="images" size={18} color="#FFF" />
                </View>
              </Pressable>
            </View>
          ) : (
            <View style={{ height: 8 }} />
          )}

          <ModeCarousel mode={captureMode} onChange={selectCaptureMode} />

          <View style={styles.shutterRow}>
            <Pressable
              onPress={captureMode === 'audio' ? undefined : pickFromLibrary}
              style={[styles.galleryThumbBtn, captureMode === 'audio' && { opacity: 0 }]}
            >
              {lastGalleryThumb ? (
                <Image source={{ uri: lastGalleryThumb }} style={styles.galleryThumbImg} contentFit="cover" />
              ) : (
                <Ionicons name="images-outline" size={22} color="#FFF" />
              )}
            </Pressable>

            <Pressable onPress={takePhoto}>
              <Animated.View
                style={[
                  styles.shutterOuter,
                  captureMode === 'boomerang' && styles.shutterBoomerang,
                  captureMode === 'handsfree' && styles.shutterHandsfree,
                  captureMode === 'audio' && styles.shutterAudio,
                  (recording || audioRecording) && styles.shutterRecording,
                  shutterStyle,
                ]}
              >
                {captureMode === 'audio' ? (
                  <Ionicons
                    name={audioRecording ? 'stop' : 'mic'}
                    size={32}
                    color={audioRecording ? '#EF4444' : '#111'}
                  />
                ) : (
                  <View
                    style={[
                      styles.shutterInner,
                      (captureMode === 'boomerang' ||
                        captureMode === 'handsfree' ||
                        recording) &&
                        styles.shutterInnerVideo,
                    ]}
                  />
                )}
              </Animated.View>
            </Pressable>

            <Pressable
              onPress={() => {
                Haptics.selectionAsync();
                setFrontCamera((v) => !v);
              }}
              style={[styles.flipBtn, captureMode === 'audio' && { opacity: 0 }]}
            >
              <Ionicons name="camera-reverse-outline" size={26} color="#FFF" />
            </Pressable>
          </View>
        </View>

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

  // ── EDIT ─────────────────────────────────────────────────────────────────
  const solidBg = textOnly || isAudio || sticker === 'poll' || sticker === 'question';
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
      {solidBg ? (
        <>
          <View style={[StyleSheet.absoluteFill, { backgroundColor: isAudio ? '#12141A' : accent }]} />
          <View style={styles.textOrbA} />
          <View style={styles.textOrbB} />
        </>
      ) : null}

      <SafeAreaView style={styles.editChrome} edges={['top']} pointerEvents="box-none">
        <View style={styles.topBar}>
          <RoundBtn onPress={discardToCapture} icon="close" />
          <View style={styles.topRightCluster}>
            <RoundBtn onPress={() => setPrivacyOpen(true)} icon="people-outline" />
            {(textOnly || isAudio) && (
              <RoundBtn
                onPress={() => setAccent(ACCENTS[(ACCENTS.indexOf(accent) + 1) % ACCENTS.length])}
                icon="color-palette-outline"
              />
            )}
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
          ) : mediaUri && !textOnly && !sticker ? (
            <Pressable onPress={() => setActiveTool('text')} style={styles.captionTapZone}>
              {caption ? (
                <Text style={styles.overlayCaption}>{caption}</Text>
              ) : (
                <Text style={styles.overlayCaptionHint}>{t('stories.tap_add_text')}</Text>
              )}
            </Pressable>
          ) : null}

          {sticker === 'poll' ? (
            <Animated.View entering={FadeInDown.springify()} style={styles.pollCard}>
              <Text style={styles.stickerEyebrow}>{t('stories.poll_mode')}</Text>
              <TextInput
                value={caption}
                onChangeText={setCaption}
                placeholder={t('stories.poll_placeholder')}
                placeholderTextColor="rgba(17,24,39,0.4)"
                style={styles.stickerTitle}
              />
              <PollOption value={pollA} onChange={setPollA} />
              <PollOption value={pollB} onChange={setPollB} />
            </Animated.View>
          ) : null}

          {sticker === 'question' ? (
            <Animated.View entering={FadeInDown.springify()} style={styles.questionCard}>
              <Text style={styles.stickerEyebrow}>{t('stories.question_mode')}</Text>
              <TextInput
                value={caption}
                onChangeText={setCaption}
                placeholder={t('stories.question_placeholder')}
                placeholderTextColor="rgba(17,24,39,0.4)"
                style={styles.stickerTitle}
              />
              <View style={styles.answerBox}>
                <Text style={[styles.answerHint, { color: colors.primary }]}>
                  {t('stories.answer_placeholder')}
                </Text>
              </View>
            </Animated.View>
          ) : null}

          {isVideo ? (
            <View style={styles.videoBadge}>
              <Ionicons name="play" size={14} color="#FFF" />
              <Text style={styles.videoBadgeText}>
                {captureMode === 'boomerang' ? 'Boomerang' : 'Video'}
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
                setCaption((c) => (c.includes('@') ? c : `${c} @`.trimStart()));
                setActiveTool('text');
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
      <View style={[styles.shareFooter, { paddingBottom: Math.max(insets.bottom, 14) }]}>
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

function formatSec(sec: number) {
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return `${m}:${s.toString().padStart(2, '0')}`;
}

function Waveform({ live }: { live?: boolean }) {
  return (
    <View style={styles.waveform}>
      {Array.from({ length: 22 }, (_, i) => (
        <View
          key={i}
          style={[
            styles.waveBar,
            {
              height: live ? 6 + ((i * 7) % 18) : 4 + (i % 3) * 3,
              opacity: live ? 0.9 : 0.35,
            },
          ]}
        />
      ))}
    </View>
  );
}

function RoundBtn({
  icon,
  onPress,
  active,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  onPress: () => void;
  active?: boolean;
}) {
  return (
    <Pressable
      onPress={onPress}
      style={[styles.roundBtn, active && { backgroundColor: 'rgba(255,255,255,0.28)' }]}
      hitSlop={6}
    >
      <Ionicons name={icon} size={22} color="#FFF" />
    </Pressable>
  );
}

function SideTool({
  icon,
  label,
  onPress,
  active,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  onPress?: () => void;
  active?: boolean;
}) {
  return (
    <Pressable onPress={onPress} style={[styles.sideTool, active && { opacity: 1 }]} hitSlop={4}>
      <Ionicons name={icon} size={22} color="#FFF" />
      <Text style={styles.sideToolLabel}>{label}</Text>
    </Pressable>
  );
}

function ModeCarousel({
  mode,
  onChange,
}: {
  mode: CaptureMode;
  onChange: (m: CaptureMode) => void;
}) {
  const labels: Record<CaptureMode, string> = {
    type: t('stories.mode_type'),
    normal: t('stories.mode_normal'),
    boomerang: t('stories.mode_boomerang'),
    handsfree: t('stories.mode_handsfree'),
    audio: t('stories.mode_audio'),
    live: t('stories.mode_live'),
  };

  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.modeRow}>
      {CAPTURE_MODES.map((item) => {
        const active = mode === item;
        return (
          <Pressable
            key={item}
            onPress={() => {
              Haptics.selectionAsync();
              onChange(item);
            }}
            style={styles.modeItem}
          >
            <Text style={[styles.modeText, active && styles.modeTextActive]}>
              {labels[item].toUpperCase()}
            </Text>
            {active ? <View style={styles.modeDot} /> : <View style={styles.modeDotSpacer} />}
          </Pressable>
        );
      })}
    </ScrollView>
  );
}

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
        trackColor={{ false: 'rgba(255,255,255,0.18)', true: '#4F46E5' }}
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

function PollOption({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  return (
    <View style={styles.pollOption}>
      <TextInput value={value} onChangeText={onChange} style={styles.pollOptionInput} maxLength={28} />
    </View>
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

const CELL = 72;

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#000' },
  cameraFeed: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: '#0A0B0F',
    alignItems: 'center',
    justifyContent: 'center',
  },
  audioFeed: { backgroundColor: '#0E1016' },
  viewfinderGrain: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(255,255,255,0.02)',
  },
  viewfinderHint: { alignItems: 'center', gap: Spacing.sm },
  viewfinderHintText: { ...Typography.caption, color: 'rgba(255,255,255,0.4)' },
  audioCenter: { alignItems: 'center', gap: Spacing.md, paddingHorizontal: Spacing.xl },
  audioOrb: {
    width: 96,
    height: 96,
    borderRadius: 48,
    backgroundColor: 'rgba(79, 70, 229,0.85)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  audioOrbLive: { backgroundColor: 'rgba(239,68,68,0.9)' },
  audioTimer: { ...Typography.h2, color: '#FFF', fontVariant: ['tabular-nums'] },
  waveform: { flexDirection: 'row', alignItems: 'center', gap: 3, height: 28 },
  waveBar: { width: 3, borderRadius: 2, backgroundColor: '#FFF' },
  captureChrome: { ...StyleSheet.absoluteFillObject },
  topBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: Spacing.lg,
  },
  topRightCluster: { flexDirection: 'row', gap: Spacing.sm },
  roundBtn: {
    width: 44,
    height: 44,
    borderRadius: Radii.pill,
    backgroundColor: 'rgba(0,0,0,0.42)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  sideRail: { position: 'absolute', right: Spacing.md, gap: Spacing.lg, alignItems: 'center' },
  sideTool: { alignItems: 'center', gap: 3, minWidth: 52 },
  sideToolLabel: { ...Typography.micro, color: '#FFF', fontWeight: '600', fontSize: 10 },
  captureBottom: { position: 'absolute', left: 0, right: 0, bottom: 0, gap: Spacing.md },
  galleryRail: { paddingHorizontal: Spacing.md, gap: 3 },
  galleryCell: { width: CELL, height: CELL, backgroundColor: '#1A1B22', overflow: 'hidden' },
  galleryVideoMark: {
    position: 'absolute',
    left: 6,
    bottom: 6,
    width: 18,
    height: 18,
    borderRadius: 9,
    backgroundColor: 'rgba(0,0,0,0.5)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  galleryAllOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0,0,0,0.45)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  modeRow: {
    paddingHorizontal: Spacing.xl,
    gap: Spacing.md,
    alignItems: 'center',
    minWidth: W,
    justifyContent: 'center',
  },
  modeItem: { alignItems: 'center', minWidth: 68 },
  modeText: {
    fontSize: 12,
    fontWeight: '700',
    letterSpacing: 0.5,
    color: 'rgba(255,255,255,0.45)',
  },
  modeTextActive: { color: '#FFF' },
  modeDot: { width: 4, height: 4, borderRadius: 2, backgroundColor: '#FFF', marginTop: 4 },
  modeDotSpacer: { height: 8 },
  shutterRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: Spacing.xxl,
    paddingTop: Spacing.xs,
  },
  galleryThumbBtn: {
    width: 48,
    height: 48,
    borderRadius: 10,
    overflow: 'hidden',
    borderWidth: 2,
    borderColor: '#FFF',
    backgroundColor: '#1A1B22',
    alignItems: 'center',
    justifyContent: 'center',
  },
  galleryThumbImg: { width: '100%', height: '100%' },
  shutterOuter: {
    width: 84,
    height: 84,
    borderRadius: 42,
    borderWidth: 5,
    borderColor: '#FFF',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'transparent',
  },
  shutterBoomerang: { borderColor: '#F59E0B' },
  shutterHandsfree: { borderColor: '#EF4444' },
  shutterAudio: { borderColor: '#4F46E5', backgroundColor: '#FFF' },
  shutterRecording: { borderColor: '#EF4444' },
  shutterInner: { width: 64, height: 64, borderRadius: 32, backgroundColor: '#FFF' },
  shutterInnerVideo: { width: 36, height: 36, borderRadius: 8, backgroundColor: '#EF4444' },
  flipBtn: {
    width: 48,
    height: 48,
    borderRadius: Radii.pill,
    backgroundColor: 'rgba(0,0,0,0.4)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  editChrome: { flex: 1 },
  editScrim: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(0,0,0,0.18)' },
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
  liveSetupBg: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: '#0A0B0F',
  },
  livePulseRing: {
    position: 'absolute',
    alignSelf: 'center',
    top: '28%',
    width: 220,
    height: 220,
    borderRadius: 110,
    borderWidth: 2,
    borderColor: 'rgba(239,68,68,0.35)',
  },
  liveSetupCard: {
    alignItems: 'center',
    gap: Spacing.md,
    paddingHorizontal: Spacing.xl,
  },
  liveBadgeBig: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 14,
    paddingVertical: 6,
    borderRadius: Radii.pill,
    backgroundColor: '#EF4444',
  },
  liveDot: { width: 7, height: 7, borderRadius: 4, backgroundColor: '#FFF' },
  liveBadgeBigText: { ...Typography.caption, color: '#FFF', fontWeight: '800', letterSpacing: 1 },
  liveAvatar: {
    width: 96,
    height: 96,
    borderRadius: 48,
    borderWidth: 3,
    borderColor: '#EF4444',
  },
  liveTitle: { ...Typography.h3, color: '#FFF', textAlign: 'center' },
  liveHint: {
    ...Typography.caption,
    color: 'rgba(255,255,255,0.6)',
    textAlign: 'center',
  },
  liveTitleInput: {
    width: '100%',
    marginTop: Spacing.sm,
    ...Typography.bodyStrong,
    color: '#FFF',
    textAlign: 'center',
    paddingVertical: Spacing.md,
    borderRadius: Radii.xl,
    backgroundColor: 'rgba(255,255,255,0.08)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.12)',
  },
});
