import { Ionicons } from '@expo/vector-icons';
import {
  RecordingPresets,
  requestRecordingPermissionsAsync,
  setAudioModeAsync,
  useAudioRecorder,
} from 'expo-audio';
import * as Haptics from 'expo-haptics';
import * as ImagePicker from 'expo-image-picker';
import { forwardRef, memo, useEffect, useRef, useState } from 'react';
import {
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  useWindowDimensions,
  View,
} from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, {
  Easing,
  interpolate,
  interpolateColor,
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { useCameraPermission, useMicrophonePermission } from 'react-native-vision-camera';

import { RoundBtn, SideTool, Waveform } from '@/components/camera/camera-ui';
import { LiveSetupForm } from '@/components/live/live-setup-form';
import { FilteredCamera, type FilteredCameraHandle } from '@/components/media/filtered-camera';
import { SlideThumb } from '@/components/post/slide-thumb';
import { Text } from '@/components/ui/text';
import { CameraColors, Radii, Spacing, Typography } from '@/constants/theme';
import {
  CAMERA_MODES,
  formatClock,
  libraryRequest,
  offersFilter,
  POST_MAX_ITEMS,
  shutterPlan,
  type CameraMode,
  type CapturedItem,
  type StoryTool,
} from '@/data/camera-modes';
import { appAlert } from '@/data/dialog-store';
import { FILTERS, type FilterId } from '@/data/photo-filters';
import { t } from '@/i18n';

/**
 * The camera: one viewfinder and one shutter for everything the app can make.
 *
 * Post, story, reel and live are modes of this, not screens of their own. The
 * lens stays open while the mode changes, so switching costs nothing, and the
 * layout is the one people already know from Instagram: modes along the
 * bottom, a large shutter above them, the library on its left, the lens flip
 * on its right.
 *
 * It only captures. What was captured is handed up, and the screen decides
 * which composer it goes to.
 */

/** A hold shorter than this still records this long, so the file is playable. */
const MIN_CLIP_MS = 600;

export function CameraCapture({
  active,
  mode,
  onModeChange,
  tray,
  onCapture,
  onLibrary,
  onStoryText,
  onTrayRemove,
  onTrayNext,
  liveTitle,
  onClose,
}: {
  /** False while a composer covers the camera: the lens is released. */
  active: boolean;
  mode: CameraMode;
  onModeChange: (mode: CameraMode) => void;
  /** What a post has collected so far. Only shown in post mode. */
  tray: CapturedItem[];
  /** Something came out of the lens or the microphone. */
  onCapture: (item: CapturedItem, filter: FilterId) => void;
  onLibrary: (items: CapturedItem[]) => void;
  /** A story made of text only: there is nothing to capture. */
  onStoryText: () => void;
  onTrayRemove: (index: number) => void;
  onTrayNext: () => void;
  liveTitle?: string;
  onClose: () => void;
}) {
  const insets = useSafeAreaInsets();
  const { width: W, height: H } = useWindowDimensions();
  const audioRecorder = useAudioRecorder(RecordingPresets.HIGH_QUALITY);

  const [tool, setTool] = useState<StoryTool>('camera');
  const [flash, setFlash] = useState(false);
  const [frontCamera, setFrontCamera] = useState(false);
  const [filter, setFilter] = useState<FilterId>('none');
  const [filterOpen, setFilterOpen] = useState(false);
  const [recording, setRecording] = useState(false);
  const [audioRecording, setAudioRecording] = useState(false);
  const [camReady, setCamReady] = useState(false);
  /**
   * This device has no camera at all: not "not yet", but never.
   *
   * Separate from `camReady` because they look identical on screen and mean
   * opposite things: one resolves on its own, the other does not.
   */
  const [noCamera, setNoCamera] = useState(false);
  const noCameraRef = useRef(false);

  const cameraRef = useRef<FilteredCameraHandle>(null);
  const stopTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const recordStart = useRef(0);
  /** The recorder is running, as opposed to still being asked to start. */
  const recorderLive = useRef(false);
  const holding = useRef(false);
  const audioStart = useRef(0);

  const { hasPermission: hasCam, requestPermission: askCam } = useCameraPermission();
  const { hasPermission: hasMic, requestPermission: askMic } = useMicrophonePermission();

  const plan = shutterPlan(mode, tool);
  const filterOffered = offersFilter(mode, tool);
  const busy = recording || audioRecording;
  // A hold records the native stream, which the live filter is not part of.
  // Rather than record something that looks different from the viewfinder,
  // holding is off while a filter is on.
  const canHold = plan.hold && filter === 'none';

  useEffect(() => {
    setAudioModeAsync({ playsInSilentMode: true, allowsRecording: true }).catch(() => {});
    return () => {
      if (stopTimer.current) clearTimeout(stopTimer.current);
    };
  }, []);

  // A filter must not survive into a mode whose shutter records video: the
  // published bytes would be unfiltered.
  useEffect(() => {
    if (!filterOffered) {
      setFilter('none');
      setFilterOpen(false);
    }
  }, [filterOffered]);

  // The cap timer outlives the recording it was set for unless something
  // clears it, and a leftover one fires into the next recording.
  const clearStopTimer = () => {
    if (stopTimer.current) clearTimeout(stopTimer.current);
    stopTimer.current = null;
  };

  const pickFromLibrary = async () => {
    const request = libraryRequest(mode, tray.length);
    if (request.limit === 0) {
      appAlert(t('camera.post_full_title'), t('camera.post_full_body', { max: POST_MAX_ITEMS }));
      return;
    }
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: request.mediaTypes,
      quality: 0.9,
      videoMaxDuration: request.videoMaxSeconds,
      allowsMultipleSelection: request.limit > 1,
      selectionLimit: request.limit,
      orderedSelection: true,
    });
    if (result.canceled || result.assets.length === 0) return;
    onLibrary(
      result.assets.slice(0, request.limit).map((asset) => ({
        uri: asset.uri,
        kind: asset.type === 'video' ? 'video' : 'image',
        durationMs: asset.duration ?? undefined,
        width: asset.width || undefined,
        height: asset.height || undefined,
        mimeType: asset.mimeType ?? undefined,
      })),
    );
  };

  const waitForCameraHandle = async (
    previousHandle?: FilteredCameraHandle | null,
  ): Promise<FilteredCameraHandle | null> => {
    // Granting permission schedules the native camera tree for the next
    // render. Give that render a bounded chance to publish its ref instead of
    // treating the first shutter tap as a capture failure.
    for (let attempt = 0; attempt < 20; attempt += 1) {
      const handle = cameraRef.current;
      if (handle && (!previousHandle || handle !== previousHandle)) return handle;
      await new Promise<void>((resolve) => setTimeout(resolve, 50));
    }
    return cameraRef.current;
  };

  /**
   * The lens, ready to capture, or null when this tap ended up somewhere else
   * (the library, or an alert).
   *
   * Permission is asked here rather than on mount: someone who opens the
   * camera to type a text story should not be met with a camera prompt.
   */
  const readyLens = async (wantsVideo: boolean): Promise<FilteredCameraHandle | null> => {
    let cameraGranted = hasCam;
    const handleBeforeMicRequest = cameraRef.current;
    if (!cameraGranted) {
      cameraGranted = await askCam();
      if (!cameraGranted) {
        await pickFromLibrary();
        return null;
      }
    }
    let microphoneGranted = hasMic;
    if (wantsVideo && !microphoneGranted) {
      // A silent video is worth more than no video, so a refused microphone
      // does not stop the recording: it records without sound.
      microphoneGranted = await askMic();
    }

    // No camera on this hardware: the shutter opens the library instead of
    // reporting a capture failure. There is nothing to retry, and the library
    // is the way anything gets made on a device like this.
    if (noCameraRef.current) {
      await pickFromLibrary();
      return null;
    }

    let cam = cameraRef.current ?? (await waitForCameraHandle());
    if (!cam) {
      appAlert(t('stories.capture_failed_title'), t('stories.camera_not_ready'));
      return null;
    }
    // Permission hooks update on the next render. If this capture granted the
    // microphone, wait for the camera ref backed by the new audio-enabled
    // output before starting the recorder.
    if (wantsVideo && microphoneGranted && !hasMic) {
      cam = (await waitForCameraHandle(handleBeforeMicRequest)) ?? cam;
    }
    return cam;
  };

  const takePhoto = async () => {
    const cam = await readyLens(false);
    if (!cam) return;
    try {
      const path = await cam.takePhoto();
      if (path) onCapture({ uri: path, kind: 'image' }, filter);
      else if (noCameraRef.current) await pickFromLibrary();
      else appAlert(t('stories.capture_failed_title'), t('stories.camera_not_ready'));
    } catch {
      appAlert(t('stories.capture_failed_title'), t('stories.capture_failed_body'));
    }
  };

  const stopVideo = async () => {
    clearStopTimer();
    // Released before the recorder got going: let it run long enough to
    // produce a file that plays, then stop.
    const ranFor = Date.now() - recordStart.current;
    if (ranFor < MIN_CLIP_MS) {
      await new Promise<void>((resolve) => setTimeout(resolve, MIN_CLIP_MS - ranFor));
    }
    recorderLive.current = false;
    try {
      await cameraRef.current?.stopRecording();
    } catch {
      setRecording(false);
    }
  };

  const startVideo = async () => {
    if (recording) return;
    const cam = await readyLens(true);
    if (!cam) return;
    const boomerang = mode === 'story' && tool === 'boomerang';
    setRecording(true);
    recordStart.current = Date.now();
    try {
      await cam.startRecording((path: string) => {
        clearStopTimer();
        recorderLive.current = false;
        setRecording(false);
        onCapture(
          { uri: path, kind: 'video', durationMs: Date.now() - recordStart.current, boomerang },
          'none',
        );
      });
      recorderLive.current = true;
      recordStart.current = Date.now();
      // The cap is ours to enforce: the recorder runs until told to stop, so
      // a mode that promises three seconds has to hold itself to it.
      stopTimer.current = setTimeout(() => {
        void stopVideo();
      }, plan.maxSeconds * 1000);
      // The finger left while permission or the recorder was still starting.
      if (canHold && !holding.current && plan.tap === 'photo') void stopVideo();
    } catch {
      clearStopTimer();
      recorderLive.current = false;
      setRecording(false);
      appAlert(t('stories.capture_failed_title'), t('stories.capture_failed_body'));
    }
  };

  const stopVoice = async () => {
    clearStopTimer();
    setAudioRecording(false);
    try {
      await audioRecorder.stop();
      const uri = audioRecorder.uri;
      const durationMs = Math.max(1000, Date.now() - audioStart.current);
      if (uri) onCapture({ uri, kind: 'audio', durationMs }, 'none');
    } catch {
      // A cancelled recording has nothing to hand over.
    }
  };

  const startVoice = async () => {
    const perm = await requestRecordingPermissionsAsync();
    if (!perm.granted) {
      appAlert(t('stories.voice_mode'), t('camera.mic_needed'));
      return;
    }
    try {
      await audioRecorder.prepareToRecordAsync();
      audioRecorder.record();
      audioStart.current = Date.now();
      setAudioRecording(true);
      stopTimer.current = setTimeout(() => {
        void stopVoice();
      }, plan.maxSeconds * 1000);
    } catch {
      setAudioRecording(false);
    }
  };

  const onShutterTap = () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    if (plan.tap === 'voice') {
      void (audioRecording ? stopVoice() : startVoice());
    } else if (recording) {
      void stopVideo();
    } else if (plan.tap === 'record') {
      void startVideo();
    } else if (plan.tap === 'photo') {
      void takePhoto();
    }
  };

  const onShutterHold = () => {
    if (!canHold || recording) return;
    holding.current = true;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    void startVideo();
  };

  const onShutterRelease = () => {
    if (!holding.current) return;
    holding.current = false;
    if (recorderLive.current) void stopVideo();
  };

  const chooseTool = (next: StoryTool) => {
    Haptics.selectionAsync();
    if (next === 'text') {
      onStoryText();
      return;
    }
    // Tapping the tool that is on turns it off again.
    setTool((current) => (current === next ? 'camera' : next));
  };

  const close = () => {
    if (audioRecording) void stopVoice();
    else if (recording) void stopVideo();
    else onClose();
  };

  // The 4:5 frame a post is shown in. Outside it is dimmed, so what is
  // framed is what the grid and the viewer will crop to.
  const frameHeight = (W * 5) / 4;
  const maskHeight = Math.max(0, (H - frameHeight) / 2);
  const showLens = plan.usesLens && hasCam;
  const hint = busy ? null : shutterHint(mode, tool, canHold);

  return (
    <View style={styles.root}>
      <View style={styles.feed}>
        {/*
          Not mounted for a voice story: there is nothing to look at, and
          holding the camera open would spend battery and keep the lens busy
          for a recording that only wants the microphone.
        */}
        {showLens ? (
          <Viewfinder
            ref={cameraRef}
            frontCamera={frontCamera}
            /* The same matrix as the thumbnail strip and the bake. The
               preview is the picture, not an approximation of it. */
            filter={filter}
            micGranted={!!hasMic}
            flash={flash}
            active={active}
            onReady={() => setCamReady(true)}
            onDeviceAvailability={(available) => {
              noCameraRef.current = !available;
              setNoCamera(!available);
            }}
          />
        ) : null}

        {!plan.usesLens ? (
          <View style={styles.voice}>
            <View style={[styles.voiceOrb, audioRecording && styles.voiceOrbLive]}>
              <Ionicons name="mic" size={40} color={CameraColors.onStage} />
            </View>
            <Text style={styles.voiceText}>
              {audioRecording ? t('stories.recording_audio') : t('stories.tap_to_record')}
            </Text>
            <Waveform live={audioRecording} />
          </View>
        ) : hasCam && camReady && !noCamera ? null : (
          // Only while there is nothing to see: no permission yet, the lens
          // still warming up, or no lens at all.
          <View style={styles.empty} pointerEvents="none">
            <Ionicons
              name={noCamera ? 'images-outline' : 'camera-outline'}
              size={36}
              color={CameraColors.onStageFaint}
            />
            <Text style={styles.emptyText}>
              {noCamera ? t('stories.no_camera') : hasCam ? t('camera.starting') : t('camera.needs_permission')}
            </Text>
          </View>
        )}
      </View>

      {mode === 'post' && maskHeight > 0 ? (
        <>
          <View style={[styles.mask, { top: 0, height: maskHeight }]} pointerEvents="none" />
          <View style={[styles.mask, { bottom: 0, height: maskHeight }]} pointerEvents="none" />
        </>
      ) : null}

      {busy ? <RecordingBar seconds={plan.maxSeconds} /> : null}

      <SafeAreaView style={StyleSheet.absoluteFill} edges={['top']} pointerEvents="box-none">
        <View style={styles.topBar}>
          <RoundBtn onPress={close} icon="close" />
          {busy ? <RecordingClock /> : null}
          <View style={styles.topCluster}>
            {plan.usesLens && !frontCamera ? (
              <RoundBtn onPress={() => setFlash((on) => !on)} icon={flash ? 'flash' : 'flash-off'} active={flash} />
            ) : null}
            {filterOffered && !busy ? (
              <RoundBtn
                onPress={() => setFilterOpen((open) => !open)}
                icon="color-filter-outline"
                active={filterOpen || filter !== 'none'}
              />
            ) : null}
            {mode === 'live' ? <RoundBtn onPress={() => setFrontCamera((v) => !v)} icon="camera-reverse-outline" /> : null}
          </View>
        </View>

        {mode === 'story' && !busy ? (
          <View style={[styles.rail, { top: insets.top + 76 }]}>
            <SideTool icon="text" label={t('camera.tool_text')} onPress={() => chooseTool('text')} />
            <SideTool
              icon="infinite"
              label={t('camera.tool_boomerang')}
              active={tool === 'boomerang'}
              onPress={() => chooseTool('boomerang')}
            />
            <SideTool
              icon="hand-left-outline"
              label={t('camera.tool_handsfree')}
              active={tool === 'handsfree'}
              onPress={() => chooseTool('handsfree')}
            />
            <SideTool
              icon="mic-outline"
              label={t('camera.tool_voice')}
              active={tool === 'voice'}
              onPress={() => chooseTool('voice')}
            />
          </View>
        ) : null}
      </SafeAreaView>

      <KeyboardAvoidingView
        style={styles.bottomWrap}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        pointerEvents="box-none"
      >
        <View style={[styles.bottom, { paddingBottom: Math.max(insets.bottom, Spacing.md) }]}>
          {filterOpen && filterOffered && !busy ? <FilterChips value={filter} onChange={setFilter} /> : null}

          {mode === 'live' ? (
            <LiveSetupForm compact initialTitle={liveTitle} />
          ) : (
            <>
              {mode === 'post' && tray.length > 0 && !busy ? (
                <Tray items={tray} onRemove={onTrayRemove} onNext={onTrayNext} />
              ) : hint ? (
                <Text style={styles.hint}>{hint}</Text>
              ) : null}

              <View style={styles.shutterRow}>
                <Pressable
                  onPress={pickFromLibrary}
                  disabled={busy || !plan.usesLens}
                  style={[styles.library, (busy || !plan.usesLens) && styles.hidden]}
                  accessibilityRole="button"
                  accessibilityLabel={t('camera.library')}
                >
                  {mode === 'post' && tray.length > 0 ? (
                    <SlideThumb
                      uri={tray[tray.length - 1].uri}
                      kind={tray[tray.length - 1].kind === 'video' ? 'video' : 'image'}
                      style={styles.libraryThumb}
                    />
                  ) : (
                    <Ionicons name="images-outline" size={22} color={CameraColors.onStage} />
                  )}
                </Pressable>

                <Shutter
                  look={plan.tap === 'voice' ? 'voice' : plan.tap === 'record' ? 'video' : 'photo'}
                  recording={busy}
                  onPress={onShutterTap}
                  onLongPress={canHold ? onShutterHold : undefined}
                  onPressOut={onShutterRelease}
                />

                <Pressable
                  onPress={() => {
                    Haptics.selectionAsync();
                    setFrontCamera((v) => !v);
                  }}
                  disabled={busy || !plan.usesLens}
                  style={[styles.flip, (busy || !plan.usesLens) && styles.hidden]}
                  accessibilityRole="button"
                  accessibilityLabel={t('camera.flip')}
                >
                  <Ionicons name="camera-reverse-outline" size={26} color={CameraColors.onStage} />
                </Pressable>
              </View>
            </>
          )}

          <ModeBar mode={mode} onChange={onModeChange} disabled={busy} />
        </View>
      </KeyboardAvoidingView>
    </View>
  );
}

