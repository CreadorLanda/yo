import { Ionicons } from '@expo/vector-icons';
import { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  StyleSheet,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Avatar } from '@/components/ui/avatar';
import { Text, TextInput } from '@/components/ui/text';
import { Radii, Spacing, Typography } from '@/constants/theme';
import type { ApiUser } from '@/data/api/auth';
import { searchUsers } from '@/data/api/users';
import { getCurrentUser } from '@/data/auth-store';
import { useChats } from '@/data/chat-store';
import { useTheme } from '@/hooks/use-theme';
import { t } from '@/i18n';

/**
 * Choose people, by search or from who you already talk to.
 *
 * Built once and shared: creating a group, adding to a group and inviting
 * someone to a channel are the same question, and three copies of it would
 * be three places for the rules to drift apart.
 *
 * Existing conversations come first because that is who most invitations go
 * to, and searching the whole directory to find someone you messaged an hour
 * ago is work the app can save.
 */
export type PickablePerson = { id: string; name: string; username: string; avatarUri: string };

export function PeoplePicker({
  visible,
  title,
  confirmLabel,
  /** Already in the group or channel — shown as members, not choices. */
  excludeIds = [],
  multiple = true,
  onClose,
  onConfirm,
}: {
  visible: boolean;
  title: string;
  confirmLabel: string;
  excludeIds?: string[];
  multiple?: boolean;
  onClose: () => void;
  onConfirm: (people: PickablePerson[]) => void;
}) {
  const { colors } = useTheme();
  const { chats } = useChats();
  const me = getCurrentUser()?.id;

  const [query, setQuery] = useState('');
  const [found, setFound] = useState<ApiUser[] | null>(null);
  const [picked, setPicked] = useState<PickablePerson[]>([]);

  useEffect(() => {
    if (!visible) return;
    setQuery('');
    setFound(null);
    setPicked([]);
  }, [visible]);

  useEffect(() => {
    const q = query.trim();
    if (q.length < 2) {
      setFound(null);
      return;
    }
    let cancelled = false;
    const timer = setTimeout(() => {
      searchUsers(q)
        .then((list) => {
          if (!cancelled) setFound(list ?? []);
        })
        .catch(() => {
          if (!cancelled) setFound([]);
        });
    }, 300);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [query]);

  // People you already have a one-to-one chat with. A group has no single
  // peer, so group chats are not suggestions.
  const known: PickablePerson[] = chats
    .filter((c) => c.type === 'direct' && c.peer_user_id)
    .map((c) => ({
      id: c.peer_user_id!,
      name: c.title ?? c.peer_username ?? '',
      username: c.peer_username ?? '',
      avatarUri: c.avatar_url ?? '',
    }));

  const excluded = new Set([...excludeIds, ...(me ? [me] : [])]);
  const list: PickablePerson[] = (
    found
      ? found.map((u) => ({
          id: u.id,
          name: u.display_name || u.username,
          username: u.username,
          avatarUri: u.avatar_uri ?? '',
        }))
      : known
  ).filter((p) => !excluded.has(p.id));

  const toggle = (p: PickablePerson) => {
    if (!multiple) {
      onConfirm([p]);
      onClose();
      return;
    }
    setPicked((prev) =>
      prev.some((x) => x.id === p.id) ? prev.filter((x) => x.id !== p.id) : [...prev, p],
    );
  };

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onClose}>
      <SafeAreaView style={[styles.safe, { backgroundColor: colors.background }]} edges={['top']}>
        <KeyboardAvoidingView
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
          style={styles.flex}
        >
          <View style={[styles.header, { borderBottomColor: colors.border }]}>
            <Pressable onPress={onClose} hitSlop={10} accessibilityRole="button">
              <Ionicons name="close" size={24} color={colors.text} />
            </Pressable>
            <Text style={[styles.title, { color: colors.text }]} numberOfLines={1}>
              {title}
            </Text>
            <Pressable
              onPress={() => {
                onConfirm(picked);
                onClose();
              }}
              disabled={multiple && picked.length === 0}
              hitSlop={10}
            >
              <Text
                style={[
                  styles.confirm,
                  { color: !multiple || picked.length > 0 ? colors.primary : colors.textMuted },
                ]}
              >
                {confirmLabel}
              </Text>
            </Pressable>
          </View>

          <View style={[styles.search, { backgroundColor: colors.surfaceMuted }]}>
            <Ionicons name="search" size={16} color={colors.textMuted} />
            <TextInput
              value={query}
              onChangeText={setQuery}
              autoCapitalize="none"
              autoCorrect={false}
              placeholder={t('people.search_placeholder')}
              placeholderTextColor={colors.textMuted}
              style={[styles.searchInput, { color: colors.text }]}
            />
          </View>

          {picked.length > 0 ? (
            <Text style={[styles.count, { color: colors.textSecondary }]}>
              {t('people.selected', { count: picked.length })}
            </Text>
          ) : null}

          {query.trim().length >= 2 && found === null ? (
            <View style={styles.center}>
              <ActivityIndicator color={colors.primary} />
            </View>
          ) : (
            <FlatList
              data={list}
              keyExtractor={(p) => p.id}
              keyboardShouldPersistTaps="handled"
              ListHeaderComponent={
                !query.trim() && list.length > 0 ? (
                  <Text style={[styles.section, { color: colors.textSecondary }]}>
                    {t('people.recent')}
                  </Text>
                ) : null
              }
              ListEmptyComponent={
                <Text style={[styles.empty, { color: colors.textMuted }]}>
                  {query.trim() ? t('people.no_results') : t('people.search_hint')}
                </Text>
              }
              renderItem={({ item }) => {
                const on = picked.some((x) => x.id === item.id);
                return (
                  <Pressable
                    onPress={() => toggle(item)}
                    style={({ pressed }) => [
                      styles.row,
                      pressed && { backgroundColor: colors.surfaceMuted },
                    ]}
                    accessibilityRole={multiple ? 'checkbox' : 'button'}
                    accessibilityState={{ checked: on }}
                  >
                    <Avatar
                      uri={item.avatarUri}
                      id={item.id}
                      username={item.username || item.name}
                      size={44}
                      style={styles.avatar}
                    />
                    <View style={{ flex: 1 }}>
                      <Text style={[styles.name, { color: colors.text }]} numberOfLines={1}>
                        {item.name}
                      </Text>
                      <Text style={[styles.handle, { color: colors.textSecondary }]} numberOfLines={1}>
                        @{item.username.replace(/^@/, '')}
                      </Text>
                    </View>
                    {multiple ? (
                      <View
                        style={[
                          styles.check,
                          {
                            borderColor: on ? colors.primary : colors.border,
                            backgroundColor: on ? colors.primary : 'transparent',
                          },
                        ]}
                      >
                        {on ? <Ionicons name="checkmark" size={14} color={colors.onPrimary} /> : null}
                      </View>
                    ) : null}
                  </Pressable>
                );
              }}
            />
          )}
        </KeyboardAvoidingView>
      </SafeAreaView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1 },
  flex: { flex: 1 },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: Spacing.md,
    paddingHorizontal: Spacing.lg,
    paddingVertical: Spacing.md,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  title: { ...Typography.h3, flex: 1, textAlign: 'center' },
  confirm: { ...Typography.bodyStrong },
  search: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
    marginHorizontal: Spacing.lg,
    marginTop: Spacing.md,
    paddingHorizontal: Spacing.md,
    height: 42,
    borderRadius: Radii.pill,
  },
  searchInput: { flex: 1, ...Typography.body, padding: 0 },
  count: { ...Typography.caption, paddingHorizontal: Spacing.lg, paddingTop: Spacing.sm },
  section: {
    ...Typography.caption,
    textTransform: 'uppercase',
    paddingHorizontal: Spacing.lg,
    paddingTop: Spacing.lg,
    paddingBottom: Spacing.xs,
  },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.md,
    paddingHorizontal: Spacing.lg,
    paddingVertical: Spacing.sm,
  },
  avatar: { width: 44, height: 44, borderRadius: Radii.pill },
  name: { ...Typography.body },
  handle: { ...Typography.caption, marginTop: 2 },
  check: {
    width: 22,
    height: 22,
    borderRadius: Radii.pill,
    borderWidth: 1.5,
    alignItems: 'center',
    justifyContent: 'center',
  },
  empty: { ...Typography.body, textAlign: 'center', paddingTop: Spacing.xl },
});
