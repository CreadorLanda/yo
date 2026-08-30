import * as ScreenCapture from 'expo-screen-capture';
import { useEffect, useState } from 'react';
import { AppState, StyleSheet, View, type AppStateStatus } from 'react-native';

import { useAppLockPrefs } from '@/data/app-lock';
import { useTheme } from '@/hooks/use-theme';

/**
 * Keeps the app off the screenshot and out of the app switcher.
 *
 * Two different holes, and they do not have one fix between them:
 *
 *  - **Screenshots and screen recording.** `expo-screen-capture` sets
 *    `FLAG_SECURE` on Android, which blocks both and, as a side effect,
 *    blanks the thumbnail the task switcher keeps. On iOS there is no
 *    equivalent — the OS deliberately does not let an app block a
 *    screenshot — so this half is Android-only, and honestly so.
 *  - **The app-switcher preview.** iOS photographs the screen as the app
 *    leaves it, and that photograph is what appears in the switcher: the
 *    chat list, legible, on a locked app. Nothing prevents the snapshot, so
 *    the answer is to change what is in it — an opaque cover goes up on
 *    `inactive`, which is the state iOS passes through *before* it takes the
 *    picture. Waiting for `background` is too late.
 *
 * Both only apply when the app lock is on. Someone who has not asked for a
 * lock has not asked to lose screenshots either.
 */
export function ScreenPrivacy() {
  const { colors } = useTheme();
  const prefs = useAppLockPrefs();
  const [state, setState] = useState<AppStateStatus>(AppState.currentState);

  useEffect(() => {
    const sub = AppState.addEventListener('change', setState);
    return () => sub.remove();
  }, []);

  useEffect(() => {
    if (prefs.enabled) {
      ScreenCapture.preventScreenCaptureAsync().catch(() => {});
    } else {
      ScreenCapture.allowScreenCaptureAsync().catch(() => {});
    }
  }, [prefs.enabled]);

  if (!prefs.enabled || state === 'active') return null;

  return (
    <View
      pointerEvents="none"
      style={[StyleSheet.absoluteFill, { backgroundColor: colors.background }]}
    />
  );
}
