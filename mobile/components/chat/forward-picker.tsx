import { Ionicons } from '@expo/vector-icons';
import { Image } from 'expo-image';
import { useEffect, useState } from 'react';
import {
  KeyboardAvoidingView,
  Platform,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  View,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';

import { Text, TextInput } from '@/components/ui/text';
import { Radii, Spacing, Typography } from '@/constants/theme';
import { useChats } from '@/data/chat-store';
import { useTheme } from '@/hooks/use-theme';
import { t } from '@/i18n';

/**
 * Pick where to forward something.
 *
 * Lifted out of the chat screen so channels can use it too. It knows nothing
 * about what is being forwarded — only how many items there are, so it can
 * say so — which is what lets a chat message and a channel post share it
 * without either one growing a special case in here.
 */
export function ForwardPicker({
  count,
  excludeChatId,
  onClose,
  onPick,
  onPickStory,
}: {
  /** How many items are being forwarded. Zero keeps the sheet closed. */
  count: number;
  /** Hidden from the list — forwarding into the chat you are already in. */
  excludeChatId?: string;
  onClose: () => void;
  onPick: (chatId: string) => void;
  /** Absent when the content cannot become a story. */
  onPickStory?: () => void;
}) {
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const [query, setQuery] = useState('');
  const { chats } = useChats();

  useEffect(() => {
    if (count === 0) setQuery('');
  }, [count]);

  // Real chats from the store — forwarding to a fixture went nowhere.
  // Groups are included: they are chats with type 'group'.
  const list = chats
    .filter((c) => c.id !== excludeChatId)
    .map((c) => ({
      id: c.id,
      name: c.title ?? 'Chat',
      username: c.peer_username ? `@${c.peer_username.replace(/^@/, '')}` : '',
      avatarUri: c.avatar_url ?? '',
      isGroup: c.type === 'group',
    }))
    .filter((c) => c.name.toLowerCase().includes(query.trim().toLowerCase()));

  return (
    <Modal
      animationType="slide"
      visible={count > 0}
      onRequestClose={onClose}
      presentationStyle="fullScreen"
    >
      {/* Full screen rather than a short sheet.
          A destination list is something people scan and search, so it wants
          the whole screen — a sheet pinned to the bottom third showed four
          rows and put the search field under the thumb rest. */}
      <SafeAreaView style={[styles.screen, { backgroundColor: colors.background }]} edges={['top']}>
        <KeyboardAvoidingView
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
          style={styles.flex}
        >
          <View style={styles.sheet}>

            <View style={[styles.header, { borderBottomColor: colors.border }]}>
              <View style={{ flex: 1 }}>
                <Text style={[styles.title, { color: colors.text }]}>
                  {t('chat.forward_title')}
                </Text>
                {count > 1 ? (
                  <Text style={[styles.hint, { color: colors.textSecondary, marginTop: 2 }]}>
                    {t('chat.selected_count', { count })}
                  </Text>
                ) : null}
              </View>
              <Pressable onPress={onClose} hitSlop={10}>
                <Ionicons name="close" size={22} color={colors.textSecondary} />
              </Pressable>
            </View>

            <View style={[styles.search, { backgroundColor: colors.surfaceMuted }]}>
              <Ionicons name="search" size={16} color={colors.textMuted} />
              <TextInput
                value={query}
                onChangeText={setQuery}
                placeholder={t('chat.forward_search')}
                placeholderTextColor={colors.textMuted}
                style={[styles.searchInput, { color: colors.text }]}
              />
            </View>

            <ScrollView
              style={styles.list}
              contentContainerStyle={{ paddingBottom: Math.max(insets.bottom, Spacing.md) }}
              keyboardShouldPersistTaps="handled"
            >
              {/* Your story, above the conversations. It is a different kind
                  of destination — one that everyone you allow can see — so it
                  is separated rather than sitting among individual people,
                  where a mistap costs a lot more. Hidden while searching,
                  since it is not a search result. */}
              {onPickStory && !query.trim() ? (
                <Pressable
                  onPress={onPickStory}
                  style={({ pressed }) => [
                    styles.row,
                    pressed && { backgroundColor: colors.surfaceMuted },
                  ]}
                >
                  <View
                    style={[styles.avatar, styles.storyIcon, { backgroundColor: colors.primary }]}
                  >
                    <Ionicons name="add-circle-outline" size={22} color={colors.onPrimary} />
                  </View>
                  <View style={styles.text}>
                    <Text style={[styles.name, { color: colors.text }]}>
                      {t('chat.forward_to_story')}
                    </Text>
                    <Text style={[styles.hint, { color: colors.textSecondary }]}>
                      {t('chat.forward_to_story_hint')}
                    </Text>
                  </View>
                </Pressable>
              ) : null}

              {list.map((c) => (
                <Pressable
                  key={c.id}
                  onPress={() => onPick(c.id)}
                  style={({ pressed }) => [
                    styles.row,
                    pressed && { backgroundColor: colors.surfaceMuted },
                  ]}
                >
                  <Image
                    source={{ uri: c.avatarUri }}
                    style={[styles.avatar, { backgroundColor: colors.surfaceMuted }]}
                    contentFit="cover"
                  />
                  <View style={styles.text}>
                    <Text style={[styles.name, { color: colors.text }]} numberOfLines={1}>
                      {c.name}
                    </Text>
                    <Text style={[styles.hint, { color: colors.textSecondary }]} numberOfLines={1}>
                      {c.isGroup ? t('chats.group') : c.username}
                    </Text>
                  </View>
                </Pressable>
              ))}
            </ScrollView>
          </View>
        </KeyboardAvoidingView>
      </SafeAreaView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  flex: { flex: 1 },
  sheet: { flex: 1, paddingHorizontal: Spacing.lg },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: Spacing.md,
    borderBottomWidth: StyleSheet.hairlineWidth,
    marginBottom: Spacing.sm,
  },
  title: { ...Typography.h3 },
  search: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
    borderRadius: Radii.pill,
    paddingHorizontal: Spacing.md,
    height: 42,
    marginBottom: Spacing.sm,
  },
  searchInput: { flex: 1, ...Typography.body, fontSize: 15, padding: 0 },
  list: { flex: 1, marginTop: Spacing.xs },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.md,
    paddingVertical: Spacing.sm + 2,
    paddingHorizontal: Spacing.xs,
    borderRadius: Radii.md,
  },
  avatar: { width: 44, height: 44, borderRadius: Radii.pill },
  storyIcon: { alignItems: 'center', justifyContent: 'center' },
  text: { flex: 1, gap: 2 },
  name: { ...Typography.body, fontSize: 15, fontWeight: '600' },
  hint: { ...Typography.caption },
});
