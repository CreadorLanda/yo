/**
 * Stand-in for `@livekit/react-native` in the browser.
 *
 * Expo Router evaluates every route module on startup, including the native
 * `app/call/[id].tsx` and `app/live/[id].tsx` that sit next to their `.web`
 * twins. The real package reaches a native WebRTC module and throws at import
 * time, so on web it resolves here instead. Nothing below ever runs: the
 * browser renders the `.web` screens, which use `livekit-client` directly.
 */
export const registerGlobals = () => {};

export const AudioSession = {
  startAudioSession: async () => {},
  stopAudioSession: async () => {},
};
