import { Ionicons } from '@expo/vector-icons';
import { Image } from 'expo-image';
import { useVideoPlayer, VideoView } from 'expo-video';
import { useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Dimensions,
  FlatList,
  Modal,
  Pressable,
  StatusBar,
  StyleSheet,
  View,
} from 'react-native';
import {
  Gesture,
  GestureDetector,
  GestureHandlerRootView,
} from 'react-native-gesture-handler';
import Animated, {
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Text } from '@/components/ui/text';
import { Radii, Spacing, Typography } from '@/constants/theme';
import { ensureLocal, mediaIdFromURL, useCacheState } from '@/data/media-cache';
import { t } from '@/i18n';

import { SpeedControl, SPEEDS } from './speed-control';

/**
 * Fullscreen gallery for the photos and videos in a thread.
 *
 * Opens on the tapped item and pages sideways through the rest, so the
 * whole conversation's media is reachable without going back each time.
 * Video streams over byte ranges rather than downloading first.
 */

export type ViewerItem = {
  id: string;
  uri: string;
  type: 'image' | 'video';
  senderName?: string;
  timestamp?: string;
  /** Per-file key when the blob is end-to-end encrypted. */
  mediaKey?: { key: string; nonce: string } | null;
  mime?: string;
};

export function MediaViewer({
  items,
  startIndex,
  onClose,
  onReply,
  onForward,
}: {
  items: ViewerItem[];
  startIndex: number;
  onClose: () => void;
  onReply: (id: string) => void;
  onForward: (id: string) => void;
}) {
  const insets = useSafeAreaInsets();
  const { width: screenW, height: screenH } = Dimensions.get('window');
  const listRef = useRef<FlatList<ViewerItem>>(null);

  const [index, setIndex] = useState(startIndex);
  const [chrome, setChrome] = useState(true);
  const [speed, setSpeed] = useState(1);
  const [showSpeed, setShowSpeed] = useState(false);

  const open = items.length > 0;
  const current = items[index];

  useEffect(() => {
    setIndex(startIndex);
  }, [startIndex, items.length]);

  if (!open || !current) return null;

  return (
    <Modal visible animationType="fade" onRequestClose={onClose} statusBarTranslucent>
      {/* Gestures need their own root: a Modal renders outside the app's. */}
      <GestureHandlerRootView style={styles.root}>
        <StatusBar hidden={!chrome} />

        <FlatList
          ref={listRef}
          data={items}
          horizontal
          pagingEnabled
          initialScrollIndex={startIndex}
          getItemLayout={(_d, i) => ({ length: screenW, offset: screenW * i, index: i })}
          keyExtractor={(it) => it.id}
          showsHorizontalScrollIndicator={false}
          onMomentumScrollEnd={(e) => {
            const next = Math.round(e.nativeEvent.contentOffset.x / screenW);
            if (next !== index) setIndex(next);
          }}
          renderItem={({ item, index: i }) => (
            <Page
              item={item}
              active={i === index}
              width={screenW}
              height={screenH}
              speed={speed}
              onToggleChrome={() => setChrome((c) => !c)}
              chromeVisible={chrome}
              controlsBottom={insets.bottom + 78}
              onRateChange={setSpeed}
            />
          )}
        />

        {chrome ? (
          <>
            <View style={[styles.header, { paddingTop: insets.top + Spacing.xs }]}>
              <Pressable onPress={onClose} hitSlop={12} style={styles.iconBtn}>
                <Ionicons name="arrow-back" size={26} color="#fff" />
              </Pressable>
              <View style={{ flex: 1 }}>
                {current.senderName ? (
                  <Text style={styles.sender} numberOfLines={1}>
                    {current.senderName}
                  </Text>
                ) : null}
                <Text style={styles.time} numberOfLines={1}>
                  {current.timestamp}
                  {items.length > 1 ? ` · ${index + 1}/${items.length}` : ''}
                </Text>
              </View>
              {current.type === 'video' ? (
                <Pressable
                  onPress={() => setShowSpeed((v) => !v)}
                  hitSlop={12}
                  style={styles.iconBtn}
                >
                  <Ionicons name="settings-outline" size={22} color="#fff" />
                </Pressable>
              ) : null}
            </View>

            <View style={[styles.footer, { paddingBottom: insets.bottom + Spacing.md }]}>
              <Pressable onPress={() => onReply(current.id)} style={styles.action}>
                <Ionicons name="arrow-undo-outline" size={22} color="#fff" />
                <Text style={styles.actionLabel}>{t('chat.reply')}</Text>
              </Pressable>
              <Pressable onPress={() => onForward(current.id)} style={styles.action}>
                <Ionicons name="arrow-redo-outline" size={22} color="#fff" />
                <Text style={styles.actionLabel}>{t('chat.forward')}</Text>
              </Pressable>
            </View>
          </>
        ) : null}

        {showSpeed && current.type === 'video' ? (
          <SpeedControl
            speed={speed}
            onChange={(s) => setSpeed(s)}
            onClose={() => setShowSpeed(false)}
            bottom={insets.bottom + 90}
          />
        ) : null}
      </GestureHandlerRootView>
    </Modal>
  );
}

