import { router } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useMemo, useState } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import { KeyboardStickyView } from 'react-native-keyboard-controller';
import { SafeAreaView } from 'react-native-safe-area-context';

import { PrimaryButton } from '@/components/ui/primary-button';
import { StepHeader } from '@/components/ui/step-header';
import { Text } from '@/components/ui/text';
import { TextField } from '@/components/ui/text-field';
import { Spacing, Typography } from '@/constants/theme';
import { authStart } from '@/data/api/auth';
import { ApiError } from '@/data/api/client';
import { useTheme } from '@/hooks/use-theme';
import { t } from '@/i18n';
import { useRegistration } from '@/store/registration';

const COUNTRY_CODES = ['+244', '+351', '+1', '+44', '+55', '+34', '+33', '+49'];

export default function PhoneScreen() {
  const { data, set } = useRegistration();
  const [countryCode, setCountryCode] = useState(data.countryCode);
  const [phone, setPhone] = useState(data.phoneNumber);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { colors } = useTheme();

  const isValid = useMemo(() => /^\d{6,15}$/.test(phone.replace(/\s/g, '')), [phone]);

  const handleContinue = async () => {
    const cleanPhone = phone.replace(/\s/g, '');
    const e164 = `${countryCode}${cleanPhone}`;
    set('countryCode', countryCode);
    set('phoneNumber', cleanPhone);
    setError(null);
    setBusy(true);
    try {
      const res = await authStart(e164);
      // In dev the server returns the OTP — auto-fill so verify is one step.
      if (res.dev_code) set('otp', res.dev_code);
      router.push('/auth/verify');
    } catch (err) {
      if (err instanceof ApiError && err.code === 'rate_limited') {
        setError(t('auth.phone.rate_limited'));
      } else {
        setError(t('auth.phone.send_failed'));
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
        keyboardDismissMode="none"
      >
        <StepHeader
          step={1}
          total={5}
          title={t('auth.phone.title')}
          subtitle={t('auth.phone.subtitle')}
        />

        <View style={styles.body}>
          <View style={styles.row}>
            <View style={styles.codePicker}>
              <TextField
                value={countryCode}
                onChangeText={setCountryCode}
                keyboardType="phone-pad"
                maxLength={5}
              />
            </View>
            <View style={styles.phoneField}>
              <TextField
                value={phone}
                onChangeText={setPhone}
                placeholder={t('auth.phone.placeholder')}
                keyboardType="phone-pad"
                maxLength={15}
              />
            </View>
          </View>

          <Text style={[styles.hint, { color: colors.textMuted }]}>
            {t('auth.phone.common_codes')} {COUNTRY_CODES.join('  ')}
          </Text>
          {error ? (
            <Text style={[styles.hint, { color: colors.danger }]}>{error}</Text>
          ) : null}
        </View>
      </ScrollView>

      <KeyboardStickyView offset={{ closed: 0, opened: 0 }}>
        <View style={styles.footer}>
          <PrimaryButton
            label={busy ? t('auth.sending') : t('auth.continue')}
            onPress={handleContinue}
            disabled={!isValid || busy}
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
  body: { paddingHorizontal: Spacing.xl, gap: Spacing.lg },
  row: { flexDirection: 'row', gap: Spacing.md },
  codePicker: { width: 96 },
  phoneField: { flex: 1 },
  hint: { ...Typography.caption },
  footer: { paddingHorizontal: Spacing.xl, paddingBottom: Spacing.xl, paddingTop: Spacing.md },
});
