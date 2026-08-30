import { DarkTheme, DefaultTheme, ThemeProvider, type Theme } from '@react-navigation/native';
import { Stack, router } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useEffect, useState } from 'react';
import { View } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { KeyboardProvider } from 'react-native-keyboard-controller';
import 'react-native-reanimated';

import { AppToast } from '@/components/ui/app-toast';
import { DialogHost } from '@/components/ui/dialog-host';
import { IncomingCallHost } from '@/components/ui/incoming-call';
import { AnimatedSplash } from '@/components/ui/splash';
import {
  listenForForegroundMessages,
  listenForNotificationReplies,
  registerBackgroundMessageHandler,
  registerNotificationActions,
} from '@/data/push';
import { bootstrapAuth } from '@/data/auth-store';
import { ensureKeysPublished } from '@/data/crypto';
import { ensureOutboxRunning } from '@/data/outbox';
import { registerPushWithServer } from '@/data/push';
import { bootstrapThemes } from '@/data/theme-store';
import { useTheme } from '@/hooks/use-theme';

export const unstable_settings = {
  anchor: 'onboarding',
};

export default function RootLayout() {
  const { colors: palette, isDark } = useTheme();
  // Restore the persisted session before the first navigation. We always
  // render the Stack (so the navigator is mounted and router.replace works),
  // but cover it with a splash backstop until boot resolves — this hides the
  // brief onboarding flash that returning users would otherwise see.
  const [booted, setBooted] = useState(false);
  const [splashGone, setSplashGone] = useState(false);

  // The reply box on a message notification, and the handler behind it.
  // Registered once for the life of the app, not per screen: a notification
  // can be answered while no screen is mounted at all.
  useEffect(() => {
    void registerNotificationActions();
    // Message pushes arrive with no text: the server cannot read an encrypted
    // message, so the notification is built here, after decrypting.
    registerBackgroundMessageHandler();
    const stopReplies = listenForNotificationReplies();
    const stopForeground = listenForForegroundMessages();
    return () => {
      stopReplies();
      stopForeground();
    };
  }, []);

  useEffect(() => {
    let mounted = true;
    // The stored theme decides what every screen below is painted with, so it
    // is restored alongside the session rather than after it. Read late, the
    // first frame is drawn in the default palette and then visibly flips to
    // the one the person actually chose. It never rejects — a theme that
    // cannot be read falls back to the default inside the store.
    Promise.all([bootstrapAuth(), bootstrapThemes()])
      .then(([user]) => {
        if (!mounted) return;
        if (user) {
          router.replace('/(tabs)');
          // Register Expo/FCM token once a session is restored.
          registerPushWithServer().catch(() => {});
          // Generate / publish Signal-style pre-key material for E2EE.
          ensureKeysPublished().catch(() => {});
          // Resume any message queued offline before the app was closed,
          // and again on every foreground — not just on reopening the one
          // chat that queued it.
          ensureOutboxRunning();
        } else {
          // Send signed-out users to onboarding explicitly rather than
          // relying on the anchor to resolve "/". A standalone build opens
          // with no deep link, and an unresolved root renders nothing —
          // which, under the splash backstop, is an indistinguishable
          // blank screen.
          router.replace('/onboarding');
        }
      })
      .catch(() => {
        // A rejected bootstrap (unreadable keychain, for instance) must not
        // strand the app: without this the backstop below never lifts and
        // the user stares at a blank screen forever. Treat it as signed out.
        if (mounted) router.replace('/onboarding');
      })
      .finally(() => {
        if (mounted) setBooted(true);
      });
    return () => {
      mounted = false;
    };
  }, []);

  // Bind the navigation theme to the app palette so every scene's container is
  // an opaque app colour. The default RN themes paint scenes white/black, which
  // is exactly the flash that shows between screens during a transition.
  // Marketplace packs flow through useTheme so transitions stay on-pack.
  const base = isDark ? DarkTheme : DefaultTheme;
  const navTheme: Theme = {
    ...base,
    colors: {
      ...base.colors,
      background: palette.background,
      card: palette.surface,
      border: palette.border,
      text: palette.text,
      primary: palette.primary,
    },
  };

  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
    <KeyboardProvider>
      <ThemeProvider value={navTheme}>
        {/* Opaque app-coloured backstop behind every native screen — if a
            transition ever exposes a gap, this shows, never the white window. */}
        <View style={{ flex: 1, backgroundColor: palette.background }}>
          <Stack
            screenOptions={{
              contentStyle: { backgroundColor: palette.background },
              // Slides keep both screens adjacent and opaque, so neither push
              // nor pop ever reveals the window. Fades would expose it.
              animation: 'slide_from_right',
            }}
          >
            <Stack.Screen name="onboarding" options={{ headerShown: false }} />
            <Stack.Screen name="auth" options={{ headerShown: false }} />
            <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
            <Stack.Screen name="chat/[id]" options={{ headerShown: false }} />
            <Stack.Screen name="chat-info/[id]" options={{ headerShown: false }} />
            <Stack.Screen name="channel/[id]" options={{ headerShown: false }} />
            <Stack.Screen name="channel-info/[id]" options={{ headerShown: false }} />
            <Stack.Screen
              name="channel/create"
              options={{
                headerShown: false,
                presentation: 'modal',
                animation: 'slide_from_bottom',
              }}
            />
            <Stack.Screen name="channel/settings/[id]" options={{ headerShown: false }} />
            <Stack.Screen name="search" options={{ headerShown: false, presentation: 'modal' }} />
            <Stack.Screen name="profile" options={{ headerShown: false }} />
            <Stack.Screen name="settings" options={{ headerShown: false }} />
            <Stack.Screen name="stickers/index" options={{ headerShown: false }} />
            <Stack.Screen name="calls" options={{ headerShown: false }} />
            <Stack.Screen name="archived" options={{ headerShown: false }} />
            <Stack.Screen name="chat-media/[id]" options={{ headerShown: false }} />
            <Stack.Screen name="channel-members/[id]" options={{ headerShown: false }} />
            <Stack.Screen
              name="group/create"
              options={{
                headerShown: false,
                presentation: 'modal',
                animation: 'slide_from_bottom',
              }}
            />
            <Stack.Screen
              name="story/[id]"
              options={{
                headerShown: false,
                animation: 'slide_from_bottom',
                contentStyle: { backgroundColor: '#050609' },
              }}
            />
            <Stack.Screen
              name="story/create"
              options={{
                headerShown: false,
                presentation: 'fullScreenModal',
                animation: 'slide_from_bottom',
                contentStyle: { backgroundColor: '#050609' },
              }}
            />
            <Stack.Screen
              name="call/[id]"
              options={{
                headerShown: false,
                presentation: 'fullScreenModal',
                contentStyle: { backgroundColor: '#050609' },
              }}
            />
            <Stack.Screen
              name="hangout/[id]"
              options={{
                headerShown: false,
                presentation: 'fullScreenModal',
                animation: 'slide_from_bottom',
                contentStyle: { backgroundColor: '#0B0C10' },
              }}
            />
            <Stack.Screen name="themes/index" options={{ headerShown: false }} />
            <Stack.Screen
              name="themes/create"
              options={{
                headerShown: false,
                presentation: 'modal',
                animation: 'slide_from_bottom',
              }}
            />
            <Stack.Screen name="modal" options={{ presentation: 'modal', headerShown: false }} />
          </Stack>
          {/*
            Covers the app until boot resolves, and says so while it does.
            `booted` starts the exit; `splashGone` removes the cover once the
            exit has actually finished, so the two are not the same flag —
            unmounting on `booted` alone would cut the animation off at the
            first frame.
          */}
          {!splashGone ? (
            <AnimatedSplash done={booted} onDone={() => setSplashGone(true)} />
          ) : null}
          {/* Global toast for background story publish, etc. */}
          <AppToast />
          {/* One dialog host for the whole app — see data/dialog-store. */}
          <DialogHost />
          {/*
            The ringing screen. Mounted here for the same reason as the dialog
            host: a call arrives while whatever screen happens to be on top.
          */}
          <IncomingCallHost />
        </View>
        <StatusBar style="auto" />
      </ThemeProvider>
    </KeyboardProvider>
    </GestureHandlerRootView>
  );
}