function shutterHint(mode: CameraMode, tool: StoryTool, canHold: boolean): string | null {
  const plan = shutterPlan(mode, tool);
  if (plan.tap === 'voice') return null;
  if (plan.tap === 'record') return t('camera.hint_record', { seconds: plan.maxSeconds });
  if (plan.tap === 'photo') return canHold ? t('camera.hint_photo_hold') : t('camera.hint_photo');
  return null;
}

/**
 * The lens and its pinch.
 *
 * Its own component, holding the zoom itself, so a pinch re-renders this and
 * nothing else. The zoom used to be state on the whole screen: every step of
 * a pinch rebuilt the chrome, the mode bar and the shutter along with it,
 * which is what a preview stuttering under a moving finger looks like.
 */
const Viewfinder = memo(
  forwardRef<
    FilteredCameraHandle,
    {
      frontCamera: boolean;
      filter: FilterId;
      micGranted: boolean;
      flash: boolean;
      active: boolean;
      onReady: () => void;
      onDeviceAvailability: (available: boolean) => void;
    }
  >(function Viewfinder({ frontCamera, filter, micGranted, flash, active, onReady, onDeviceAvailability }, ref) {
    const [zoom, setZoom] = useState(0);
    const zoomNow = useSharedValue(0);
    const zoomStart = useSharedValue(0);

    // A different lens has a different range; start it at 1×.
    useEffect(() => {
      zoomNow.value = 0;
      setZoom(0);
    }, [frontCamera, zoomNow]);

    /**
     * `FilteredCamera` takes zoom as 0–1 and maps it onto the lens, so the
     * gesture's scale is folded in as a delta from where the pinch started.
     * Clamped, or a fast pinch drives it past the end and the next one starts
     * from nowhere. Steps smaller than one percent are dropped: the lens
     * cannot show them and each one would cost a render.
     */
    const pinch = Gesture.Pinch()
      .onStart(() => {
        zoomStart.value = zoomNow.value;
      })
      .onUpdate((e) => {
        const next = Math.min(1, Math.max(0, zoomStart.value + (e.scale - 1) * 0.35));
        if (Math.abs(next - zoomNow.value) < 0.01) return;
        zoomNow.value = next;
        runOnJS(setZoom)(next);
      });

    return (
      <GestureDetector gesture={pinch}>
        <View style={StyleSheet.absoluteFill}>
          <FilteredCamera
            ref={ref}
            front={frontCamera}
            filter={filter}
            video
            micGranted={micGranted}
            /* `flash` was once state nothing read: the button toggled its own
               icon and no light came on. */
            torch={flash}
            zoom={zoom}
            isActive={active}
            onReady={onReady}
            onDeviceAvailability={onDeviceAvailability}
          />
        </View>
      </GestureDetector>
    );
  }),
);

