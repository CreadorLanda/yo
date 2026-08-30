import { Ionicons } from '@expo/vector-icons';
import { Image } from 'expo-image';
import * as ImagePicker from 'expo-image-picker';
import { router } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { PeoplePicker, type PickablePerson } from '@/components/ui/people-picker';
import { Text, TextInput } from '@/components/ui/text';
import { Radii, Spacing, Typography } from '@/constants/theme';
import { createGroup } from '@/data/api/groups';
import { uploadMedia } from '@/data/api/media';
import { refreshChats } from '@/data/chat-store';
import { appAlert } from '@/data/dialog-store';
import { useTheme } from '@/hooks/use-theme';
import { t } from '@/i18n';

/**
 * Create a group.
 *
 * There was no way to do this at all: createGroup, addGroupMembers,
 * removeGroupMember and setGroupMemberRole all existed in the API layer and
 * none of them was called from anywhere.
 *
 * Members are chosen before the group exists rather than after. A group with
 * one person in it is not a group, and creating an empty one leaves people
 * with a room they then have to remember to fill.
 */
export default function CreateGroupScreen() {
  const { colors, isDark } = useTheme();

  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [avatarUri, setAvatarUri] = useState<string | null>(null);
  const [members, setMembers] = useState<PickablePerson[]>([]);
  const [picking, setPicking] = useState(false);
  const [busy, setBusy] = useState(false);

  const canCreate = title.trim().length >= 2 && members.length > 0 && !busy;

  const pickAvatar = async () => {
    const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!perm.granted) return;
    const res = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'],
      allowsEditing: true,
      aspect: [1, 1],
      quality: 0.9,
    });
    if (!res.canceled && res.assets?.[0]) setAvatarUri(res.assets[0].uri);
  };

  const create = async () => {
    if (!canCreate) return;
    setBusy(true);
    try {
      // Upload first: a group created with a half-finished upload would keep
      // the generated initial and never pick up the picture that was chosen.
      let avatarUrl: string | undefined;
      if (avatarUri) {
        avatarUrl = (await uploadMedia({ uri: avatarUri, mimeType: 'image/jpeg' })).url;
      }
      const group = await createGroup({
        title: title.trim(),
        description: description.trim() || undefined,
        avatar_url: avatarUrl,
        member_ids: members.map((m) => m.id),
      });
      await refreshChats();
      router.replace(`/chat/${group.id}`);
    } catch {
      appAlert(t('chats.action_failed_title'), t('chats.action_failed_body'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <SafeAreaView style={[styles.safe, { backgroundColor: colors.background }]} edges={['top', 'bottom']}>
      <StatusBar style={isDark ? 'light' : 'dark'} />

      <View style={[styles.header, { borderBottomColor: colors.border }]}>
        <Pressable onPress={() => router.back()} hitSlop={10} accessibilityRole="button">
          <Ionicons name="close" size={24} color={colors.text} />
        </Pressable>
        <Text style={[styles.headerTitle, { color: colors.text }]}>{t('group_create.title')}</Text>
        <Pressable onPress={() => void create()} disabled={!canCreate} hitSlop={10}>
          {busy ? (
            <ActivityIndicator color={colors.primary} />
          ) : (
            <Text style={[styles.action, { color: canCreate ? colors.primary : colors.textMuted }]}>
              {t('group_create.create')}
            </Text>
          )}
        </Pressable>
      </View>

      <ScrollView contentContainerStyle={styles.body} keyboardShouldPersistTaps="handled">
        <View style={styles.identity}>
          <Pressable onPress={() => void pickAvatar()} style={styles.avatarPick}>
            {avatarUri ? (
              <Image source={{ uri: avatarUri }} style={styles.avatar} contentFit="cover" />
            ) : (
              <View style={[styles.avatar, styles.avatarEmpty, { backgroundColor: colors.surfaceMuted }]}>
                <Ionicons name="camera-outline" size={24} color={colors.textMuted} />
              </View>
            )}
          </Pressable>
          <TextInput
            value={title}
            onChangeText={setTitle}
            placeholder={t('group_create.name_placeholder')}
            placeholderTextColor={colors.textMuted}
            maxLength={60}
            style={[styles.nameInput, { color: colors.text, backgroundColor: colors.surfaceMuted }]}
          />
        </View>

        <TextInput
          value={description}
          onChangeText={setDescription}
          placeholder={t('group_create.description_placeholder')}
          placeholderTextColor={colors.textMuted}
          multiline
          maxLength={500}
          style={[styles.description, { color: colors.text, backgroundColor: colors.surfaceMuted }]}
        />

        <Pressable
          onPress={() => setPicking(true)}
          style={({ pressed }) => [styles.addRow, pressed && { opacity: 0.7 }]}
        >
          <Ionicons name="person-add-outline" size={20} color={colors.primary} />
          <Text style={[styles.addLabel, { color: colors.primary }]}>
            {members.length === 0
              ? t('group_create.add_people')
              : t('people.selected', { count: members.length })}
          </Text>
        </Pressable>

        {members.map((m) => (
          <View key={m.id} style={styles.memberRow}>
            <Image
              source={{ uri: m.avatarUri }}
              style={[styles.memberAvatar, { backgroundColor: colors.surfaceMuted }]}
              contentFit="cover"
            />
            <Text style={[styles.memberName, { color: colors.text }]} numberOfLines={1}>
              {m.name}
            </Text>
            <Pressable
              onPress={() => setMembers((prev) => prev.filter((x) => x.id !== m.id))}
              hitSlop={8}
            >
              <Ionicons name="close-circle" size={20} color={colors.textMuted} />
            </Pressable>
          </View>
        ))}
      </ScrollView>

      <PeoplePicker
        visible={picking}
        title={t('group_create.add_people')}
        confirmLabel={t('common.done')}
        excludeIds={members.map((m) => m.id)}
        onClose={() => setPicking(false)}
        // Adds to what is there rather than replacing, so reopening the
        // picker to add one more does not clear the rest.
        onConfirm={(people) =>
          setMembers((prev) => [...prev, ...people.filter((p) => !prev.some((x) => x.id === p.id))])
        }
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1 },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: Spacing.lg,
    paddingVertical: Spacing.md,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  headerTitle: { ...Typography.h3 },
  action: { ...Typography.bodyStrong },
  body: { padding: Spacing.lg, gap: Spacing.md },
  identity: { flexDirection: 'row', alignItems: 'center', gap: Spacing.md },
  avatarPick: { width: 64, height: 64 },
  avatar: { width: 64, height: 64, borderRadius: Radii.pill },
  avatarEmpty: { alignItems: 'center', justifyContent: 'center' },
  nameInput: {
    flex: 1,
    borderRadius: Radii.md,
    paddingHorizontal: Spacing.md,
    height: 46,
    ...Typography.body,
  },
  description: {
    borderRadius: Radii.md,
    padding: Spacing.md,
    minHeight: 72,
    ...Typography.body,
    textAlignVertical: 'top',
  },
  addRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, paddingVertical: Spacing.sm },
  addLabel: { ...Typography.bodyStrong },
  memberRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.md, paddingVertical: Spacing.xs },
  memberAvatar: { width: 36, height: 36, borderRadius: Radii.pill },
  memberName: { ...Typography.body, flex: 1 },
});
