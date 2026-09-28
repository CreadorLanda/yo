import { Canvas, ColorMatrix, Image as SkiaImage, Skia } from '@shopify/react-native-skia';
import type { SkImage } from '@shopify/react-native-skia';
import {
  Component,
  forwardRef,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { StyleSheet, View } from 'react-native';
import { useSharedValue } from 'react-native-reanimated';
import {
  Camera,
  useCameraDevice,
  useFrameOutput,
  usePhotoOutput,
  useVideoOutput,
  type CameraDevice,
  type CameraPhotoOutput,
  type CameraVideoOutput,
} from 'react-native-vision-camera';

import { filterById, type FilterId } from '@/data/photo-filters';

export type FilteredCameraHandle = {
  takePhoto: () => Promise<string | null>;
  startRecording: (onDone: (path: string) => void) => Promise<void>;
  stopRecording: () => Promise<void>;
};

type Recorder = Awaited<ReturnType<CameraVideoOutput['createRecorder']>>;

/**
 * How far the pinch reaches past 1×.
 *
 * Digital zoom beyond this is mush, and some sensors report a max of 100×.
 */
const MAX_ZOOM_FACTOR = 8;

/**
 * The composer's 0–1 pinch position, as a lens factor this device accepts.
 *
 * VisionCamera takes zoom as a factor between `device.minZoom` and
 * `device.maxZoom` — usually 1 and something like 10. The composer was written
 * against expo-camera, which took 0–1, and it still hands over 0–1. So the
 * camera opened at zoom 0, below every lens's minimum: iOS clamped it, Android
 * rejected it, and every pinch after that was rejected too and logged as an
 * error. Pinch-to-zoom never did anything.
 *
 * 0 is 1× rather than `minZoom`, because on a phone with an ultra-wide the
 * minimum is 0.5×, and nobody expects the camera to open ultra-wide.
 */
function lensZoom(device: CameraDevice, zoom: number): number {
  const base = Math.max(device.minZoom, Math.min(1, device.maxZoom));
  const top = Math.min(device.maxZoom, base * MAX_ZOOM_FACTOR);
  const t = Math.min(1, Math.max(0, zoom));
  return base + t * (top - base);
}

/**
 * The camera, with the picked filter on the live preview.
 *
 * expo-camera could not do this: it owns its preview surface and does not hand
 * frames to anything. VisionCamera does — `frame.getNativeBuffer()` gives a
 * pointer Skia can import with no copy — so the frames go through the same
 * colour matrix the thumbnail strip and the bake use. One set of numbers.
 *
 * The whole thing is built to fail soft. The native preview is always mounted
 * underneath; the Skia canvas only goes over it when a filter is picked, and
 * only draws once a frame has actually arrived. So the failure mode of the
 * frame pipeline is "the preview is not tinted" rather than a black rectangle
 * where the camera was.
 *
 * `none` does not run the pipeline at all — not attached, and not created
 * either. See `PlainCamera`.
 */
export const FilteredCamera = forwardRef<
  FilteredCameraHandle,
  {
    front: boolean;
    filter: FilterId;
    micGranted: boolean;
    video: boolean;
    torch: boolean;
    /** Pinch position, 0–1. Mapped to this lens's own range here. */
    zoom: number;
    isActive: boolean;
    onReady?: () => void;
    /**
     * Whether this device has a camera at all.
     *
     * Reported rather than swallowed. `useCameraDevice` returns undefined on
     * hardware with no camera — an emulator, a container like Waydroid, some
     * tablets — and the component below then has nothing to render. Left
     * unsaid, that is indistinguishable from a lens still warming up, and it
     * never stops looking that way.
     *
     * Also reported false when the camera tree throws — see `CameraGuard`.
     */
    onDeviceAvailability?: (available: boolean) => void;
  }
>(function FilteredCamera(
  { front, filter, video, torch, zoom, isActive, micGranted, onReady, onDeviceAvailability },
  ref,
) {
  const device = useCameraDevice(front ? 'front' : 'back');

  // Kept in a ref so a caller that passes an inline arrow does not re-run
  // this on every render of the composer.
  const availabilityRef = useRef(onDeviceAvailability);
  availabilityRef.current = onDeviceAvailability;
  useEffect(() => {
    availabilityRef.current?.(!!device);
  }, [device]);
  const matrix = filterById(filter).matrix;

  const photoOutput = usePhotoOutput({ qualityPrioritization: 'quality' });
  // Audio only once the microphone is actually granted. Configuring a video
  // output with audio the app has no permission for makes the whole camera
  // session fail to configure — the preview never appears, and on some devices
  // it takes the app with it. A silent recording is the graceful loss.
  const videoOutput = useVideoOutput({ enableAudio: micGranted });

  /**
   * The recording in progress.
   *
   * A ref, not state. It was state, and the handle was rebuilt whenever it
   * changed — so the composer's cap timer, which captured the handle from
   * before the recording started, called a `stopRecording` that saw no
   * recorder and did nothing. Boomerang ran until someone tapped.
   */
  const recorderRef = useRef<Recorder | null>(null);

  // Leaving the screen mid-recording tears the session down under a live
  // recorder. Stop it first; the file it produces is simply not used.
  useEffect(
    () => () => {
      recorderRef.current?.stopRecording().catch(() => {});
      recorderRef.current = null;
    },
    [],
  );

  useImperativeHandle(
    ref,
    () => ({
      async takePhoto() {
        const photo = await photoOutput.capturePhoto({}, {});
        try {
          return await photo.saveToTemporaryFileAsync();
        } finally {
          photo.dispose();
        }
      },
      async startRecording(onDone) {
        const rec = await videoOutput.createRecorder({});
        recorderRef.current = rec;
        await rec.startRecording(
          (filePath) => {
            recorderRef.current = null;
            onDone(filePath);
          },
          () => {
            recorderRef.current = null;
          },
        );
      },
      async stopRecording() {
        const rec = recorderRef.current;
        recorderRef.current = null;
        await rec?.stopRecording();
      },
    }),
    [photoOutput, videoOutput],
  );

  // Still just a blank here: what to say about a missing camera is the
  // composer's decision, not this component's — it owns the chrome, and it
  // is the one that can offer the gallery instead.
  if (!device) return <View style={styles.blank} />;

  const common: CameraProps = {
    device,
    isActive,
    photoOutput,
    videoOutput,
    zoom: lensZoom(device, zoom),
    torchMode: torch && !front ? 'on' : 'off',
    onReady,
  };

  return (
    <CameraGuard
      // A flipped lens or a different filter is a different camera tree; give
      // it its own chance rather than keeping the blank from the last one.
      resetKey={`${front}:${matrix ? 'filtered' : 'plain'}`}
      onFail={() => availabilityRef.current?.(false)}
    >
      {matrix ? (
        <FilteredPreview {...common} matrix={matrix} />
      ) : (
        <PlainCamera {...common} />
      )}
    </CameraGuard>
  );
});

type CameraProps = {
  device: CameraDevice;
  isActive: boolean;
  photoOutput: CameraPhotoOutput;
  videoOutput: CameraVideoOutput;
  zoom: number;
  torchMode: 'on' | 'off';
  onReady?: () => void;
};

/**
 * The camera with no filter: the preview, the photo output, the video output.
 *
 * Nothing else, and in particular no `useFrameOutput`. That hook does more
 * than build an output object — it creates a worklet runtime on the camera's
 * frame thread and ships the `onFrame` worklet to it, on mount, whether or
 * not the output is ever handed to the camera. It lived in the one component
 * the composer always renders, so opening the camera went through the whole
 * worklets bridge every time: when any part of it failed, the camera died on
 * open with no filter anywhere in sight. That is the crash this file has been
 * patched for twice. Keeping it out of this component is what makes `none`
 * safe, not a comment saying the output is "not attached".
 */
function PlainCamera({ photoOutput, videoOutput, onReady, ...props }: CameraProps) {
  return (
    <Camera
      style={StyleSheet.absoluteFill}
      {...props}
      outputs={[photoOutput, videoOutput]}
      onPreviewStarted={onReady}
      resizeMode="cover"
    />
  );
}

/**
 * The camera with a filter picked: the frame output joins the other two.
 *
 * Its own component so the frame pipeline — worklet runtime included — exists
 * only while a filter is on screen. Going from `none` to a filter restarts the
 * session with the extra output; between two filters it does not, only the
 * matrix changes.
 */
function FilteredPreview({
  photoOutput,
  videoOutput,
  onReady,
  matrix,
  ...props
}: CameraProps & { matrix: number[] }) {
  /**
   * The most recent frame, as a Skia image.
   *
   * A shared value rather than state: this is written on the frame thread at
   * camera rate, and routing every frame through a React render would drop
   * most of them and jank the rest.
   */
  const preview = useSharedValue<SkImage | null>(null);

  const frameOutput = useFrameOutput({
    onFrame(frame) {
      'worklet';
      try {
        if (!frame.hasNativeBuffer) return;
        const buffer = frame.getNativeBuffer();
        try {
          const image = Skia.Image.MakeImageFromNativeBuffer(buffer.pointer);
          // The previous frame is released only once its replacement exists.
          // Disposing first would leave a window where the canvas has nothing
          // to draw, which is a flicker at camera rate.
          const previous = preview.value;
          preview.value = image;
          previous?.dispose();
        } finally {
          buffer.release();
        }
      } finally {
        // Frames come from a fixed pool. One not returned is one fewer for the
        // next capture, and the pipeline stalls after a few seconds.
        frame.dispose();
      }
    },
  });

  return (
    <View style={StyleSheet.absoluteFill}>
      <Camera
        style={StyleSheet.absoluteFill}
        {...props}
        outputs={[photoOutput, videoOutput, frameOutput]}
        onPreviewStarted={onReady}
        resizeMode="cover"
      />
      <FilteredOverlay image={preview} matrix={matrix} />
    </View>
  );
}

/**
 * A throw anywhere in the camera tree becomes a blank viewfinder, not a dead
 * screen.
 *
 * Native camera setup reaches JS through hooks — a missing native module, a
 * worklet that cannot be shipped to its thread — and a hook that throws takes
 * down everything above it that does not catch. The composer is worth keeping
 * without a camera: text, voice and the gallery all still work. So the failure
 * is reported as "no camera", which already sends the shutter to the gallery.
 */
class CameraGuard extends Component<
  { resetKey: string; onFail: () => void; children: ReactNode },
  { failed: boolean }
> {
  state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  componentDidCatch(error: unknown) {
    console.warn('[camera] preview failed, falling back to no camera:', error);
    this.props.onFail();
  }

  componentDidUpdate(prev: { resetKey: string }) {
    if (this.state.failed && prev.resetKey !== this.props.resetKey) {
      this.setState({ failed: false });
    }
  }

  render() {
    return this.state.failed ? <View style={styles.blank} /> : this.props.children;
  }
}

/**
 * The filtered frames, drawn over the native preview.
 *
 * Split out so the canvas remounts when the filter appears or goes, rather
 * than living permanently and drawing nothing — a Skia surface held open for a
 * filter nobody picked is memory and a compositing pass for no result.
 */
function FilteredOverlay({
  image,
  matrix,
}: {
  image: ReturnType<typeof useSharedValue<SkImage | null>>;
  matrix: number[];
}) {
  const [size, setSize] = useState<{ w: number; h: number } | null>(null);

  return (
    <View
      style={StyleSheet.absoluteFill}
      pointerEvents="none"
      onLayout={(e) =>
        setSize({ w: e.nativeEvent.layout.width, h: e.nativeEvent.layout.height })
      }
    >
      {size ? (
        <Canvas style={StyleSheet.absoluteFill}>
          {/* Transparent until a frame lands, so the native preview shows
              through rather than the screen going black while the first one
              is on its way. */}
          <SkiaImage image={image} x={0} y={0} width={size.w} height={size.h} fit="cover">
            <ColorMatrix matrix={matrix} />
          </SkiaImage>
        </Canvas>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  blank: { ...StyleSheet.absoluteFillObject, backgroundColor: '#0A0B0F' },
});