/**
 * One page. Images get pinch-zoom and swipe-down-to-close; video autoplays
 * when it becomes the active page and pauses when it leaves.
 */
function Page({
  item,
  active,
  width,
  height,
  speed,
  onToggleChrome,
  chromeVisible,
  controlsBottom,
  onRateChange,
}: {
  item: ViewerItem;
  active: boolean;
  width: number;
  height: number;
  speed: number;
  onToggleChrome: () => void;
  chromeVisible: boolean;
  controlsBottom: number;
  onRateChange: (s: number) => void;
}) {
  const [loading, setLoading] = useState(true);

  // Server bytes are authenticated and possibly encrypted, so nothing can
  // be handed to <Image>/<VideoView> as a URL — resolve to a local file.
  const cache = useCacheState(mediaIdFromURL(item.uri) ?? undefined);
  const localUri = cache.status === 'ready' ? cache.uri : null;

  useEffect(() => {
    const id = mediaIdFromURL(item.uri);
    if (!id) return;
    void ensureLocal(id, { key: item.mediaKey, mime: item.mime });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [item.uri]);

  useEffect(() => {
    if (localUri) setLoading(false);
  }, [localUri]);

  const scale = useSharedValue(1);
  const saved = useSharedValue(1);
  const tx = useSharedValue(0);
  const ty = useSharedValue(0);
  const sx = useSharedValue(0);
  const sy = useSharedValue(0);

  const player = useVideoPlayer(item.type === 'video' ? localUri : null, (p) => {
    p.loop = false;
  });

  // Autoplay the visible page. Without this the viewer opened on a frozen
  // first frame and looked like playback was broken.
  useEffect(() => {
    if (item.type !== 'video') return;
    if (active) playFromEndIfNeeded(player);
    else player.pause();
  }, [active, item.type, player]);

  useEffect(() => {
    if (item.type === 'video') player.playbackRate = speed;
  }, [speed, item.type, player]);

  const pinch = Gesture.Pinch()
    .onStart(() => {
      saved.value = scale.value;
    })
    .onUpdate((e) => {
      scale.value = Math.max(1, Math.min(5, saved.value * e.scale));
    })
    .onEnd(() => {
      if (scale.value <= 1.02) {
        scale.value = withTiming(1);
        tx.value = withTiming(0);
        ty.value = withTiming(0);
      }
    });

  // Only active while zoomed, so the horizontal pager keeps working at 1x.
  const pan = Gesture.Pan()
    .onStart(() => {
      sx.value = tx.value;
      sy.value = ty.value;
    })
    .onUpdate((e) => {
      if (scale.value > 1) {
        tx.value = sx.value + e.translationX;
        ty.value = sy.value + e.translationY;
      }
    });

  const doubleTap = Gesture.Tap()
    .numberOfTaps(2)
    .onEnd(() => {
      if (scale.value > 1) {
        scale.value = withTiming(1);
        tx.value = withTiming(0);
        ty.value = withTiming(0);
      } else {
        scale.value = withTiming(2.5);
      }
    });

  const singleTap = Gesture.Tap().numberOfTaps(1).onEnd(() => onToggleChrome());

  const gesture = Gesture.Exclusive(
    doubleTap,
    Gesture.Simultaneous(pinch, pan),
    singleTap,
  );

  const style = useAnimatedStyle(() => ({
    transform: [{ translateX: tx.value }, { translateY: ty.value }, { scale: scale.value }],
  }));

  return (
    <View style={{ width, height }}>
      {item.type === 'video' ? (
        <>
          <VideoView
            player={player}
            style={{ width, height }}
            contentFit="contain"
            // Own controls: the native overlay fought with the header and
            // the speed zones, leaving neither usable.
            nativeControls={false}
          />
          {/* Tap anywhere toggles the chrome; long-pressing the right half
              speeds up and the left half slows down. The zones sit under
              the controls so they never swallow a control tap. */}
          <SpeedZones
            onTap={onToggleChrome}
            onSeek={(dir) => {
              const total = player.duration ?? 0;
              const next = (player.currentTime ?? 0) + dir * SEEK_STEP;
              player.currentTime = Math.max(0, total > 0 ? Math.min(total, next) : next);
            }}
            onChange={(dir) => {
              const i = SPEEDS.indexOf(player.playbackRate as never);
              const next = SPEEDS[Math.max(0, Math.min(SPEEDS.length - 1, i + dir))];
              player.playbackRate = next;
              onRateChange(next);
            }}
          />
          {chromeVisible ? (
            <VideoControls player={player} bottomInset={controlsBottom} />
          ) : null}
        </>
      ) : (
        <GestureDetector gesture={gesture}>
          <Animated.View style={[{ width, height }, style]}>
            {localUri ? (
              <Image
                source={{ uri: localUri }}
                style={{ width, height }}
                contentFit="contain"
                transition={150}
                onLoadEnd={() => setLoading(false)}
              />
            ) : null}
          </Animated.View>
        </GestureDetector>
      )}

      {loading ? (
        <ActivityIndicator style={StyleSheet.absoluteFill} color="#fff" size="large" />
      ) : null}
    </View>
  );
}

/** Seconds a double-tap jumps, matching what video apps use. */
const SEEK_STEP = 10;

/**
 * Left and right halves of the video, each carrying three gestures:
 *
 *   tap        toggle the chrome
 *   double tap seek back / forward
 *   long press slow down / speed up
 *
 * Pressable cannot tell a single tap from a double one, so these are
 * composed gesture-handler gestures with the double-tap winning the race.
 */
function SpeedZones({
  onChange,
  onTap,
  onSeek,
}: {
  onChange: (dir: -1 | 1) => void;
  onTap: () => void;
  onSeek: (dir: -1 | 1) => void;
}) {
  return (
    <View style={styles.zones}>
      <Zone dir={-1} onTap={onTap} onChange={onChange} onSeek={onSeek} />
      <Zone dir={1} onTap={onTap} onChange={onChange} onSeek={onSeek} />
    </View>
  );
}

function Zone({
  dir,
  onTap,
  onChange,
  onSeek,
}: {
  dir: -1 | 1;
  onTap: () => void;
  onChange: (dir: -1 | 1) => void;
  onSeek: (dir: -1 | 1) => void;
}) {
  const [flash, setFlash] = useState<string | null>(null);

  const show = (label: string) => {
    setFlash(label);
    setTimeout(() => setFlash(null), 600);
  };

  const double = Gesture.Tap()
    .numberOfTaps(2)
    .onEnd(() => {
      runOnJS(onSeek)(dir);
      runOnJS(show)(`${dir > 0 ? '+' : '−'}${SEEK_STEP}s`);
    });

  const long = Gesture.LongPress()
    .minDuration(350)
    .onStart(() => {
      runOnJS(onChange)(dir);
      runOnJS(show)(dir > 0 ? t('viewer.faster') : t('viewer.slower'));
    });

  const single = Gesture.Tap().numberOfTaps(1).onEnd(() => runOnJS(onTap)());

  // Double tap must beat the single tap, and the long press beats both.
  const gesture = Gesture.Exclusive(long, double, single);

  return (
    <GestureDetector gesture={gesture}>
      <View style={styles.zone}>
        {flash ? (
          <View style={styles.flash}>
            <Text style={styles.flashText}>{flash}</Text>
          </View>
        ) : null}
      </View>
    </GestureDetector>
  );
}

/** Compact transport bar: play/pause, scrubber and elapsed time. */
function VideoControls({
  player,
  bottomInset,
}: {
  player: ReturnType<typeof useVideoPlayer>;
  bottomInset: number;
}) {
  const [tick, setTick] = useState({ at: 0, total: 0, playing: false });

  // expo-video exposes no progress hook, so sample it while the bar is up.
  useEffect(() => {
    const id = setInterval(() => {
      setTick({
        at: player.currentTime ?? 0,
        total: player.duration ?? 0,
        playing: player.playing,
      });
    }, 250);
    return () => clearInterval(id);
  }, [player]);

  const pct = tick.total > 0 ? Math.min(1, tick.at / tick.total) : 0;

  return (
    <View style={[styles.controls, { bottom: bottomInset }]} pointerEvents="box-none">
      <Pressable
        onPress={() => (player.playing ? player.pause() : playFromEndIfNeeded(player))}
        hitSlop={10}
        style={styles.playBtn}
      >
        <Ionicons name={tick.playing ? 'pause' : 'play'} size={22} color="#fff" />
      </Pressable>

      <Pressable
        style={styles.track}
        onPress={(e) => {
          // Track has a fixed width, so locationX maps straight to a ratio.
          if (tick.total > 0) {
            player.currentTime = (e.nativeEvent.locationX / TRACK_W) * tick.total;
          }
        }}
      >
        <View style={styles.trackBg} />
        <View style={[styles.trackFill, { width: `${pct * 100}%` }]} />
      </Pressable>

      <Text style={styles.controlsTime}>
        {fmt(tick.at)} / {fmt(tick.total)}
      </Text>
    </View>
  );
}

const TRACK_W = 160;

/**
 * Play, rewinding first when the clip already finished.
 *
 * expo-video leaves currentTime at the end after playback, and calling
 * play() there is a no-op — the video looked unplayable until you left the
 * viewer and came back.
 */
function playFromEndIfNeeded(player: ReturnType<typeof useVideoPlayer>) {
  const total = player.duration ?? 0;
  if (total > 0 && player.currentTime >= total - 0.15) {
    player.currentTime = 0;
  }
  player.play();
}

function fmt(sec: number): string {
  const s = Math.max(0, Math.floor(sec || 0));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#000' },
  header: {
    position: 'absolute',
    left: 0,
    right: 0,
    top: 0,
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
    paddingHorizontal: Spacing.sm,
    paddingBottom: Spacing.sm,
    backgroundColor: 'rgba(0,0,0,0.4)',
  },
  iconBtn: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
  sender: { ...Typography.bodyStrong, color: '#fff' },
  time: { ...Typography.caption, color: 'rgba(255,255,255,0.7)' },
  footer: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    flexDirection: 'row',
    justifyContent: 'center',
    gap: Spacing.xxl,
    paddingTop: Spacing.md,
    backgroundColor: 'rgba(0,0,0,0.4)',
  },
  action: { alignItems: 'center', gap: 2, paddingHorizontal: Spacing.lg },
  actionLabel: { ...Typography.micro, color: '#fff' },
  zones: { ...StyleSheet.absoluteFillObject, flexDirection: 'row' },
  zone: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  flash: {
    paddingHorizontal: Spacing.lg,
    paddingVertical: Spacing.sm,
    borderRadius: Radii.pill,
    backgroundColor: 'rgba(0,0,0,0.6)',
  },
  flashText: { ...Typography.bodyStrong, color: '#fff' },
  controls: {
    position: 'absolute',
    left: 0,
    right: 0,
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
    paddingHorizontal: Spacing.lg,
  },
  playBtn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(0,0,0,0.5)',
  },
  track: { width: TRACK_W, height: 22, justifyContent: 'center' },
  trackBg: {
    height: 3,
    borderRadius: 2,
    backgroundColor: 'rgba(255,255,255,0.35)',
  },
  trackFill: {
    position: 'absolute',
    height: 3,
    borderRadius: 2,
    backgroundColor: '#fff',
  },
  controlsTime: { ...Typography.micro, color: '#fff' },
});
