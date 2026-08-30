import { Canvas, ColorMatrix, Image as SkiaImage, Skia } from '@shopify/react-native-skia';
import type { SkImage } from '@shopify/react-native-skia';
import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { useSharedValue } from 'react-native-reanimated';
import {
  Camera,
  useCameraDevice,
  useFrameOutput,
  usePhotoOutput,
  useVideoOutput,
} from 'react-native-vision-camera';

import { filterById, type FilterId } from '@/data/photo-filters';

export type FilteredCameraHandle = {
  takePhoto: () => Promise<string | null>;
  startRecording: (onDone: (path: string) => void) => Promise<void>;
  stopRecording: () => Promise<void>;
};

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
 * `none` does not run the pipeline at all. That is the common case, it is the
 * one that must never be slower than it was, and a frame output that is never
 * created cannot leak.
 */
export const FilteredCamera = forwardRef<
  FilteredCameraHandle,
  {
    front: boolean;
    filter: FilterId;
    micGranted: boolean;
    video: boolean;
    torch: boolean;
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
  const [recorder, setRecorder] = useState<Awaited<
    ReturnType<typeof videoOutput.createRecorder>
  > | null>(null);

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
        setRecorder(rec);
        await rec.startRecording(
          (filePath) => {
            setRecorder(null);
            onDone(filePath);
          },
          () => setRecorder(null),
        );
      },
      async stopRecording() {
        await recorder?.stopRecording();
      },
    }),
    [photoOutput, videoOutput, recorder],
  );

  // Still just a blank here: what to say about a missing camera is the
  // composer's decision, not this component's — it owns the chrome, and it
  // is the one that can offer the gallery instead.
  if (!device) return <View style={styles.blank} />;

  // The frame output object is built on every render — a hook cannot be called
  // conditionally — but it is only *attached* when a filter needs it. Handing
  // it to the camera regardless would run an extra buffer pool for a preview
  // nobody is filtering.
  const outputs = matrix
    ? [photoOutput, videoOutput, frameOutput]
    : [photoOutput, videoOutput];

  return (
    <View style={StyleSheet.absoluteFill}>
      <Camera
        style={StyleSheet.absoluteFill}
        device={device}
        isActive={isActive}
        outputs={outputs}
        zoom={zoom}
        torchMode={torch && !front ? 'on' : 'off'}
        onPreviewStarted={onReady}
        resizeMode="cover"
      />
      {matrix ? (
        <FilteredOverlay image={preview} matrix={matrix} />
      ) : null}
    </View>
  );
});

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
