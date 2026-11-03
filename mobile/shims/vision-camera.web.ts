/**
 * Stand-in for `react-native-vision-camera` in the browser.
 *
 * VisionCamera is built on Nitro Modules, which reaches into `react-native`
 * internals that do not exist under `react-native-web` and throw at import
 * time. The browser has no camera screen: with permission always "not
 * granted", the story composer falls back to the gallery picker, the same
 * path a phone takes when the person refuses the camera.
 */
const denied = () => ({
  hasPermission: false,
  requestPermission: async () => false,
});

export const useCameraPermission = denied;
export const useMicrophonePermission = denied;

// Referenced by `components/media/filtered-camera.tsx`, which is never
// rendered here because no permission means no camera tree.
export const Camera = () => null;
export const useCameraDevice = () => undefined;
export const useFrameOutput = () => undefined;
export const usePhotoOutput = () => undefined;
export const useVideoOutput = () => undefined;