/**
 * The shutter. White for a photo, red for anything that records; while
 * recording the centre squares off, which is the stop sign everyone reads.
 */
function Shutter({
  look,
  recording,
  onPress,
  onLongPress,
  onPressOut,
}: {
  look: 'photo' | 'video' | 'voice';
  recording: boolean;
  onPress: () => void;
  onLongPress?: () => void;
  onPressOut: () => void;
}) {
  const rec = useSharedValue(0);
  const pressed = useSharedValue(0);
  const red = look !== 'photo';

  useEffect(() => {
    rec.value = withTiming(recording ? 1 : 0, { duration: 180, easing: Easing.out(Easing.cubic) });
  }, [recording, rec]);

  const ring = useAnimatedStyle(() => ({
    borderColor: interpolateColor(rec.value, [0, 1], [CameraColors.onStage, CameraColors.recording]),
    transform: [{ scale: 1 - pressed.value * 0.06 }],
  }));
  const core = useAnimatedStyle(() => ({
    width: interpolate(rec.value, [0, 1], [SHUTTER_CORE, 30]),
    height: interpolate(rec.value, [0, 1], [SHUTTER_CORE, 30]),
    borderRadius: interpolate(rec.value, [0, 1], [SHUTTER_CORE / 2, 8]),
    backgroundColor: red
      ? CameraColors.recording
      : interpolateColor(rec.value, [0, 1], [CameraColors.onStage, CameraColors.recording]),
  }));

  return (
    <Pressable
      onPress={onPress}
      onLongPress={onLongPress}
      delayLongPress={220}
      onPressIn={() => {
        pressed.value = withTiming(1, { duration: 90 });
      }}
      onPressOut={() => {
        pressed.value = withTiming(0, { duration: 140 });
        onPressOut();
      }}
      hitSlop={8}
      accessibilityRole="button"
      accessibilityLabel={
        recording ? t('stories.stop_recording') : look === 'photo' ? t('camera.shutter_photo') : t('camera.shutter_record')
      }
    >
      <Animated.View style={[styles.shutterRing, ring]}>
        <Animated.View style={core}>
          {look === 'voice' && !recording ? (
            <View style={styles.shutterGlyph}>
              <Ionicons name="mic" size={26} color={CameraColors.onStage} />
            </View>
          ) : null}
        </Animated.View>
      </Animated.View>
    </Pressable>
  );
}

