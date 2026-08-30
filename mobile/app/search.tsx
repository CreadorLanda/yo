import { Ionicons } from '@expo/vector-icons';
import { Image } from 'expo-image';
import { router } from 'expo-router';
import { useEffect, useState } from 'react';
import { FlatList, Pressable, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Text, TextInput } from '@/components/ui/text';
import { Radii, Spacing, Typography } from '@/constants/theme';
import { createChat } from '@/data/api/messages';
import { searchUsers, type PublicUser } from '@/data/api/users';
import { isValidCode, unlockWithCode, useRevealedChats } from '@/data/chat-lock';
import { searchNotes } from '@/data/db/notes';
import { useLockedChatIds } from '@/data/chat-prefs';
import { useChats } from '@/data/chat-store';
import { useTheme } from '@/hooks/use-theme';
import { t } from '@/i18n';

export default function SearchScreen() {
  const { colors } = useTheme();
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<PublicUser[]>([]);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (query.length < 2) { setResults([]); return; }
    const id = setTimeout(async () => {
      try { setResults(await searchUsers(query) ?? []); }
      catch { setResults([]); }
    }, 300);
    return () => clearTimeout(id);
  }, [query]);

  /**
   * Typing the passcode here reveals locked conversations.
   *
   * There is deliberately no button, no hint and no "unlock" affordance:
   * an entry point that advertises itself tells anyone holding the phone
   * that hidden conversations exist, which is the one thing a locked chat
   * is trying not to say. The code behaves like any other search term until
   * it happens to be the right one.
   *
   * Checked silently, and a wrong guess is indistinguishable from a search
   * that found nothing.
   */
  useEffect(() => {
    if (!isValidCode(query)) return;
    let cancelled = false;
    void unlockWithCode(query).then((ok) => {
      if (ok && !cancelled) setQuery('');
    });
    return () => {
      cancelled = true;
    };
  }, [query]);

  /**
   * Search private notes alongside people.
   *
   * You remember "the electrician from the flat" long after you have
   * forgotten their name, and that sentence is already written down — in a
   * note nothing was searching. Runs entirely on-device: the query never
   * leaves the phone, unlike the user search beside it.
   */
  const [noteHits, setNoteHits] = useState<{ chatId: string; body: string }[]>([]);
  useEffect(() => {
    if (query.trim().length < 2) {
      setNoteHits([]);
      return;
    }
    let cancelled = false;
    const id = setTimeout(() => {
      searchNotes(query)
        .then((n) => {
          if (!cancelled) setNoteHits(n.map((x) => ({ chatId: x.chatId, body: x.body })));
        })
        .catch(() => {});
    }, 200);
    return () => {
      cancelled = true;
      clearTimeout(id);
    };
  }, [query]);

  const lockedIds = useLockedChatIds();
  const revealed = useRevealedChats();
  const { chats } = useChats();
  const revealedChats = chats.filter((c) => lockedIds.has(c.id) && revealed.has(c.id));

  /**
   * Note hits must respect the lock too.
   *
   * Note search reaches the local database directly, so it bypassed the
   * filtering the chat list does — a locked conversation surfaced here from
   * its own note, without the code. The leak came in with the feature that
   * searches notes, which is exactly the kind of path a new reader is meant
   * to check against an existing rule.
   */
  const visibleNoteHits = noteHits.filter(
    (n) => !lockedIds.has(n.chatId) || revealed.has(n.chatId),
  );

  const handleSelectUser = async (user: PublicUser) => {
    setBusy(true);
    try {
      const { chat_id } = await createChat(user.id);
      router.back();
      router.push(`/chat/${chat_id}`);
    } catch {
      router.back();
    } finally {
      setBusy(false);
    }
  };

  return (
    <SafeAreaView style={[styles.safe, { backgroundColor: colors.background }]}>
      <View style={[styles.header, { backgroundColor: colors.surface, borderBottomColor: colors.divider }]}>
        <View style={[styles.field, { backgroundColor: colors.surfaceMuted }]}>
          <Ionicons name="search" size={18} color={colors.textMuted} />
          <TextInput
            value={query}
            onChangeText={setQuery}
            placeholder={t('discover.search_placeholder')}
            placeholderTextColor={colors.textMuted}
            style={[styles.input, { color: colors.text }]}
            autoFocus
            autoCapitalize="none"
            autoCorrect={false}
          />
          {query.length > 0 ? (
            <Pressable onPress={() => setQuery('')} hitSlop={8}>
              <Ionicons name="close-circle" size={18} color={colors.textMuted} />
            </Pressable>
          ) : null}
        </View>
        <Pressable onPress={() => router.back()} hitSlop={8} style={styles.cancelBtn}>
          <Text style={[styles.cancel, { color: colors.primary }]}>{t('common.cancel')}</Text>
        </Pressable>
      </View>

      <FlatList
        data={results}
        keyExtractor={(item) => item.id}
        renderItem={({ item }) => (
          <Pressable
            onPress={() => handleSelectUser(item)}
            disabled={busy}
            style={({ pressed }) => [
              styles.row,
              { backgroundColor: colors.background },
              pressed && { backgroundColor: colors.surfaceMuted },
            ]}
          >
            <View style={[styles.avatar, { backgroundColor: colors.surfaceMuted }]}>
              {item.avatar_uri ? (
                <Image source={{ uri: item.avatar_uri }} style={styles.avatarImg} contentFit="cover" />
              ) : (
                <Ionicons name="person" size={24} color={colors.textMuted} />
              )}
            </View>
            <View style={styles.text}>
              <Text style={[styles.name, { color: colors.text }]} numberOfLines={1}>
                {item.display_name || item.username}
              </Text>
              <Text style={[styles.username, { color: colors.textSecondary }]} numberOfLines={1}>
                @{item.username}
              </Text>
            </View>
            <Ionicons name="chatbubble-ellipses-outline" size={20} color={colors.primary} />
          </Pressable>
        )}
        contentContainerStyle={results?.length === 0 ? styles.empty : undefined}
        ListHeaderComponent={
          <View>
            {visibleNoteHits.length > 0 ? (
              <View>
                <Text style={[styles.sectionTitle, { color: colors.textSecondary }]}>
                  {t('notes.section')}
                </Text>
                {visibleNoteHits.map((n) => {
                  const chat = chats.find((c) => c.id === n.chatId);
                  return (
                    <Pressable
                      key={n.chatId}
                      onPress={() => {
                        router.back();
                        router.push(`/chat/${n.chatId}`);
                      }}
                      style={({ pressed }) => [styles.row, pressed && { backgroundColor: colors.surfaceMuted }]}
                    >
                      <View style={[styles.noteIcon, { backgroundColor: colors.surfaceMuted }]}>
                        <Ionicons name="reader-outline" size={18} color={colors.primary} />
                      </View>
                      <View style={{ flex: 1 }}>
                        <Text style={[styles.name, { color: colors.text }]} numberOfLines={1}>
                          {chat?.title ?? chat?.peer_username ?? t('chats.unknown')}
                        </Text>
                        <Text style={[styles.noteBody, { color: colors.textSecondary }]} numberOfLines={1}>
                          {n.body}
                        </Text>
                      </View>
                    </Pressable>
                  );
                })}
              </View>
            ) : null}
            {revealedChats.length > 0 ? (
            <View>
              <Text style={[styles.sectionTitle, { color: colors.textSecondary }]}>
                {t('chats.locked_section')}
              </Text>
              {revealedChats.map((c) => (
                <Pressable
                  key={c.id}
                  onPress={() => {
                    router.back();
                    router.push(`/chat/${c.id}`);
                  }}
                  style={({ pressed }) => [styles.row, pressed && { backgroundColor: colors.surfaceMuted }]}
                >
                  <Image
                    source={{ uri: c.avatar_url ?? '' }}
                    style={[styles.avatar, { backgroundColor: colors.surfaceMuted }]}
                    contentFit="cover"
                  />
                  <View style={{ flex: 1 }}>
                    <Text style={[styles.name, { color: colors.text }]} numberOfLines={1}>
                      {c.title ?? c.peer_username ?? ''}
                    </Text>
                  </View>
                  <Ionicons name="lock-open-outline" size={18} color={colors.primary} />
                </Pressable>
              ))}
            </View>
            ) : null}
          </View>
        }
        ListEmptyComponent={
          query.length < 2 ? (
            <Text style={[styles.hint, { color: colors.textMuted }]}>
              {t('search.type_to_search')}
            </Text>
          ) : (
            <Text style={[styles.hint, { color: colors.textMuted }]}>
              {t('search.no_results')}
            </Text>
          )
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
    gap: Spacing.sm,
    paddingHorizontal: Spacing.lg,
    paddingVertical: Spacing.sm,
    borderBottomWidth: 1,
  },
  field: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
    paddingHorizontal: Spacing.md,
    height: 40,
    borderRadius: Radii.pill,
  },
  input: { flex: 1, ...Typography.body, fontSize: 15, padding: 0 },
  cancelBtn: { paddingVertical: Spacing.xs },
  cancel: { ...Typography.bodyStrong },
  sectionTitle: { ...Typography.caption, paddingHorizontal: Spacing.lg, paddingTop: Spacing.md, paddingBottom: Spacing.xs },
  noteIcon: { width: 44, height: 44, borderRadius: Radii.md, alignItems: 'center', justifyContent: 'center' },
  noteBody: { ...Typography.caption, marginTop: 2 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.md,
    paddingHorizontal: Spacing.lg,
    paddingVertical: Spacing.sm + 2,
  },
  avatar: {
    width: 48, height: 48, borderRadius: Radii.pill,
    alignItems: 'center', justifyContent: 'center', overflow: 'hidden',
  },
  avatarImg: { width: '100%', height: '100%' },
  text: { flex: 1 },
  name: { ...Typography.body, fontWeight: '600' },
  username: { ...Typography.caption, marginTop: 1 },
  empty: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  hint: { ...Typography.body, textAlign: 'center', paddingHorizontal: Spacing.xl },
});
