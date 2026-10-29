import { router } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useRef, useState } from 'react';
import { KeyboardStickyView } from 'react-native-keyboard-controller';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { PrimaryButton } from '@/components/ui/primary-button';
import { StepHeader } from '@/components/ui/step-header';
import { Text, TextInput, type TextInputHandle } from '@/components/ui/text';
import { Radii, Spacing, Typography } from '@/constants/theme';
import { authEmailVerify } from '@/data/api/auth';
import { ApiError } from '@/data/api/client';
import { me } from '@/data/api/users';
import { setUser } from '@/data/auth-store';
import { useTheme } from '@/hooks/use-theme';
import { t } from '@/i18n';
import { useRegistration } from '@/store/registration';

const OTP_LENGTH = 6;

export default function EmailVerificationScreen() {
  const { data } = useRegistration();
  const { colors } = useTheme();
  const [digits, setDigits] = useState<string[]>(Array(OTP_LENGTH).fill(''));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputs = useRef<(TextInputHandle | null)[]>([]);
  const code = digits.join('');

  const nextStep = (displayName: string) => {
    router.replace(displayName.trim() ? '/(tabs)' : '/auth/profile');
  };

  const handleChange = (value: string, index: number) => {
    const clean = value.replace(/\D/g, '').slice(-1);
    setDigits((current) => {
      const next = [...current];
      next[index] = clean;
      return next;
    });
    if (clean && index < OTP_LENGTH - 1) inputs.current[index + 1]?.focus();
  };

  const handleContinue = async () => {
    setBusy(true);
    setError(null);
    try {
      await authEmailVerify(code);
      const user = await me();
      await setUser(user);
      nextStep(user.display_name);
    } catch (err) {
      if (err instanceof ApiError && (err.code === 'verification_invalid' || err.code === 'verification_expired')) {
        setError(t('auth.email.invalid'));
      } else {
        setError(t('auth.email.failed'));
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <SafeAreaView style={[styles.safe, { backgroundColor: colors.background }]} edges={['top', 'bottom']}>
      <StatusBar style="dark" />
      <ScrollView
        style={styles.flex}
        contentContainerStyle={styles.scroll}
        keyboardShouldPersistTaps="handled"
      >
        <StepHeader
          step={3}
          total={5}
          title={t('auth.email.title')}
          subtitle={t('auth.email.subtitle', { email: data.email })}
        />
        <View style={styles.body}>
          <View style={styles.otpRow}>
            {digits.map((digit, index) => (
              <TextInput
                key={index}
                ref={(input) => {
                  inputs.current[index] = input;
                }}
                value={digit}
                onChangeText={(value) => handleChange(value, index)}
                keyboardType="number-pad"
                maxLength={1}
                style={[
                  styles.otpCell,
                  { borderColor: colors.border, backgroundColor: colors.surface, color: colors.text },
                  !!digit && { borderColor: colors.primary, backgroundColor: colors.surfaceMuted },
                ]}
                selectTextOnFocus
              />
            ))}
          </View>
          {error ? <Text style={[styles.hint, { color: colors.danger }]}>{error}</Text> : null}
          <Pressable onPress={() => nextStep('')} hitSlop={8}>
            <Text style={[styles.skip, { color: colors.textSecondary }]}>{t('auth.email.skip')}</Text>
          </Pressable>
        </View>
      </ScrollView>
      <KeyboardStickyView offset={{ closed: 0, opened: 0 }}>
        <View style={styles.footer}>
          <PrimaryButton
            label={busy ? t('auth.verifying') : t('auth.email.cta')}
            onPress={handleContinue}
            disabled={code.length !== OTP_LENGTH || busy}
          />
        </View>
      </KeyboardStickyView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1 },
  flex: { flex: 1 },
  scroll: { flexGrow: 1 },
  body: { flex: 1, paddingHorizontal: Spacing.xl, gap: Spacing.xl, alignItems: 'center' },
  otpRow: { flexDirection: 'row', gap: Spacing.sm, justifyContent: 'center' },
  otpCell: {
    width: 48,
    height: 56,
    borderRadius: Radii.md,
    borderWidth: 1,
    textAlign: 'center',
    ...Typography.h2,
    fontVariant: ['tabular-nums'],
  },
  hint: { ...Typography.caption },
  skip: { ...Typography.bodyStrong },
  footer: { paddingHorizontal: Spacing.xl, paddingBottom: Spacing.xl },
});
