import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { Image } from 'expo-image';
import { ImageManipulator, SaveFormat } from 'expo-image-manipulator';
import * as VideoThumbnails from 'expo-video-thumbnails';
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Dimensions,
  Modal,
  Platform,
  Pressable,
  StyleSheet,
  View,
} from 'react-native';
import { Gesture, GestureDetector, GestureHandlerRootView } from 'react-native-gesture-handler';
import Svg, { Path } from 'react-native-svg';
import { useVideoPlayer, VideoView } from 'expo-video';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import ViewShot, { captureRef } from 'react-native-view-shot';

import { Text, TextInput } from '@/components/ui/text';
import { Radii, Spacing, Typography } from '@/constants/theme';
import { STICKER_DIMENSION } from '@/data/sticker-format';
import { useTheme } from '@/hooks/use-theme';
import { t } from '@/i18n';

import { CropOverlay, type CropRect } from './editor-crop';
import {
  DraggableOverlay,
  type DrawPath,
  type Overlay,
} from './editor-overlays';
import { StickerPicker } from './sticker-picker';

/**
 * WhatsApp-style editor used for two jobs:
 *
 *   mode 'send'    — crop / rotate / draw / text / stickers + caption,
 *                    then send as an image or video message
 *   mode 'sticker' — the same tools, but the export is a 512x512 WebP
 *                    ready to become a sticker
 *
 * Video is passed through untouched in 'send' mode (overlays would need a
 * re-encode, which this stack cannot do). In 'sticker' mode a video is
 * reduced to a single frame first, which is the honest limit of what can
 * be produced on-device: animated stickers need a WebP animation encoder.
 */

export type EditorAsset = {
  uri: string;
  type: 'image' | 'video';
};

/** How many times a recipient may open it. null = unlimited. */
export const VIEW_LIMITS = [null, 1, 2, 3, 5] as const;

export type EditorResult = {
  uri: string;
  type: 'image' | 'video';
  caption: string;
  /** null = unlimited; otherwise the number of opens allowed. */
  viewLimit: number | null;
  /** True when overlays were flattened into a new file. */
  edited: boolean;
  /** Actual encoding of the exported file — WEBP is Android-only. */
  mime: string;
};

type Tool = 'none' | 'crop' | 'draw' | 'text' | 'sticker';

const PEN_COLORS = ['#FFFFFF', '#111827', '#EF4444', '#F59E0B', '#22C55E', '#3B82F6', '#A855F7'];