/** A line across the top that fills as the recording uses up its time. */
function RecordingBar({ seconds }: { seconds: number }) {
  const progress = useSharedValue(0);
  useEffect(() => {
    progress.value = withTiming(1, { duration: seconds * 1000, easing: Easing.linear });
  }, [progress, seconds]);
  const fill = useAnimatedStyle(() => ({ transform: [{ scaleX: progress.value }] }));
  return (
    <View style={styles.barTrack} pointerEvents="none">
      <Animated.View style={[styles.barFill, fill]} />
    </View>
  );
}

/** Its own component so the once-a-second tick re-renders a label, not the camera. */
function RecordingClock() {
  const [seconds, setSeconds] = useState(0);
  useEffect(() => {
    const started = Date.now();
    const timer = setInterval(() => setSeconds(Math.floor((Date.now() - started) / 1000)), 250);
    return () => clearInterval(timer);
  }, []);
  return (
    <View style={styles.clock}>
      <View style={styles.clockDot} />
      <Text style={styles.clockText}>{formatClock(seconds)}</Text>
    </View>
  );
}

const ModeBar = memo(function ModeBar({
  mode,
  onChange,
  disabled,
}: {
  mode: CameraMode;
  onChange: (mode: CameraMode) => void;
  disabled: boolean;
}) {
  return (
    <View style={[styles.modeBar, disabled && styles.modeBarDisabled]} accessibilityRole="tablist">
      {CAMERA_MODES.map((item) => {
        const on = item === mode;
        return (
          <Pressable
            key={item}
            disabled={disabled}
            onPress={() => {
              if (on) return;
              Haptics.selectionAsync();
              onChange(item);
            }}
            style={styles.modeItem}
            hitSlop={{ top: 8, bottom: 8 }}
            accessibilityRole="tab"
            accessibilityState={{ selected: on }}
          >
            <Text style={[styles.modeText, on && styles.modeTextOn]}>{modeLabel(item)}</Text>
            <View style={[styles.modeDot, on && styles.modeDotOn]} />
          </Pressable>
        );
      })}
    </View>
  );
});

