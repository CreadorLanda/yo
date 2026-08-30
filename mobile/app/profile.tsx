import { Ionicons } from '@expo/vector-icons';
import { Image } from 'expo-image';
import * as ImagePicker from 'expo-image-picker';
import { router } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useState } from 'react';
import { Pressable, ScrollView, Share, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { PrimaryButton } from '@/components/ui/primary-button';
import { StateTransition } from '@/components/ui/state-transition';
import { Text } from '@/components/ui/text';
import { TextField } from '@/components/ui/text-field';
import { Radii, Spacing, Typography } from '@/constants/theme';
import { updateProfile, useProfile } from '@/data/profile-store';
import { useTheme } from '@/hooks/use-theme';
import { t } from '@/i18n';

export default function ProfileScreen() {
  const { colors, isDark } = useTheme();
  const profile = useProfile();
  const [editing, setEditing] = useState(false);
  const [draftName, setDraftName] = useState(profile.name);
  const [draftBio, setDraftBio] = useState(profile.bio);
  const [draftUsername, setDraftUsername] = useState(profile.username.replace(/^@/, ''));
  const [draftAvatarUri, setDraftAvatarUri] = useState(profile.avatarUri);

  const enterEdit = () => {
    setDraftName(profile.name);
    setDraftBio(profile.bio);
    setDraftUsername(profile.username.replace(/^@/, ''));
    setDraftAvatarUri(profile.avatarUri);
    setEditing(true);
  };

  const save = () => {
    updateProfile({
      name: draftName.trim() || profile.name,
      bio: draftBio.trim(),
      username: draftUsername,
      avatarUri: draftAvatarUri !== profile.avatarUri ? draftAvatarUri : undefined,
    });
    setEditing(false);
  };

  const shareProfile = () => {
    Share.share({ message: t('profile.share_message', { link: profile.link }) });
  };

  const pickAvatar = async () => {
    const result = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], quality: 0.8 });
    if (!result.canceled && result.assets[0]) {
      setDraftAvatarUri(result.assets[0].uri);
    }
  };

  return (
    <SafeAreaView style={[styles.safe, { backgroundColor: colors.background }]} edges={['top', 'bottom']}>
      <StatusBar style={isDark ? 'light' : 'dark'} />

      <View style={[styles.header, { borderBottomColor: colors.divider }]}>
        {editing ? (
          <Pressable onPress={() => setEditing(false)} hitSlop={10}>
            <Text style={[styles.headerAction, { color: colors.textSecondary }]}>
              {t('profile.cancel')}
            </Text>
          </Pressable>
        ) : (
          <Pressable
            onPress={() => router.back()}
            hitSlop={12}
            style={styles.backBtn}
            accessibilityLabel={t('auth.back')}
          >
            <Ionicons name="chevron-back" size={26} color={colors.text} />
          </Pressable>
        )}
        <Text style={[styles.headerTitle, { color: colors.text }]}>
          {editing ? t('profile.edit_title') : t('profile.title')}
        </Text>
        {editing ? (
          <Pressable onPress={save} hitSlop={10}>
            <Text style={[styles.headerAction, { color: colors.primary }]}>{t('profile.save')}</Text>
          </Pressable>
        ) : (
          <View style={styles.backBtn} />
        )}
      </View>

      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.scroll}>
        <StateTransition transitionKey={editing}>
        {editing ? (
          <View style={styles.editBody}>
            <View style={styles.editAvatarRow}>
              <Pressable onPress={pickAvatar} accessibilityLabel={t('profile.change_photo')}>
                <Image
                  source={{ uri: draftAvatarUri }}
                  style={[styles.editAvatar, { backgroundColor: colors.surfaceMuted }]}
                  contentFit="cover"
                />
                <View style={[styles.cameraBadge, { backgroundColor: colors.primary, borderColor: colors.background }]}>
                  <Ionicons name="camera" size={15} color={colors.onPrimary} />
                </View>
              </Pressable>
              <Pressable onPress={pickAvatar} hitSlop={8}>
                <Text style={[styles.changePhoto, { color: colors.primary }]}>
                  {t('profile.change_photo')}
                </Text>
              </Pressable>
            </View>

            <TextField
              label={t('profile.name_label')}
              value={draftName}
              onChangeText={setDraftName}
              maxLength={40}
            />
            <TextField
              label={t('profile.username_label')}
              value={draftUsername}
              onChangeText={(v) => setDraftUsername(v.toLowerCase().replace(/[^a-z0-9_]/g, ''))}
              autoCapitalize="none"
              autoCorrect={false}
              maxLength={20}
              leftAdornment={<Text style={[styles.atSign, { color: colors.textSecondary }]}>@</Text>}
            />
            <TextField
              label={t('profile.link_label')}
              value={profile.link}
              editable={false}
            />
          </View>
        ) : (
          <>
            <View style={styles.identity}>
              <Image
                source={{ uri: profile.avatarUri }}
                style={[styles.avatar, { backgroundColor: colors.surfaceMuted }]}
                contentFit="cover"
              />
              <View style={styles.identityText}>
                <Text style={[styles.name, { color: colors.text }]} numberOfLines={1}>
                  {profile.name}
                </Text>
                <Text style={[styles.username, { color: colors.primary }]} numberOfLines={1}>
                  {profile.username}
                </Text>
              </View>
            </View>

            {profile.bio ? (
              <Text style={[styles.bio, { color: colors.text }]}>{profile.bio}</Text>
            ) : null}

            <View style={[styles.stats, { borderColor: colors.divider }]}>
              <Stat value={0} label={t('profile.stat_chats')} />
              <View style={[styles.statDivider, { backgroundColor: colors.divider }]} />
              <Stat value={0} label={t('profile.stat_stories')} />
              <View style={[styles.statDivider, { backgroundColor: colors.divider }]} />
              <Stat value={0} label={t('profile.stat_contacts')} />
            </View>

            <View style={styles.actions}>
              <View style={styles.editButton}>
                <PrimaryButton label={t('profile.edit')} onPress={enterEdit} />
              </View>
              <Pressable
                onPress={shareProfile}
                style={({ pressed }) => [
                  styles.shareButton,
                  { borderColor: colors.border },
                  pressed && { backgroundColor: colors.surfaceMuted },
                ]}
                accessibilityRole="button"
                accessibilityLabel={t('profile.share')}
              >
                <Ionicons name="share-outline" size={22} color={colors.text} />
              </Pressable>
            </View>

          </>
        )}
        </StateTransition>
      </ScrollView>
    </SafeAreaView>
  );
}

