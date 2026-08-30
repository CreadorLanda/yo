import { requireNativeModule } from 'expo-modules-core';

/**
 * Keeping a call alive while the app is not on screen.
 *
 * The two platforms need opposite things, which is why this is one module
 * with one API rather than a branch at the call site:
 *
 *  - **Android** has no exemption to grant. Since API 28 the microphone is
 *    cut off in the background, and since API 31 the process is frozen, and
 *    the only way out is a foreground service with a visible notification.
 *    `@livekit/react-native` declares the permission for one but ships no
 *    service, so pressing home during a call silenced it and then killed it.
 *  - **iOS** grants the exemption through `UIBackgroundModes` — already set —
 *    but only while audio is actually running. The work there is configuring
 *    the `AVAudioSession` for a call and holding it active across
 *    interruptions.
 *
 * `video` and the notification strings are Android's; iOS accepts and ignores
 * them. The strings are passed from here because a native module cannot read
 * the app's translations, and an English notification on a Portuguese phone
 * is exactly the kind of seam people notice.
 */
type CallKeepAliveModule = {
  isSupported(): boolean;
  /** Returns false when the platform refused. The call still works on screen. */
  start(video: boolean, title: string | null, body: string | null): boolean;
  stop(): void;
};

let native: CallKeepAliveModule | null = null;
try {
  native = requireNativeModule<CallKeepAliveModule>('CallKeepAlive');
} catch {
  // Expo Go, web, or a build made before this module existed. Every function
  // below degrades to what the app did previously — a call that works while
  // it is on screen — rather than throwing into a call screen.
  native = null;
}

export function isCallKeepAliveSupported(): boolean {
  return !!native?.isSupported();
}

export function startCallKeepAlive(opts: {
  video: boolean;
  title: string;
  body: string;
}): boolean {
  try {
    return native?.start(opts.video, opts.title, opts.body) ?? false;
  } catch {
    return false;
  }
}

export function stopCallKeepAlive(): void {
  try {
    native?.stop();
  } catch {
    // Nothing to stop. A teardown path is the worst place to raise.
  }
}