function modeLabel(mode: CameraMode): string {
  switch (mode) {
    case 'post':
      return t('camera.mode_post');
    case 'reel':
      return t('camera.mode_reel');
    case 'live':
      return t('camera.mode_live');
    default:
      return t('camera.mode_story');
  }
}

/** What a post has collected: thumbnails to drop, and the way forward. */
function Tray({
  items,
  onRemove,
  onNext,
}: {
  items: CapturedItem[];
  onRemove: (index: number) => void;
  onNext: () => void;
}) {
  return (
    <View style={styles.tray}>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.trayItems}>
        {items.map((item, index) => (
          <Pressable
            key={item.uri}
            onPress={() => onRemove(index)}
            accessibilityRole="button"
            accessibilityLabel={t('camera.remove_item', { n: index + 1 })}
          >
            <SlideThumb uri={item.uri} kind={item.kind === 'video' ? 'video' : 'image'} style={styles.trayThumb} />
            <View style={styles.trayRemove}>
              <Ionicons name="close" size={12} color={CameraColors.onStage} />
            </View>
          </Pressable>
        ))}
      </ScrollView>
      <Pressable
        onPress={onNext}
        style={({ pressed }) => [styles.next, pressed && styles.nextPressed]}
        accessibilityRole="button"
      >
        <Text style={styles.nextText}>
          {t('camera.next')} {items.length}/{POST_MAX_ITEMS}
        </Text>
        <Ionicons name="chevron-forward" size={16} color={CameraColors.stage} />
      </Pressable>
    </View>
  );
}