function Stat({ value, label }: { value: number; label: string }) {
  const { colors } = useTheme();
  return (
    <View style={styles.stat}>
      <Text style={[styles.statValue, { color: colors.text }]}>{value}</Text>
      <Text style={[styles.statLabel, { color: colors.textSecondary }]}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1 },

  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm,
    borderBottomWidth: StyleSheet.hairlineWidth,
    minHeight: 54,
  },
  backBtn: {
    width: 40,
    height: 40,
    borderRadius: Radii.pill,
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerTitle: { ...Typography.h3 },
  headerAction: { ...Typography.bodyStrong, paddingHorizontal: Spacing.xs },

  scroll: { paddingBottom: Spacing.xxxl },

  identity: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.lg,
    paddingHorizontal: Spacing.lg,
    paddingTop: Spacing.xl,
  },
  avatar: {
    width: 80,
    height: 80,
    borderRadius: Radii.pill,
  },
  identityText: { flex: 1, gap: 3 },
  name: { ...Typography.h2, fontSize: 21 },
  username: { ...Typography.body, fontWeight: '600' },
  locationRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    marginTop: 1,
  },
  location: { ...Typography.caption, flex: 1 },

  bio: {
    ...Typography.body,
    lineHeight: 22,
    paddingHorizontal: Spacing.lg,
    paddingTop: Spacing.lg,
  },

  stats: {
    flexDirection: 'row',
    marginHorizontal: Spacing.lg,
    marginTop: Spacing.lg,
    paddingVertical: Spacing.md,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  stat: { flex: 1, alignItems: 'center', gap: 2 },
  statValue: { ...Typography.h3, fontSize: 19 },
  statLabel: {
    ...Typography.micro,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  statDivider: { width: StyleSheet.hairlineWidth, marginVertical: 2 },

  actions: {
    flexDirection: 'row',
    gap: Spacing.sm,
    paddingHorizontal: Spacing.lg,
    paddingTop: Spacing.lg,
  },
  editButton: { flex: 1 },
  shareButton: {
    width: 56,
    height: 56,
    borderRadius: Radii.lg,
    borderWidth: 1.5,
    alignItems: 'center',
    justifyContent: 'center',
  },

  tabs: {
    flexDirection: 'row',
    borderBottomWidth: StyleSheet.hairlineWidth,
    marginTop: Spacing.xl,
  },
  tab: {
    flex: 1,
    alignItems: 'center',
    paddingTop: Spacing.sm,
    gap: Spacing.sm,
  },
  tabText: { ...Typography.bodyStrong, fontSize: 14 },
  tabIndicator: {
    height: 2.5,
    width: '100%',
    borderTopLeftRadius: 2,
    borderTopRightRadius: 2,
  },


  note: {
    borderRadius: Radii.lg,
    borderWidth: 1,
    padding: Spacing.md,
    gap: Spacing.xs,
  },
  noteText: { ...Typography.body, lineHeight: 21 },
  noteTime: { ...Typography.micro },

  editBody: {
    padding: Spacing.lg,
    gap: Spacing.lg,
  },
  editAvatarRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.lg,
    paddingBottom: Spacing.xs,
  },
  editAvatar: {
    width: 76,
    height: 76,
    borderRadius: Radii.pill,
  },
  cameraBadge: {
    position: 'absolute',
    right: -2,
    bottom: -2,
    width: 30,
    height: 30,
    borderRadius: Radii.pill,
    borderWidth: 3,
    alignItems: 'center',
    justifyContent: 'center',
  },
  changePhoto: { ...Typography.bodyStrong },
  atSign: { ...Typography.body, fontWeight: '600' },
  bioInput: {
    minHeight: 80,
    textAlignVertical: 'top',
  },
});
