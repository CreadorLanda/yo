import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Text, TextInput, type TextInputHandle } from '@/components/ui/text';
import { Radii, Spacing, Typography } from '@/constants/theme';
import {
  unlockWithAppCode,
  unlockWithBiometrics,
  useAppLockPrefs,
  useAppLocked,
} from '@/data/app-lock';
import { useCurrentUser } from '@/data/auth-store';
import { isValidCode } from '@/data/chat-lock';
import { useTheme } from '@/hooks/use-theme';
import { t } from '@/i18n';

/**
 * The screen between a locked app and everything in it.
 *
 * Rendered above the navigator rather than as a route, so there is no
 * transition to watch and no back gesture to slip past. While it is up the
 * tree underneath is still mounted — it is covered, not unmounted — which is
 * what makes unlocking instant instead of a cold start.
 *
 * Biometrics are offered the moment it appears, because on a phone with Face
 * ID the expected experience is that looking at it is enough. If that is
 * declined or fails, the code is right there; it is never a dead end.
 */
export function AppLockGate() {
  const { colors } = useTheme();
  const locked = useAppLocked();
  const prefs = useAppLockPrefs();
  /**
   * A signed-out app has nothing behind the lock, and standing between
   * somebody and the onboarding screen is a way to be locked out of an app
   * for good — the only place that can clear the code is settings, which is
   * on the far side of this gate.
   */
  const user = useCurrentUser();

  const [code, setCode] = useState('');
  const [wrong, setWrong] = useState(false);
  const inputRef = useRef<TextInputHandle>(null);
  // Offer the prompt once per lock, not on every re-render: `authenticateAsync`
  // queues, so a second call stacks a second system sheet behind the first.
  const askedRef = useRef(false);

  const tryBiometrics = useCallback(async () => {
    if (!prefs.biometrics) return;
    const ok = await unlockWithBiometrics(t('app_lock.biometric_prompt'));
    if (ok) setCode('');
  }, [prefs.biometrics]);

  useEffect(() => {
    if (!locked || !user) {
      askedRef.current = false;
      setCode('');
      setWrong(false);
      return;
    }
    if (askedRef.current) return;
    askedRef.current = true;
    void tryBiometrics();
  }, [locked, user, tryBiometrics]);

  const submit = useCallback(
    async (value: string) => {
      if (!isValidCode(value)) return;
      const ok = await unlockWithAppCode(value);
      if (ok) {
        setWrong(false);
        setCode('');
        return;
      }
      setWrong(true);
      setCode('');
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error).catch(() => {});
      inputRef.current?.focus();
    },
    [],
  );

  if (!locked || !user) return null;

  return (
    <View style={StyleSheet.absoluteFill}>
      <SafeAreaView style={[styles.safe, { backgroundColor: colors.background }]}>
        <View style={styles.body}>
          <View style={[styles.badge, { backgroundColor: colors.surfaceMuted }]}>
            <Ionicons name="lock-closed" size={34} color={colors.primary} />
          </View>

          <Text style={[styles.title, { color: colors.text }]}>{t('app_lock.title')}</Text>
          <Text style={[styles.subtitle, { color: colors.textSecondary }]}>
            {t('app_lock.subtitle')}
          </Text>

          <TextInput
            ref={inputRef}
            value={code}
            onChangeText={(v) => {
              setCode(v);
              setWrong(false);
            }}
            onSubmitEditing={() => submit(code)}
            autoFocus={!prefs.biometrics}
            secureTextEntry
            keyboardType="number-pad"
            returnKeyType="go"
            placeholder={t('app_lock.code_placeholder')}
            placeholderTextColor={colors.textMuted}
            style={[
              styles.input,
              {
                backgroundColor: colors.surface,
                color: colors.text,
                borderColor: wrong ? colors.danger : colors.border,
              },
            ]}
          />

          {wrong ? (
            <Text style={[styles.error, { color: colors.danger }]}>{t('app_lock.wrong')}</Text>
          ) : null}

          <Pressable
            onPress={() => submit(code)}
            disabled={!isValidCode(code)}
            style={({ pressed }) => [
              styles.cta,
              {
                backgroundColor: isValidCode(code) ? colors.primary : colors.surfaceMuted,
                opacity: pressed ? 0.85 : 1,
              },
            ]}
          >
            <Text
              style={[
                styles.ctaText,
                { color: isValidCode(code) ? colors.onPrimary : colors.textMuted },
              ]}
            >
              {t('app_lock.unlock')}
            </Text>
          </Pressable>

          {prefs.biometrics ? (
            <Pressable onPress={tryBiometrics} style={styles.biometric} hitSlop={8}>
              <Ionicons name="finger-print" size={18} color={colors.primary} />
              <Text style={[styles.biometricText, { color: colors.primary }]}>
                {t('app_lock.use_biometrics')}
              </Text>
            </Pressable>
          ) : null}
        </View>
      </SafeAreaView>
    </View>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1 },
  body: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: Spacing.xl,
    gap: Spacing.md,
  },
  badge: {
    width: 76,
    height: 76,
    borderRadius: Radii.pill,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: Spacing.sm,
  },
  title: { ...Typography.h2 },
  subtitle: { ...Typography.caption, textAlign: 'center' },
  input: {
    width: '100%',
    maxWidth: 280,
    borderWidth: 1,
    borderRadius: Radii.lg,
    paddingHorizontal: Spacing.lg,
    paddingVertical: Spacing.md,
    textAlign: 'center',
    letterSpacing: 6,
    ...Typography.bodyStrong,
    marginTop: Spacing.sm,
  },
  error: { ...Typography.caption },
  cta: {
    width: '100%',
    maxWidth: 280,
    borderRadius: Radii.lg,
    paddingVertical: Spacing.md,
    alignItems: 'center',
  },
  ctaText: { ...Typography.bodyStrong },
  biometric: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.xs,
    paddingVertical: Spacing.sm,
  },
  biometricText: { ...Typography.bodyStrong },
});