export function MediaEditor({
  asset,
  mode,
  onCancel,
  onDone,
}: {
  asset: EditorAsset | null;
  mode: 'send' | 'sticker';
  onCancel: () => void;
  onDone: (result: EditorResult) => void;
}) {
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const shotRef = useRef<View>(null);

  const [tool, setTool] = useState<Tool>('none');
  const [paths, setPaths] = useState<DrawPath[]>([]);
  const [livePath, setLivePath] = useState<string>('');
  const [penColor, setPenColor] = useState(PEN_COLORS[2]);
  const [overlays, setOverlays] = useState<Overlay[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [caption, setCaption] = useState('');
  const [rotation, setRotation] = useState(0);
  const [textDraft, setTextDraft] = useState('');
  const [busy, setBusy] = useState(false);
  const [viewLimit, setViewLimit] = useState<number | null>(null);
  /** Still frame extracted from a video for sticker mode. */
  const [frameUri, setFrameUri] = useState<string | null>(null);
  const [crop, setCrop] = useState<CropRect | null>(null);
  const [aspect, setAspect] = useState<number | null>(null);
  /** Natural pixel size of the source, needed to map crop to real pixels. */
  const [natural, setNatural] = useState<{ w: number; h: number } | null>(null);

  const win = Dimensions.get('window');
  const canvasW = win.width;
  const canvasH = mode === 'sticker' ? win.width : win.height * 0.62;

  // Sticker mode needs a still image; pull a frame from the video. An
  // animated sticker would need a WebP animation encoder, which this stack
  // has no way to run on-device.
  const sourceUri = frameUri ?? asset?.uri ?? '';

  useEffect(() => {
    if (mode !== 'sticker' || asset?.type !== 'video' || frameUri) return;
    let cancelled = false;
    setBusy(true);
    VideoThumbnails.getThumbnailAsync(asset.uri, { time: 0 })
      .then((r) => {
        if (!cancelled) setFrameUri(r.uri);
      })
      .catch(() => {
        if (!cancelled) onCancel();
      })
      .finally(() => {
        if (!cancelled) setBusy(false);
      });
    return () => {
      cancelled = true;
    };
    // onCancel is stable enough here; re-running on identity changes would
    // re-extract the frame on every parent render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, asset?.type, asset?.uri, frameUri]);

  // Looping muted preview so the user sees the clip they picked.
  const player = useVideoPlayer(asset?.type === 'video' ? asset.uri : null, (p) => {
    p.loop = true;
    p.muted = true;
  });

  const draw = Gesture.Pan()
    .onStart((e) => {
      setLivePath(`M ${e.x.toFixed(1)} ${e.y.toFixed(1)}`);
    })
    .onUpdate((e) => {
      setLivePath((p) => `${p} L ${e.x.toFixed(1)} ${e.y.toFixed(1)}`);
    })
    .onEnd(() => {
      setLivePath((p) => {
        if (p) {
          setPaths((prev) => [
            ...prev,
            { id: `p${Date.now()}`, d: p, color: penColor, width: 5 },
          ]);
        }
        return '';
      });
    })
    .runOnJS(true);

  const addText = () => {
    const value = textDraft.trim();
    if (!value) return setTool('none');
    setOverlays((prev) => [
      ...prev,
      {
        id: `t${Date.now()}`,
        kind: 'text',
        value,
        color: penColor,
        x: 0.3,
        y: 0.4,
        scale: 1,
        rotation: 0,
      },
    ]);
    setTextDraft('');
    setTool('none');
  };

  const commitOverlay = useCallback((id: string, next: Partial<Overlay>) => {
    setOverlays((prev) =>
      prev.map((o) => (o.id === id ? ({ ...o, ...next } as Overlay) : o)),
    );
  }, []);

  const undo = () => {
    Haptics.selectionAsync().catch(() => {});
    if (overlays.length) return setOverlays((p) => p.slice(0, -1));
    if (paths.length) return setPaths((p) => p.slice(0, -1));
  };

  const hasEdits = paths.length > 0 || overlays.length > 0 || rotation !== 0 || !!crop;

  const finish = async () => {
    if (!asset) return;
    setBusy(true);
    try {
      // Video in send mode goes through untouched — flattening overlays
      // onto video would require re-encoding.
      if (mode === 'send' && asset.type === 'video') {
        onDone({ uri: asset.uri, type: 'video', caption, edited: false, mime: 'video/mp4', viewLimit });
        return;
      }

      let uri = sourceUri;

      // Crop first: the frame is in canvas pixels, so scale it into the
      // source image's own pixel space before asking for the cut.
      if (crop && natural) {
        const shownW = canvasW;
        const shownH = canvasH;
        // contain-fit leaves letterboxing; work out the drawn rect.
        const scale = Math.min(shownW / natural.w, shownH / natural.h);
        const drawnW = natural.w * scale;
        const drawnH = natural.h * scale;
        const offX = (shownW - drawnW) / 2;
        const offY = (shownH - drawnH) / 2;

        const originX = Math.max(0, (crop.x - offX) / scale);
        const originY = Math.max(0, (crop.y - offY) / scale);
        const cw = Math.min(natural.w - originX, crop.width / scale);
        const ch = Math.min(natural.h - originY, crop.height / scale);

        if (cw > 1 && ch > 1) {
          const ctx = ImageManipulator.manipulate(uri);
          ctx.crop({ originX, originY, width: cw, height: ch });
          const rendered = await ctx.renderAsync();
          const saved = await rendered.saveAsync({ format: SaveFormat.PNG });
          uri = saved.uri;
        }
      }

      // Rotation is pixel work, so do it before compositing overlays.
      if (rotation !== 0) {
        const ctx = ImageManipulator.manipulate(uri);
        ctx.rotate(rotation);
        const rendered = await ctx.renderAsync();
        const saved = await rendered.saveAsync({ format: SaveFormat.PNG });
        uri = saved.uri;
      }

      // Overlays are views, so flatten them by capturing the composition.
      if (paths.length > 0 || overlays.length > 0) {
        uri = await captureRef(shotRef, { format: 'png', quality: 1, result: 'tmpfile' });
      }

      if (mode === 'sticker') {
        const ctx = ImageManipulator.manipulate(uri);
        ctx.resize({ width: STICKER_DIMENSION, height: STICKER_DIMENSION });
        const rendered = await ctx.renderAsync();
        // WEBP is Android-only in expo-image-manipulator; PNG elsewhere and
        // the server keeps it as-is (it validates dimensions, not codec
        // preference, and a PNG sticker still renders).
        const webp = Platform.OS === 'android';
        const saved = await rendered.saveAsync({
          format: webp ? SaveFormat.WEBP : SaveFormat.PNG,
          compress: 0.9,
        });
        onDone({
          uri: saved.uri,
          type: 'image',
          caption: '',
          edited: true,
          mime: webp ? 'image/webp' : 'image/png',
          // A sticker is a library item, not a message; limits do not apply.
          viewLimit: null,
        });
        return;
      }

      onDone({ uri, type: 'image', caption, edited: hasEdits, mime: 'image/png', viewLimit });
    } catch {
      // Fall back to the untouched asset rather than losing the user's pick.
      onDone({
        uri: asset.uri,
        type: asset.type,
        caption,
        edited: false,
        mime: asset.type === 'video' ? 'video/mp4' : 'image/jpeg',
        viewLimit,
      });
    } finally {
      setBusy(false);
    }
  };

  if (!asset) return null;

  return (
    <Modal visible animationType="slide" onRequestClose={onCancel} statusBarTranslucent>
      {/* A Modal renders in its own native hierarchy, outside the root view
          in app/_layout. Without a root here, no gesture-handler gesture
          inside the editor fires at all — dragging, drawing and the crop
          handles were all dead. */}
      <GestureHandlerRootView style={[styles.root, { paddingTop: insets.top }]}>
        {/* Toolbar */}
        <View style={styles.toolbar}>
          <Pressable onPress={onCancel} hitSlop={10} style={styles.toolBtn}>
            <Ionicons name="close" size={26} color="#fff" />
          </Pressable>
          <View style={{ flex: 1 }} />
          {mode === 'sticker' || asset.type === 'image' ? (
            <>
              <Pressable
                onPress={() => setTool(tool === 'crop' ? 'none' : 'crop')}
                hitSlop={10}
                style={[styles.toolBtn, tool === 'crop' && styles.toolActive]}
              >
                <Ionicons name="crop" size={22} color="#fff" />
              </Pressable>
              <Pressable
                onPress={() => setRotation((r) => (r + 90) % 360)}
                hitSlop={10}
                style={styles.toolBtn}
              >
                <Ionicons name="refresh" size={22} color="#fff" />
              </Pressable>
              <Pressable
                onPress={() => setTool(tool === 'draw' ? 'none' : 'draw')}
                hitSlop={10}
                style={[styles.toolBtn, tool === 'draw' && styles.toolActive]}
              >
                <Ionicons name="brush" size={22} color="#fff" />
              </Pressable>
              <Pressable
                onPress={() => setTool(tool === 'text' ? 'none' : 'text')}
                hitSlop={10}
                style={[styles.toolBtn, tool === 'text' && styles.toolActive]}
              >
                <Ionicons name="text" size={22} color="#fff" />
              </Pressable>
              <Pressable
                onPress={() => setTool(tool === 'sticker' ? 'none' : 'sticker')}
                hitSlop={10}
                style={[styles.toolBtn, tool === 'sticker' && styles.toolActive]}
              >
                <Ionicons name="happy-outline" size={22} color="#fff" />
              </Pressable>
              <Pressable
                onPress={undo}
                hitSlop={10}
                style={styles.toolBtn}
                disabled={!paths.length && !overlays.length}
              >
                <Ionicons
                  name="arrow-undo"
                  size={22}
                  color={paths.length || overlays.length ? '#fff' : 'rgba(255,255,255,0.35)'}
                />
              </Pressable>
            </>
          ) : null}
        </View>

        {/* Canvas */}
        <View style={styles.canvasWrap}>
          <ViewShot
            ref={shotRef as never}
            style={[
              styles.canvas,
              { width: canvasW, height: canvasH },
              mode === 'sticker' && styles.stickerCanvas,
            ]}
          >
            <View style={StyleSheet.absoluteFill}>
                {asset.type === 'video' && mode === 'send' ? (
                  <>
                    <VideoView
                      player={player}
                      style={StyleSheet.absoluteFill}
                      contentFit="contain"
                      nativeControls={false}
                    />
                    <Pressable
                      style={styles.playToggle}
                      onPress={() => (player.playing ? player.pause() : player.play())}
                    >
                      <Ionicons
                        name={player.playing ? 'pause' : 'play'}
                        size={30}
                        color="#fff"
                      />
                    </Pressable>
                  </>
                ) : (
                  <Image
                    source={{ uri: sourceUri }}
                    style={StyleSheet.absoluteFill}
                    contentFit={mode === 'sticker' ? 'cover' : 'contain'}
                    transition={120}
                    onLoad={(e) =>
                      setNatural({ w: e.source.width, h: e.source.height })
                    }
                  />
                )}

                <Svg style={StyleSheet.absoluteFill} pointerEvents="none">
                  {paths.map((p) => (
                    <Path
                      key={p.id}
                      d={p.d}
                      stroke={p.color}
                      strokeWidth={p.width}
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      fill="none"
                    />
                  ))}
                  {livePath ? (
                    <Path
                      d={livePath}
                      stroke={penColor}
                      strokeWidth={5}
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      fill="none"
                    />
                  ) : null}
                </Svg>

                {tool === 'crop' ? (
                  <CropOverlay
                    canvasW={canvasW}
                    canvasH={canvasH}
                    aspect={aspect}
                    onAspect={(_k, r) => setAspect(r)}
                    onChange={setCrop}
                  />
                ) : null}

                {overlays.map((o) => (
                  <DraggableOverlay
                    key={o.id}
                    overlay={o}
                    canvasW={canvasW}
                    canvasH={canvasH}
                    selected={selectedId === o.id}
                    onSelect={() => setSelectedId(o.id)}
                    onCommit={(next) => commitOverlay(o.id, next)}
                  />
                ))}

                {/* Drawing surface goes last so it covers the overlays while
                    the brush is active, and does not exist otherwise. */}
                {tool === 'draw' ? (
                  <GestureDetector gesture={draw}>
                    <View style={StyleSheet.absoluteFill} />
                  </GestureDetector>
                ) : null}
            </View>
          </ViewShot>
        </View>

        {/* Colour strip while drawing or typing */}
        {tool === 'draw' || tool === 'text' ? (
          <View style={styles.colors}>
            {PEN_COLORS.map((c) => (
              <Pressable
                key={c}
                onPress={() => setPenColor(c)}
                style={[
                  styles.swatch,
                  { backgroundColor: c },
                  penColor === c && styles.swatchActive,
                ]}
              />
            ))}
          </View>
        ) : null}

        {/* Text composer */}
        {tool === 'text' ? (
          <View style={styles.textRow}>
            <TextInput
              value={textDraft}
              onChangeText={setTextDraft}
              placeholder={t('editor.text_placeholder')}
              placeholderTextColor="rgba(255,255,255,0.5)"
              style={[styles.textInput, { color: penColor }]}
              autoFocus
              onSubmitEditing={addText}
            />
            <Pressable onPress={addText} hitSlop={10} style={styles.addBtn}>
              <Ionicons name="checkmark" size={22} color="#fff" />
            </Pressable>
          </View>
        ) : null}

        {/* Sticker tray */}
        {tool === 'sticker' ? (
          <StickerPicker
            visible
            height={260}
            onPick={(s) => {
              setOverlays((prev) => [
                ...prev,
                {
                  id: `s${Date.now()}`,
                  kind: 'sticker',
                  uri: s.url,
                  x: 0.32,
                  y: 0.35,
                  scale: 1,
                  rotation: 0,
                },
              ]);
              setTool('none');
            }}
          />
        ) : null}

        {/* The editing tools are hidden for video; say why rather than
            leaving the toolbar mysteriously empty. */}
        {asset.type === 'video' && mode === 'send' ? (
          <Text style={styles.videoHint}>{t('editor.video_no_overlays')}</Text>
        ) : null}

        {/* Bottom bar: caption + send */}
        <View style={[styles.bottom, { paddingBottom: insets.bottom + Spacing.sm }]}>
          {mode === 'send' ? (
            <Pressable
              onPress={() => {
                const i = VIEW_LIMITS.indexOf(viewLimit as never);
                setViewLimit(VIEW_LIMITS[(i + 1) % VIEW_LIMITS.length]);
              }}
              hitSlop={8}
              style={[styles.viewLimit, viewLimit != null && styles.viewLimitOn]}
              accessibilityLabel={t('editor.view_limit')}
            >
              <Ionicons
                name={viewLimit == null ? 'infinite-outline' : 'eye-outline'}
                size={18}
                color="#fff"
              />
              {viewLimit != null ? (
                <Text style={styles.viewLimitText}>{viewLimit}</Text>
              ) : null}
            </Pressable>
          ) : null}
          {mode === 'send' ? (
            <TextInput
              value={caption}
              onChangeText={setCaption}
              placeholder={t('editor.caption_placeholder')}
              placeholderTextColor="rgba(255,255,255,0.5)"
              style={styles.caption}
              multiline
            />
          ) : (
            <Text style={styles.stickerHint}>{t('editor.sticker_hint')}</Text>
          )}
          <Pressable
            onPress={finish}
            disabled={busy}
            style={[styles.send, { backgroundColor: colors.primary }]}
          >
            {busy ? (
              <ActivityIndicator color={colors.onPrimary} />
            ) : (
              <Ionicons
                name={mode === 'sticker' ? 'checkmark' : 'send'}
                size={22}
                color={colors.onPrimary}
              />
            )}
          </Pressable>
        </View>
      </GestureHandlerRootView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#000' },
  toolbar: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: Spacing.sm,
    height: 48,
    gap: Spacing.xs,
  },
  toolBtn: {
    width: 40,
    height: 40,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: Radii.sm,
  },
  toolActive: { backgroundColor: 'rgba(255,255,255,0.18)' },
  canvasWrap: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  canvas: { backgroundColor: '#000', overflow: 'hidden' },
  stickerCanvas: { borderRadius: Radii.md },
  playToggle: {
    position: 'absolute',
    alignSelf: 'center',
    top: '45%',
    width: 60,
    height: 60,
    borderRadius: 30,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(0,0,0,0.45)',
  },
  videoHint: { ...Typography.caption, color: 'rgba(255,255,255,0.7)', paddingHorizontal: Spacing.xl, textAlign: 'center' },
  colors: {
    flexDirection: 'row',
    justifyContent: 'center',
    gap: Spacing.sm,
    paddingVertical: Spacing.sm,
  },
  swatch: { width: 26, height: 26, borderRadius: 13, borderWidth: 2, borderColor: 'transparent' },
  swatchActive: { borderColor: '#fff', transform: [{ scale: 1.15 }] },
  textRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: Spacing.md,
    gap: Spacing.sm,
  },
  textInput: { flex: 1, ...Typography.h3, paddingVertical: Spacing.sm },
  addBtn: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
  bottom: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: Spacing.sm,
    paddingHorizontal: Spacing.md,
    paddingTop: Spacing.sm,
  },
  caption: {
    flex: 1,
    color: '#fff',
    ...Typography.body,
    maxHeight: 96,
    backgroundColor: 'rgba(255,255,255,0.12)',
    borderRadius: Radii.pill,
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm,
  },
  stickerHint: { flex: 1, ...Typography.caption, color: 'rgba(255,255,255,0.7)' },
  send: { width: 48, height: 48, borderRadius: 24, alignItems: 'center', justifyContent: 'center' },
  viewLimit: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 2,
    height: 40,
    paddingHorizontal: Spacing.sm,
    borderRadius: Radii.pill,
    backgroundColor: 'rgba(255,255,255,0.14)',
  },
  viewLimitOn: { backgroundColor: 'rgba(255,255,255,0.35)' },
  viewLimitText: { ...Typography.caption, color: '#fff', fontWeight: '700' },
});