function FilterChips({ value, onChange }: { value: FilterId; onChange: (id: FilterId) => void }) {
  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.filters}>
      {FILTERS.map((item) => {
        const on = item.id === value;
        return (
          <Pressable
            key={item.id}
            onPress={() => onChange(item.id)}
            accessibilityRole="button"
            accessibilityState={{ selected: on }}
            style={[styles.filterChip, on && styles.filterChipOn]}
          >
            <Text style={[styles.filterText, on && styles.filterTextOn]}>{t(`filters.${item.nameKey}`)}</Text>
          </Pressable>
        );
      })}
    </ScrollView>
  );
}

const SHUTTER_RING = 80;
const SHUTTER_CORE = 62;

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: CameraColors.stage },
  feed: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: CameraColors.stage,
    alignItems: 'center',
    justifyContent: 'center',
  },
  empty: { alignItems: 'center', gap: Spacing.sm, paddingHorizontal: Spacing.xxl },
  emptyText: { ...Typography.caption, color: CameraColors.onStageMuted, textAlign: 'center' },
  voice: { alignItems: 'center', gap: Spacing.md, paddingHorizontal: Spacing.xl },
  voiceOrb: {
    width: 96,
    height: 96,
    borderRadius: 48,
    backgroundColor: CameraColors.controlActive,
    alignItems: 'center',
    justifyContent: 'center',
  },
  voiceOrbLive: { backgroundColor: CameraColors.recording },
  voiceText: { ...Typography.caption, color: CameraColors.onStageMuted },
  mask: { position: 'absolute', left: 0, right: 0, backgroundColor: CameraColors.mask },

  topBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: Spacing.lg,
    paddingTop: Spacing.xs,
  },
  topCluster: { flexDirection: 'row', gap: Spacing.sm, minWidth: 44, justifyContent: 'flex-end' },
  rail: { position: 'absolute', left: Spacing.md, gap: Spacing.lg, alignItems: 'center' },

  barTrack: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    height: 3,
    backgroundColor: CameraColors.hairline,
  },
  barFill: { flex: 1, backgroundColor: CameraColors.recording, transformOrigin: 'left' },
  clock: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    height: 30,
    paddingHorizontal: Spacing.md,
    borderRadius: Radii.pill,
    backgroundColor: CameraColors.scrim,
  },
  clockDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: CameraColors.recording },
  clockText: { ...Typography.label, color: CameraColors.onStage, fontVariant: ['tabular-nums'] },

  bottomWrap: { ...StyleSheet.absoluteFillObject, justifyContent: 'flex-end' },
  bottom: { gap: Spacing.md },
  hint: { ...Typography.micro, color: CameraColors.onStageMuted, textAlign: 'center' },
  shutterRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: Spacing.xxl,
  },
  library: {
    width: 48,
    height: 48,
    borderRadius: Radii.md,
    overflow: 'hidden',
    borderWidth: 2,
    borderColor: CameraColors.onStage,
    backgroundColor: CameraColors.control,
    alignItems: 'center',
    justifyContent: 'center',
  },
  libraryThumb: { width: '100%', height: '100%' },
  flip: {
    width: 48,
    height: 48,
    borderRadius: Radii.pill,
    backgroundColor: CameraColors.control,
    alignItems: 'center',
    justifyContent: 'center',
  },
  hidden: { opacity: 0 },
  shutterRing: {
    width: SHUTTER_RING,
    height: SHUTTER_RING,
    borderRadius: SHUTTER_RING / 2,
    borderWidth: 4,
    alignItems: 'center',
    justifyContent: 'center',
  },
  shutterGlyph: { flex: 1, alignItems: 'center', justifyContent: 'center' },

  modeBar: { flexDirection: 'row', justifyContent: 'center', gap: Spacing.xl, paddingTop: Spacing.xs },
  modeBarDisabled: { opacity: 0.35 },
  modeItem: { alignItems: 'center', minWidth: 52, minHeight: 32, justifyContent: 'center' },
  modeText: { ...Typography.label, letterSpacing: 0.6, color: CameraColors.onStageMuted, textTransform: 'uppercase' },
  modeTextOn: { color: CameraColors.onStage, fontWeight: '700' },
  modeDot: { width: 4, height: 4, borderRadius: 2, marginTop: 4, backgroundColor: 'transparent' },
  modeDotOn: { backgroundColor: CameraColors.onStage },

  tray: { flexDirection: 'row', alignItems: 'center', gap: Spacing.md, paddingLeft: Spacing.lg, paddingRight: Spacing.lg },
  trayItems: { gap: Spacing.sm, paddingVertical: 6, paddingRight: Spacing.sm },
  trayThumb: { width: 48, height: 60, borderRadius: Radii.sm, backgroundColor: CameraColors.surface },
  trayRemove: {
    position: 'absolute',
    top: -6,
    right: -6,
    width: 20,
    height: 20,
    borderRadius: 10,
    backgroundColor: CameraColors.scrim,
    borderWidth: 1,
    borderColor: CameraColors.hairline,
    alignItems: 'center',
    justifyContent: 'center',
  },
  next: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 2,
    height: 40,
    paddingLeft: Spacing.lg,
    paddingRight: Spacing.md,
    borderRadius: Radii.pill,
    backgroundColor: CameraColors.onStage,
  },
  nextPressed: { opacity: 0.85 },
  nextText: { ...Typography.label, color: CameraColors.stage, fontVariant: ['tabular-nums'] },

  filters: { gap: Spacing.sm, paddingHorizontal: Spacing.lg },
  filterChip: {
    height: 34,
    justifyContent: 'center',
    borderRadius: Radii.pill,
    borderWidth: 1,
    borderColor: CameraColors.hairline,
    backgroundColor: CameraColors.control,
    paddingHorizontal: Spacing.md,
  },
  filterChipOn: { borderColor: CameraColors.onStage, backgroundColor: CameraColors.controlActive },
  filterText: { ...Typography.micro, color: CameraColors.onStageMuted },
  filterTextOn: { color: CameraColors.onStage, fontWeight: '700' },
});
