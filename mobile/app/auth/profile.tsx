import { Ionicons } from '@expo/vector-icons';
import * as ImagePicker from 'expo-image-picker';
import { router } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useMemo, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { KeyboardStickyView } from 'react-native-keyboard-controller';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Avatar } from '@/components/ui/avatar';
import { PrimaryButton } from '@/components/ui/primary-button';
import { StepHeader } from '@/components/ui/step-header';
import { TextField } from '@/components/ui/text-field';
import { Palette, Radii, Spacing } from '@/constants/theme';
import { me } from '@/data/api/users';
import { setUser } from '@/data/auth-store';
import { updateProfile } from '@/data/profile-store';
import { useTheme } from '@/hooks/use-theme';
import { t } from '@/i18n';
import { useRegistration } from '@/store/registration';

export default function ProfileScreen() {
  const { data, set } = useRegistration();
  const [name, setName] = useState(data.displayName);
  const [avatar, setAvatar] = useState<string | null>(data.avatarUri);
  const [busy, setBusy] = useState(false);
  const { colors } = useTheme();

  const isValid = useMemo(() => name.trim().length >= 2, [name]);

  /**
   * Optional, and it always was — the button just never did anything.
   *
   * It used to toggle the string 'local:alex' and render a bundled fixture,
   * so signing up appeared to offer a photo and gave everybody the same
   * stock face. Skipping it now means the generated avatar stands, which is
   * a real answer rather than an empty circle.
   */
  const handlePickAvatar = async () => {
    if (avatar) {
      setAvatar(null);
      return;
    }
    try {
      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ['images'],
        allowsEditing: true,
        aspect: [1, 1],
        quality: 0.8,
      });
      if (!result.canceled && result.assets[0]) setAvatar(result.assets[0].uri);
    } catch {
      // A refused library is not a reason to block sign-up: the photo is
      // optional and the generated avatar is already there.
    }
  };

  const handleContinue = async () => {
    const display = name.trim();
    set('displayName', display);
    set('avatarUri', avatar);
    setBusy(true);
    try {
      // The photo goes with the name, through the same upload path the rest
      // of the app uses. It used to stay on the device under a comment saying
      // the real upload would land later — the media module it was waiting
      // for has existed since channels shipped.
      await updateProfile({ name: display, avatarUri: avatar ?? undefined });
      const updated = await me();
      await setUser(updated);
    } catch {
      // Non-fatal — the user can edit later from Settings. Move on.
    } finally {
      setBusy(false);
    }
    router.push('/auth/username');
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
          step={3}
          total={5}
          title={t('auth.profile.title')}
          subtitle={t('auth.profile.subtitle')}
        />

        <View style={styles.body}>
          <Pressable onPress={handlePickAvatar} style={styles.avatarWrap} accessibilityRole="button">
            {/*
              Not a person icon when there is no photo. The generated avatar
              is what they will actually have if they skip this, so it is what
              the preview should show — seeded on the name they are typing, so
              it settles into a face as they choose one.
            */}
            <View style={[styles.avatar, { borderColor: colors.surface }]}>
              <Avatar
                uri={avatar}
                username={name.trim() || undefined}
                size={104}
              />
            </View>
            <View
              style={[
                styles.avatarEdit,
                { backgroundColor: colors.primary, borderColor: colors.background },
              ]}
            >
              <Ionicons name="camera" size={16} color={colors.onPrimary} />
            </View>
          </Pressable>

          <TextField
            label={t('auth.profile.label')}
            value={name}
            onChangeText={setName}
            placeholder={t('auth.profile.placeholder')}
            autoCapitalize="words"
            maxLength={40}
            hint={t('auth.profile.hint')}
          />
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

const AVATAR_SIZE = 112;

const styles = StyleSheet.create({
  safe: { flex: 1 },
  flex: { flex: 1 },
  scroll: { flexGrow: 1, paddingBottom: Spacing.xl },
  body: {
    paddingHorizontal: Spacing.xl,
    gap: Spacing.xl,
    alignItems: 'stretch',
  },
  avatarWrap: {
    alignSelf: 'center',
    width: AVATAR_SIZE,
    height: AVATAR_SIZE,
  },
  avatar: {
    width: AVATAR_SIZE,
    height: AVATAR_SIZE,
    borderRadius: Radii.pill,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
    borderWidth: 3,
    shadowColor: Palette.brand[900],
    shadowOpacity: 0.12,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 6 },
    elevation: 5,
  },
  avatarImage: { width: '100%', height: '100%' },
  avatarEdit: {
    position: 'absolute',
    right: 0,
    bottom: 0,
    width: 34,
    height: 34,
    borderRadius: Radii.pill,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 2,
  },
  footer: { paddingHorizontal: Spacing.xl, paddingBottom: Spacing.xl },
});
