import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useEffect, useMemo, useState } from 'react';
import {
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  View,
} from 'react-native';
import { KeyboardStickyView } from 'react-native-keyboard-controller';
import { SafeAreaView } from 'react-native-safe-area-context';

import { PrimaryButton } from '@/components/ui/primary-button';
import { StepHeader } from '@/components/ui/step-header';
import { Text } from '@/components/ui/text';
import { TextField } from '@/components/ui/text-field';
import { Radii, Spacing, Typography } from '@/constants/theme';
import { ApiError } from '@/data/api/client';
import { checkAvailability, patchMe } from '@/data/api/users';
import { setUser } from '@/data/auth-store';
import { useTheme } from '@/hooks/use-theme';
import { t } from '@/i18n';
import { useRegistration } from '@/store/registration';

type Availability = 'idle' | 'checking' | 'available' | 'taken' | 'invalid';

export default function UsernameScreen() {
  const { data, set } = useRegistration();
  const [username, setUsername] = useState(data.username);
  const [discoverable, setDiscoverable] = useState(data.isDiscoverable);
  const [status, setStatus] = useState<Availability>('idle');
  const [busy, setBusy] = useState(false);
  const { colors } = useTheme();

  // Debounced uniqueness check against the API. The server enforces the
  // same regex (a-z0-9_, 3–20) and returns available=false when invalid.
  useEffect(() => {
    if (!username) {
      setStatus('idle');
      return;
    }
    if (!/^[a-z0-9_]{3,20}$/.test(username)) {
      setStatus('invalid');
      return;
    }
    setStatus('checking');
    const id = setTimeout(async () => {
      try {
        const res = await checkAvailability(username);
        setStatus(res.available ? 'available' : 'taken');
      } catch {
        // Network error → leave UI optimistic; the PATCH still validates.
        setStatus('available');
      }
    }, 400);
    return () => clearTimeout(id);
  }, [username]);

  const error = useMemo(() => {
    if (status === 'invalid') return t('auth.username.error_invalid');
    if (status === 'taken') return t('auth.username.error_taken');
    return undefined;
  }, [status]);

  const isValid = status === 'available';

  const handleContinue = async () => {
    set('username', username);
    set('isDiscoverable', discoverable);
    setBusy(true);
    try {
      const updated = await patchMe({ username, username_public: discoverable });
      await setUser(updated);
      router.push('/auth/permissions');
    } catch (err) {
      if (err instanceof ApiError && err.code === 'username_taken') {
        setStatus('taken');
      } else {
        // Surface a status — keep it cheap, the next step is the real gate.
        setStatus('taken');
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
          step={4}
          total={5}
          title={t('auth.username.title')}
          subtitle={t('auth.username.subtitle')}
        />

        <View style={styles.body}>
          <TextField
            label={t('auth.username.label')}
            value={username}
            onChangeText={(v) => setUsername(v.toLowerCase().replace(/[^a-z0-9_]/g, ''))}
            placeholder={t('auth.username.placeholder')}
            autoCapitalize="none"
            autoCorrect={false}
            maxLength={20}
            leftAdornment={<Text style={[styles.atSign, { color: colors.textSecondary }]}>@</Text>}
            rightAdornment={<AvailabilityBadge status={status} />}
            error={error}
            hint={
              status === 'available'
                ? t('auth.username.hint_available', { username })
                : t('auth.username.hint_default')
            }
          />

          <View
            style={[
              styles.privacyCard,
              { backgroundColor: colors.surfaceMuted, borderColor: colors.border },
              !discoverable && [styles.privacyCardOff, { backgroundColor: colors.surface, borderColor: colors.border }],
            ]}
          >
            <View style={styles.privacyHeader}>
              <View style={[styles.privacyLabelRow, { backgroundColor: colors.surface }]}>
                <Ionicons
                  name={discoverable ? 'globe-outline' : 'lock-closed-outline'}
                  size={14}
                  color={discoverable ? colors.primary : colors.textMuted}
                />
                <Text
                  style={[
                    styles.privacyLabel,
                    { color: colors.primary },
                    !discoverable && [styles.privacyLabelOff, { color: colors.textMuted }],
                  ]}
                >
                  {t(
                    discoverable
                      ? 'auth.username.visibility_public'
                      : 'auth.username.visibility_private',
                  )}
                </Text>
              </View>
              <Text style={[styles.privacyCaption, { color: colors.textMuted }]}>
                {t('auth.username.your_link')}
              </Text>
            </View>

            <View style={styles.urlPreview}>
              <Text
                style={[
                  styles.urlScheme,
                  { color: colors.textSecondary },
                  !discoverable && [styles.urlSchemeOff, { color: colors.textMuted }],
                ]}
                numberOfLines={1}
              >
                {/* Was `socialize.app/`, a site that has never existed. The
                    screen was showing someone the web address of their new
                    profile page, and there was no page. */}
                @
              </Text>
              <Text
                style={[
                  styles.urlHandle,
                  { color: colors.primary },
                  !discoverable && [styles.urlHandleOff, { color: colors.textMuted }],
                ]}
                numberOfLines={1}
              >
                @{username || t('auth.username.placeholder')}
              </Text>
            </View>

            <View style={[styles.toggleDivider, { backgroundColor: colors.divider }]} />

            <Pressable
              onPress={() => setDiscoverable((v) => !v)}
              style={styles.toggleRow}
              accessibilityRole="switch"
              accessibilityState={{ checked: discoverable }}
              hitSlop={4}
            >
              <View style={styles.toggleText}>
                <Text style={[styles.toggleTitle, { color: colors.text }]}>{t('auth.username.toggle_title')}</Text>
                <Text style={[styles.toggleSubtitle, { color: colors.textSecondary }]}>
                  {discoverable
                    ? t('auth.username.toggle_on')
                    : t('auth.username.toggle_off')}
                </Text>
              </View>
              <Switch
                value={discoverable}
                onValueChange={setDiscoverable}
                trackColor={{ false: colors.divider, true: colors.primary }}
                thumbColor={discoverable ? colors.primary : colors.surface}
                ios_backgroundColor={colors.divider}
              />
            </Pressable>
          </View>
        </View>
      </ScrollView>

      <KeyboardStickyView offset={{ closed: 0, opened: 0 }}>
        <View style={styles.footer}>
          <PrimaryButton
            label={busy ? t('auth.saving') : t('auth.continue')}
            onPress={handleContinue}
            disabled={!isValid || busy}
          />
        </View>
      </KeyboardStickyView>
    </SafeAreaView>
  );
}

function AvailabilityBadge({ status }: { status: Availability }) {
  const { colors } = useTheme();
  if (status === 'checking') {
    return <Ionicons name="ellipsis-horizontal" size={18} color={colors.textMuted} />;
  }
  if (status === 'available') {
    return <Ionicons name="checkmark-circle" size={20} color={colors.success} />;
  }
  if (status === 'taken' || status === 'invalid') {
    return <Ionicons name="close-circle" size={20} color={colors.danger} />;
  }
  return null;
}

const styles = StyleSheet.create({
  safe: { flex: 1 },
  flex: { flex: 1 },
  scroll: { flexGrow: 1, paddingBottom: Spacing.xl },
  body: { paddingHorizontal: Spacing.xl, gap: Spacing.lg },
  atSign: { ...Typography.body },

  privacyCard: {
    borderRadius: Radii.xl,
    padding: Spacing.lg,
    borderWidth: 1.5,
    gap: Spacing.md,
  },
  privacyCardOff: {
    backgroundColor: 'transparent',
  },
  privacyHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  privacyLabelRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.xs,
    paddingHorizontal: Spacing.sm,
    paddingVertical: 4,
    borderRadius: Radii.pill,
  },
  privacyLabel: {
    ...Typography.micro,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  privacyLabelOff: {},
  privacyCaption: {
    ...Typography.micro,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  urlPreview: {
    flexDirection: 'row',
    alignItems: 'baseline',
    flexWrap: 'wrap',
  },
  urlScheme: {
    ...Typography.body,
  },
  urlSchemeOff: {
    textDecorationLine: 'line-through',
  },
  urlHandle: {
    ...Typography.h2,
    fontWeight: '700',
  },
  urlHandleOff: {
    textDecorationLine: 'line-through',
  },
  toggleDivider: {
    height: 1,
    marginVertical: Spacing.xs,
  },
  toggleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.md,
  },
  toggleText: { flex: 1 },
  toggleTitle: { ...Typography.bodyStrong },
  toggleSubtitle: { ...Typography.caption, marginTop: 2 },
  footer: { paddingHorizontal: Spacing.xl, paddingBottom: Spacing.xl },
});
