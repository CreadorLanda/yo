import { Ionicons } from '@expo/vector-icons';
import { router, useFocusEffect } from 'expo-router';
import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  FlatList,
  Modal,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  View,
} from 'react-native';
import { KeyboardAvoidingView } from 'react-native-keyboard-controller';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { EmptyState } from '@/components/ui/empty-state';
import { TabScene } from '@/components/ui/tab-scene';
import { Avatar } from '@/components/ui/avatar';
import { Text, TextInput } from '@/components/ui/text';
import { Radii, Spacing, Typography } from '@/constants/theme';
import { appAlert } from '@/data/dialog-store';
import { connectRealtime, type ChatDTO } from '@/data/api/messages';
import { getCurrentUser } from '@/data/auth-store';
import {
  applyRealtimeEvent,
  refreshChats,
  useArchivedChats,
  removeChat,
  setChatSettings,
  useChats,
} from '@/data/chat-store';
import { bootstrapChatPrefs, useLockedChatIds } from '@/data/chat-prefs';
import { ChannelInvitesSheet } from '@/components/channel/invites-sheet';
import { AnonInbox } from '@/components/story/anon-inbox';
import { listChannelInvites } from '@/data/api/channels';
import { anonInbox, type AnonThread } from '@/data/api/stories';
import { useRevealedChats } from '@/data/chat-lock';
import { decryptMessageContent } from '@/data/message-map';
import { bootstrapGroups } from '@/data/group-store';
import {
  addCustomFilter,
  bootstrapFilters,
  removeCustomFilter,
  useCustomFilters,
  type CustomFilter,
} from '@/data/filter-store';
import type { ChatPreview } from '@/data/mock';
import { useTheme } from '@/hooks/use-theme';
import { handleCallEvent } from '@/data/incoming-call';
import { handleLiveEvent } from '@/data/live-store';
import { t } from '@/i18n';

const BUILTIN_IDS = ['all', 'unread', 'read', 'groups', 'pending'];

/**
 * Caption out of a media payload, if there is one.
 *
 * The payload is JSON, and for direct chats it arrives wrapped in an E2EE
 * envelope the list cannot open synchronously — in that case there is no
 * caption to show and the generic word stands in.
 */
function mediaCaption(content?: string): string {
  if (!content || !content.trim().startsWith('{')) return '';
  try {
    const o = JSON.parse(content) as { caption?: string };
    return (o.caption ?? '').trim();
  } catch {
    return '';
  }
}

export default function ChatsScreen() {
  const { colors } = useTheme();
  const customFilters = useCustomFilters();

  const [activeFilter, setActiveFilter] = useState('all');
  const [showCreate, setShowCreate] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<CustomFilter | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [manageTarget, setManageTarget] = useState<ChatPreview | null>(null);
  // Message previews arrive as E2EE envelopes; decrypt them off the render path.
  const [previews, setPreviews] = useState<Record<string, string>>({});

  const { chats: apiChats, loaded: apiLoaded } = useChats();

  const lockedIds = useLockedChatIds();
  useEffect(() => {
    void bootstrapFilters();
  }, []);
  const revealed = useRevealedChats();

  useEffect(() => {
    void refreshChats();
    void bootstrapChatPrefs();
    bootstrapGroups().catch(() => {});
  }, []);

  // The list is the screen you come back to. Without this it keeps
  // whatever it fetched on mount, so a message you just sent never shows.
  useFocusEffect(
    useCallback(() => {
      void refreshChats();
    }, []),
  );

  // Realtime: a new message must reorder the list, not wait for a revisit.
  useEffect(() => {
    let closed = false;
    let sock: WebSocket | null = null;
    let retry: ReturnType<typeof setTimeout> | null = null;

    const connect = () => {
      connectRealtime(
        (evt) => {
          // A call can arrive while the chat list is on screen; the store
          // decides what to show, this handler only forwards.
          if (handleCallEvent(evt?.type, evt?.payload)) return;
          // A broadcast likewise: it starts, ends and changes size on any screen.
          if (handleLiveEvent(evt?.type, evt?.payload)) return;
          applyRealtimeEvent(evt?.type);
        },
        () => {
          if (closed) return;
          retry = setTimeout(connect, 2500);
        },
      )
        .then((s) => {
          if (closed) {
            s?.close();
            return;
          }
          sock = s;
        })
        .catch(() => {});
    };
    connect();

    return () => {
      closed = true;
      if (retry) clearTimeout(retry);
      sock?.close();
    };
  }, []);

  /**
   * Non-text messages carry an encoded payload, not something readable.
   * Label them instead — otherwise the list shows raw {"url":…} JSON.
   */
  const previewLabel = useCallback((c: ChatDTO): string | null => {
    const mt = c.last_message?.message_type;

    // A photo or video with a caption reads better as the caption itself —
    // "Fotos e vídeos" tells you nothing you cannot see from the icon.
    // The generic word is only a fallback for media sent without one.
    const captioned = (icon: string, fallback: string) => {
      const caption = mediaCaption(c.last_message?.content);
      return `${icon} ${caption || fallback}`;
    };

    switch (mt) {
      case 'sticker':
        return `\u{1F9E9} ${t('chat.sticker')}`;
      case 'image':
        return captioned('\u{1F4F7}', t('chat.photo'));
      case 'video':
        return captioned('\u{1F3A5}', t('chat.video'));
      case 'audio':
        return `\u{1F3B5} ${t('chat.attach_audio')}`;
      case 'document':
        return `\u{1F4C4} ${t('chat.attach_document')}`;
      // Rich attachments are JSON payloads too — without these the list
      // rendered the raw {"kind":"poll",…} blob.
      case 'location':
        return `\u{1F4CD} ${t('chat.attach_location')}`;
      case 'contact':
        return `\u{1F464} ${t('chat.attach_contact')}`;
      case 'poll':
        return `\u{1F4CA} ${t('chat.poll_label')}`;
      case 'event':
        return `\u{1F4C5} ${t('chat.event_label')}`;
      default:
        return null;
    }
  }, []);

  // Decrypt the last-message previews. The server decrypts its own at-rest
  // layer, but client-side E2EE envelopes still arrive as `soc1.…` and
  // would otherwise render as ciphertext in the list.
  useEffect(() => {
    let cancelled = false;
    const me = getCurrentUser()?.id;
    (async () => {
      // Decrypt in parallel: awaiting one chat at a time serialised a
      // keystore read per row, which is what made the list crawl.
      const entries = await Promise.all(
        apiChats.map(async (c) => {
          const lm = c.last_message;
          if (!lm?.content) return null;
          // Non-text messages never need decrypting — they get a label.
          const label = previewLabel(c);
          if (label) return [c.id, label] as const;
          const text = await decryptMessageContent(
          {
            id: 0,
            chat_id: c.id,
            sender_id: lm.sender_id,
            content: lm.content,
            message_type: 'text',
            created_at: lm.created_at,
          } as never,
            me,
            c.peer_user_id,
          );
          return [c.id, text] as const;
        }),
      );
      const next = Object.fromEntries(entries.filter(Boolean) as (readonly [string, string])[]);
      if (!cancelled) setPreviews(next);
    })();
    return () => {
      cancelled = true;
    };
  }, [apiChats, previewLabel]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await refreshChats();
    setRefreshing(false);
  }, []);

  // Drop back to "All" if the active custom filter gets removed.
  useEffect(() => {
    if (!BUILTIN_IDS.includes(activeFilter) && !customFilters.some((f) => f.id === activeFilter)) {
      setActiveFilter('all');
    }
  }, [customFilters, activeFilter]);

  // Archived chats are fetched here purely for the count on the entry row;
  // the screen itself refetches when opened.
  // Blind threads, for the folder above the list. Counted here rather than
  // inside the sheet so the row can be hidden entirely when there are none.
  const [inviteCount, setInviteCount] = useState(0);
  const [invitesOpen, setInvitesOpen] = useState(false);
  const loadInvites = useCallback(() => {
    listChannelInvites()
      .then((list) => setInviteCount(list?.length ?? 0))
      .catch(() => {});
  }, []);
  useEffect(() => {
    loadInvites();
  }, [loadInvites]);

  const [anonThreads, setAnonThreads] = useState<AnonThread[]>([]);
  const [anonOpen, setAnonOpen] = useState(false);
  const loadAnon = useCallback(() => {
    anonInbox()
      .then((list) => setAnonThreads(list ?? []))
      .catch(() => {});
  }, []);
  useEffect(() => {
    loadAnon();
  }, [loadAnon]);
  const anonCount = anonThreads.length;
  const anonUnread = anonThreads.reduce((n, x) => n + (x.unread ?? 0), 0);

  const archivedChats = useArchivedChats();
  const archivedCount = archivedChats.length;
  useEffect(() => {
    void refreshChats({ archived: true });
  }, []);

  // Map API chats to the local ChatPreview type.
  const chats = useMemo(() => {
    if (!apiLoaded) return [] as ChatPreview[];
    const combined: ChatPreview[] = apiChats.map((c) => ({
      id: c.id,
      name: c.title ?? 'Unknown',
      username: c.peer_username ? `@${c.peer_username.replace(/^@/, '')}` : '',
      avatarUri: c.avatar_url ?? '',
      peerUserId: c.peer_user_id,
      // Prefer the decrypted preview; the raw value is an E2EE envelope.
      lastMessage: lockedIds.has(c.id)
        ? t('chats.locked_preview')
        : previews[c.id] ?? (c.last_message ? '…' : ''),
      timestamp: c.last_message ? new Date(c.last_message.created_at).toLocaleTimeString() : '',
      unreadCount: c.unread_count,
      online: false,
      isPending: c.status === 'pending',
      isGroup: c.type === 'group',
      pinned: !!c.pinned_at,
      muted: !!c.muted_until,
    }));

    // Locked chats leave the list entirely rather than showing a dimmed
    // preview. A row that says "locked" still tells anyone holding the phone
    // who you talk to and how often — which is most of what the lock was
    // meant to hide. They come back only through search, with the code.
    const visible = combined.filter((c) => !lockedIds.has(c.id) || revealed.has(c.id));

    if (activeFilter === 'pending') return visible.filter((c) => c.isPending);
    if (activeFilter === 'unread') return visible.filter((c) => c.unreadCount > 0);
    if (activeFilter === 'read') return visible.filter((c) => c.unreadCount === 0);
    if (activeFilter === 'groups') return visible.filter((c) => c.isGroup);
    const custom = customFilters.find((f) => f.id === activeFilter);
    if (custom) return visible.filter((c) => custom.chatIds.includes(c.id));
    return visible;
  }, [activeFilter, customFilters, apiChats, apiLoaded, previews, lockedIds, revealed]);

  // Long-press management. Every action hits the API through the store,
  // so the state survives leaving the screen.
  const runManage = useCallback(
    async (chat: ChatPreview, action: 'pin' | 'mute' | 'archive' | 'delete') => {
      setManageTarget(null);
      try {
        switch (action) {
          case 'pin':
            await setChatSettings(chat.id, { pinned: !chat.pinned });
            break;
          case 'mute':
            await setChatSettings(chat.id, { muted: !chat.muted });
            break;
          case 'archive':
            await setChatSettings(chat.id, { archived: true });
            break;
          case 'delete':
            await removeChat(chat.id);
            break;
        }
      } catch {
        appAlert(t('chats.action_failed_title'), t('chats.action_failed_body'));
      }
    },
    [],
  );

  const handleSaveFilter = (name: string, chatIds: string[]) => {
    // Persisting the list is a database write now, so the id only exists
    // once it lands. Selecting it before then would activate a filter that
    // does not exist yet and show an empty list.
    void addCustomFilter(name, chatIds).then(setActiveFilter);
    setShowCreate(false);
  };

  const handleConfirmDelete = () => {
    if (deleteTarget) void removeCustomFilter(deleteTarget.id);
    setDeleteTarget(null);
  };

  return (
    <TabScene>
      <View style={[styles.container, { backgroundColor: colors.background }]}>
        <FlatList
          data={chats}
          keyExtractor={(item) => item.id}
          ListHeaderComponent={
            <>
              <FilterBar
                active={activeFilter}
                custom={customFilters}
                onSelect={setActiveFilter}
                onCreate={() => setShowCreate(true)}
                onDeleteRequest={setDeleteTarget}
              />
              {/* Only once something is in there. An always-present row for an
                  empty archive is noise at the top of every list. */}
              {/* Requests to help run a channel. Above the rest: it is the
                  only folder here that is waiting on a decision. */}
              {inviteCount > 0 ? (
                <Pressable
                  onPress={() => setInvitesOpen(true)}
                  style={({ pressed }) => [
                    styles.archivedRow,
                    pressed && { backgroundColor: colors.surfaceMuted },
                  ]}
                  accessibilityRole="button"
                  accessibilityLabel={t('channel_invites.title')}
                >
                  <Ionicons name="mail-unread-outline" size={20} color={colors.primary} />
                  <Text style={[styles.archivedLabel, { color: colors.text }]}>
                    {t('channel_invites.title')}
                  </Text>
                  <View style={[styles.anonBadge, { backgroundColor: colors.primary }]}>
                    <Text style={[styles.anonBadgeText, { color: colors.onPrimary }]}>
                      {inviteCount}
                    </Text>
                  </View>
                </Pressable>
              ) : null}

              {/* Blind threads. A folder rather than rows in the list: they
                  have no name or avatar to render, and mixing nameless
                  entries among named ones reads as data missing rather than
                  data withheld. */}
              {anonCount > 0 ? (
                <Pressable
                  onPress={() => setAnonOpen(true)}
                  style={({ pressed }) => [
                    styles.archivedRow,
                    pressed && { backgroundColor: colors.surfaceMuted },
                  ]}
                  accessibilityRole="button"
                  accessibilityLabel={t('anon.inbox_title')}
                >
                  <Ionicons name="eye-off-outline" size={20} color={colors.textSecondary} />
                  <Text style={[styles.archivedLabel, { color: colors.text }]}>
                    {t('anon.inbox_title')}
                  </Text>
                  {anonUnread > 0 ? (
                    <View style={[styles.anonBadge, { backgroundColor: colors.primary }]}>
                      <Text style={[styles.anonBadgeText, { color: colors.onPrimary }]}>
                        {anonUnread}
                      </Text>
                    </View>
                  ) : (
                    <Text style={[styles.archivedCount, { color: colors.textSecondary }]}>
                      {anonCount}
                    </Text>
                  )}
                </Pressable>
              ) : null}

              {archivedCount > 0 ? (
                <Pressable
                  onPress={() => router.push('/archived')}
                  style={({ pressed }) => [
                    styles.archivedRow,
                    pressed && { backgroundColor: colors.surfaceMuted },
                  ]}
                  accessibilityRole="button"
                  accessibilityLabel={t('chats.archived')}
                >
                  <Ionicons name="archive-outline" size={20} color={colors.textSecondary} />
                  <Text style={[styles.archivedLabel, { color: colors.text }]}>
                    {t('chats.archived')}
                  </Text>
                  <Text style={[styles.archivedCount, { color: colors.textSecondary }]}>
                    {archivedCount}
                  </Text>
                </Pressable>
              ) : null}
            </>
          }
          refreshControl={
            <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.primary} />
          }
          renderItem={({ item }) => (
            <ChatRow chat={item} onManage={() => setManageTarget(item)} />
          )}
          ItemSeparatorComponent={() => (
            <View style={[styles.separator, { backgroundColor: colors.divider }]} />
          )}
          ListEmptyComponent={
            <EmptyState
              icon="filter-outline"
              title={t('chats.filter_empty_title')}
              description={t('chats.filter_empty_hint')}
            />
          }
          contentContainerStyle={styles.list}
        />

        {/* New group sits above the new-chat button rather than behind a
            long press: there was no way to create one at all, and a gesture
            nobody is told about would not have fixed that. */}
        <Pressable
          onPress={() => router.push('/group/create')}
          style={({ pressed }) => [
            styles.fabSmall,
            { backgroundColor: colors.surface, borderColor: colors.border },
            pressed && styles.fabPressed,
          ]}
          accessibilityRole="button"
          accessibilityLabel={t('group_create.title')}
        >
          <Ionicons name="people" size={20} color={colors.primary} />
        </Pressable>

        <Pressable
          onPress={() => router.push('/search')}
          style={({ pressed }) => [
            styles.fab,
            { backgroundColor: colors.primary, shadowColor: colors.primary },
            pressed && styles.fabPressed,
          ]}
          accessibilityRole="button"
          accessibilityLabel={t('chats.new_chat')}
        >
          <Ionicons name="chatbubble-ellipses" size={24} color={colors.onPrimary} />
        </Pressable>
      </View>

      <CreateFilterSheet
        visible={showCreate}
        chats={apiChats}
        onClose={() => setShowCreate(false)}
        onSave={handleSaveFilter}
      />
      <DeleteFilterModal
        target={deleteTarget}
        onCancel={() => setDeleteTarget(null)}
        onConfirm={handleConfirmDelete}
      />
      <ManageChatSheet
        chat={manageTarget}
        onClose={() => setManageTarget(null)}
        onAction={runManage}
      />
      <ChannelInvitesSheet
        visible={invitesOpen}
        onClose={() => setInvitesOpen(false)}
        onChanged={loadInvites}
      />

      <AnonInbox
        visible={anonOpen}
        onClose={() => {
          setAnonOpen(false);
          loadAnon();
        }}
      />
    </TabScene>
  );
}

// ── Long-press chat management ────────────────────────────────────────────────
function ManageChatSheet({
  chat,
  onClose,
  onAction,
}: {
  chat: ChatPreview | null;
  onClose: () => void;
  onAction: (chat: ChatPreview, action: 'pin' | 'mute' | 'archive' | 'delete') => void;
}) {
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  if (!chat) return null;

  const items: {
    key: 'pin' | 'mute' | 'archive' | 'delete';
    icon: keyof typeof Ionicons.glyphMap;
    label: string;
    danger?: boolean;
  }[] = [
    {
      key: 'pin',
      icon: chat.pinned ? 'pin' : 'pin-outline',
      label: chat.pinned ? t('chats.unpin') : t('chats.pin'),
    },
    {
      key: 'mute',
      icon: chat.muted ? 'volume-high-outline' : 'volume-mute-outline',
      label: chat.muted ? t('chats.unmute') : t('chats.mute'),
    },
    { key: 'archive', icon: 'archive-outline', label: t('chats.archive') },
    { key: 'delete', icon: 'trash-outline', label: t('chats.delete'), danger: true },
  ];

  return (
    <Modal transparent animationType="slide" visible onRequestClose={onClose}>
      <Pressable style={styles.manageBackdrop} onPress={onClose}>
        <Pressable
          style={[
            styles.manageSheet,
            { backgroundColor: colors.surface, paddingBottom: insets.bottom + Spacing.md },
          ]}
          onPress={(e) => e.stopPropagation()}
        >
          <Text style={[styles.manageTitle, { color: colors.text }]} numberOfLines={1}>
            {chat.name}
          </Text>
          {items.map((it) => (
            <Pressable
              key={it.key}
              onPress={() => onAction(chat, it.key)}
              style={({ pressed }) => [
                styles.manageRow,
                pressed && { backgroundColor: colors.surfaceMuted },
              ]}
              accessibilityRole="button"
              accessibilityLabel={it.label}
            >
              <Ionicons
                name={it.icon}
                size={20}
                color={it.danger ? colors.danger : colors.textSecondary}
              />
              <Text
                style={[styles.manageLabel, { color: it.danger ? colors.danger : colors.text }]}
              >
                {it.label}
              </Text>
            </Pressable>
          ))}
        </Pressable>
      </Pressable>
    </Modal>
  );
}

// ── Filter chips ──────────────────────────────────────────────────────────────
function FilterBar({
  active,
  custom,
  onSelect,
  onCreate,
  onDeleteRequest,
}: {
  active: string;
  custom: CustomFilter[];
  onSelect: (id: string) => void;
  onCreate: () => void;
  onDeleteRequest: (filter: CustomFilter) => void;
}) {
  const { colors } = useTheme();
  const builtins = [
    { id: 'all', label: t('chats.filter_all') },
    { id: 'unread', label: t('chats.filter_unread') },
    { id: 'read', label: t('chats.filter_read') },
    { id: 'groups', label: t('chats.filter_groups') },
    { id: 'pending', label: t('chats.filter_pending') },
  ];

  return (
    <View style={[styles.filterWrap, { backgroundColor: colors.background, borderBottomColor: colors.divider }]}>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.filterRow}
      >
        {builtins.map((f) => (
          <FilterChip
            key={f.id}
            label={f.label}
            active={active === f.id}
            onPress={() => onSelect(f.id)}
          />
        ))}
        {custom.map((f) => (
          <FilterChip
            key={f.id}
            label={f.name}
            active={active === f.id}
            onPress={() => onSelect(f.id)}
            onLongPress={() => onDeleteRequest(f)}
          />
        ))}
        <Pressable
          onPress={onCreate}
          style={({ pressed }) => [
            styles.addChip,
            { backgroundColor: colors.surfaceMuted, borderColor: colors.border },
            pressed && { opacity: 0.7 },
          ]}
          accessibilityRole="button"
          accessibilityLabel={t('chats.filter_create_title')}
        >
          <Ionicons name="add" size={18} color={colors.textSecondary} />
        </Pressable>
      </ScrollView>
    </View>
  );
}

function FilterChip({
  label,
  active,
  onPress,
  onLongPress,
}: {
  label: string;
  active: boolean;
  onPress: () => void;
  onLongPress?: () => void;
}) {
  const { colors } = useTheme();
  return (
    <Pressable
      onPress={onPress}
      onLongPress={onLongPress}
      delayLongPress={320}
      style={({ pressed }) => [
        styles.chip,
        active
          ? { backgroundColor: colors.primary, borderColor: colors.primary }
          : { backgroundColor: colors.surfaceMuted, borderColor: colors.border },
        pressed && { opacity: 0.8 },
      ]}
      accessibilityRole="button"
      accessibilityState={{ selected: active }}
    >
      <Text
        style={[styles.chipText, { color: active ? colors.onPrimary : colors.textSecondary }]}
        numberOfLines={1}
      >
        {label}
      </Text>
    </Pressable>
  );
}

// ── Create-filter sheet ───────────────────────────────────────────────────────
function CreateFilterSheet({
  visible,
  chats,
  onClose,
  onSave,
}: {
  visible: boolean;
  chats: ChatDTO[];
  onClose: () => void;
  onSave: (name: string, chatIds: string[]) => void;
}) {
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const [name, setName] = useState('');
  const [selected, setSelected] = useState<Set<string>>(new Set());

  useEffect(() => {
    if (visible) {
      setName('');
      setSelected(new Set());
    }
  }, [visible]);

  const toggle = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const canSave = name.trim().length > 0 && selected.size > 0;

  return (
    <Modal transparent animationType="slide" visible={visible} onRequestClose={onClose}>
      <View style={styles.sheetOverlay}>
        <Pressable style={StyleSheet.absoluteFill} onPress={onClose} />
        <KeyboardAvoidingView behavior="padding">
          <View style={[styles.sheet, { backgroundColor: colors.surfaceElevated }]}>
            <View style={styles.sheetHandle}>
              <View style={[styles.sheetHandleBar, { backgroundColor: colors.border }]} />
            </View>

            <View style={styles.sheetHeader}>
              <Text style={[styles.sheetTitle, { color: colors.text }]}>
                {t('chats.filter_create_title')}
              </Text>
              <Pressable onPress={onClose} hitSlop={12}>
                <Ionicons name="close" size={22} color={colors.text} />
              </Pressable>
            </View>

            <TextInput
              value={name}
              onChangeText={setName}
              placeholder={t('chats.filter_name_placeholder')}
              placeholderTextColor={colors.textMuted}
              style={[
                styles.nameInput,
                { backgroundColor: colors.surfaceMuted, color: colors.text, borderColor: colors.border },
              ]}
              maxLength={24}
            />

            <Text style={[styles.selectLabel, { color: colors.textSecondary }]}>
              {t('chats.filter_select_chats')}
            </Text>

            <ScrollView style={styles.chatSelectScroll} showsVerticalScrollIndicator={false}>
              {chats.map((chat) => {
                const on = selected.has(chat.id);
                return (
                  <Pressable
                    key={chat.id}
                    onPress={() => toggle(chat.id)}
                    style={({ pressed }) => [styles.selectRow, pressed && { backgroundColor: colors.surfaceMuted }]}
                  >
                    <View style={[styles.selectAvatar, { backgroundColor: colors.surfaceMuted }]}>
                      <Ionicons name="person" size={20} color={colors.textMuted} />
                    </View>
                    <Text style={[styles.selectName, { color: colors.text }]} numberOfLines={1}>
                      {chat.title ?? 'Chat'}
                    </Text>
                    <View
                      style={[
                        styles.checkCircle,
                        on
                          ? { backgroundColor: colors.primary, borderColor: colors.primary }
                          : { borderColor: colors.border },
                      ]}
                    >
                      {on ? <Ionicons name="checkmark" size={14} color={colors.onPrimary} /> : null}
                    </View>
                  </Pressable>
                );
              })}
            </ScrollView>

            <Pressable
              onPress={canSave ? () => onSave(name.trim(), [...selected]) : undefined}
              style={({ pressed }) => [
                styles.saveBtn,
                { backgroundColor: canSave ? colors.primary : colors.surfaceMuted },
                pressed && canSave && { opacity: 0.9 },
                { marginBottom: Math.max(insets.bottom, Spacing.md) },
              ]}
              accessibilityRole="button"
            >
              <Text style={[styles.saveBtnText, { color: canSave ? colors.onPrimary : colors.textMuted }]}>
                {t('chats.filter_save')}
              </Text>
            </Pressable>
          </View>
        </KeyboardAvoidingView>
      </View>
    </Modal>
  );
}

function DeleteFilterModal({
  target,
  onCancel,
  onConfirm,
}: {
  target: CustomFilter | null;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const { colors } = useTheme();
  return (
    <Modal transparent animationType="fade" visible={!!target} onRequestClose={onCancel}>
      <View style={styles.dimOverlay}>
        <Pressable style={StyleSheet.absoluteFill} onPress={onCancel} />
        <View style={[styles.promptCard, { backgroundColor: colors.surface, borderColor: colors.border }]}>
          <View style={[styles.promptIcon, { backgroundColor: colors.surfaceMuted }]}>
            <Ionicons name="trash-outline" size={20} color={colors.danger} />
          </View>
          <Text style={[styles.promptTitle, { color: colors.text }]}>
            {t('chats.filter_delete_title')}
          </Text>
          <Text style={[styles.promptBody, { color: colors.textSecondary }]} numberOfLines={1}>
            {target?.name}
          </Text>
          <View style={styles.promptActions}>
            <Pressable
              onPress={onCancel}
              style={({ pressed }) => [styles.promptBtn, { borderColor: colors.border }, pressed && { opacity: 0.8 }]}
            >
              <Text style={[styles.promptBtnText, { color: colors.text }]}>{t('chats.filter_cancel')}</Text>
            </Pressable>
            <Pressable
              onPress={onConfirm}
              style={({ pressed }) => [
                styles.promptBtn,
                { backgroundColor: colors.danger, borderColor: colors.danger },
                pressed && { opacity: 0.85 },
              ]}
            >
              <Text style={[styles.promptBtnText, { color: '#FFFFFF' }]}>{t('chats.filter_delete')}</Text>
            </Pressable>
          </View>
        </View>
      </View>
    </Modal>
  );
}

function ChatRow({ chat, onManage }: { chat: ChatPreview; onManage: () => void }) {
  const { colors } = useTheme();
  const unread = chat.unreadCount > 0;
  return (
    <Pressable
      onPress={() => router.push(`/chat/${chat.id}`)}
      onLongPress={onManage}
      style={({ pressed }) => [
        styles.row,
        { backgroundColor: colors.background },
        pressed && [styles.rowPressed, { backgroundColor: colors.surfaceMuted }],
      ]}
      accessibilityRole="button"
      accessibilityLabel={t('chats.open_chat', { name: chat.name })}
    >
      <View>
        {/* Falls back to a generated face rather than an empty circle —
            a list of grey circles is a list you cannot read at a glance. */}
        <Avatar
          uri={chat.avatarUri}
          id={chat.peerUserId}
          username={chat.name}
          size={AVATAR}
        />
        {chat.isAI ? (
          <View style={[styles.groupBadge, { backgroundColor: colors.primary, borderColor: colors.background }]}>
            <Ionicons name="sparkles" size={10} color={colors.onPrimary} />
          </View>
        ) : chat.isGroup ? (
          <View style={[styles.groupBadge, { backgroundColor: colors.primary, borderColor: colors.background }]}>
            <Ionicons name="people" size={11} color={colors.onPrimary} />
          </View>
        ) : chat.online ? (
          <View
            style={[
              styles.onlineDot,
              { backgroundColor: colors.success, borderColor: colors.background },
            ]}
          />
        ) : null}
        {chat.isPending ? (
          <View style={[styles.groupBadge, { backgroundColor: colors.warning, borderColor: colors.background }]}>
            <Ionicons name="person-add" size={10} color="#FFFFFF" />
          </View>
        ) : null}
      </View>

      <View style={styles.rowText}>
        <View style={styles.rowTop}>
          <Text
            style={[styles.name, { color: colors.text }, unread && styles.nameUnread]}
            numberOfLines={1}
          >
            {chat.name}
          </Text>
          <Text
            style={[
              styles.time,
              { color: colors.textMuted },
              unread && [styles.timeUnread, { color: colors.primary }],
            ]}
          >
            {chat.timestamp}
          </Text>
        </View>
        <View style={styles.rowBottom}>
          <Text
            style={[
              styles.preview,
              { color: colors.textSecondary },
              unread && [styles.previewUnread, { color: colors.text }],
            ]}
            numberOfLines={1}
          >
            {chat.lastMessage}
          </Text>
          <View style={styles.badges}>
            {chat.pinned ? (
              <Ionicons name="pin" size={14} color={colors.textMuted} />
            ) : null}
            {chat.muted ? (
              <Ionicons name="volume-mute" size={14} color={colors.textMuted} />
            ) : null}
            {unread ? (
              <View style={[styles.unreadBadge, { backgroundColor: colors.primary }]}>
                <Text style={[styles.unreadBadgeText, { color: colors.onPrimary }]}>
                  {chat.unreadCount}
                </Text>
              </View>
            ) : null}
          </View>
        </View>
      </View>
    </Pressable>
  );
}

const AVATAR = 54;
const STORY = 60;

const styles = StyleSheet.create({
  container: { flex: 1 },

  list: { paddingBottom: 96, flexGrow: 1 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.md,
    paddingHorizontal: Spacing.lg,
    paddingVertical: 10,
  },
  rowPressed: {},
  avatar: {
    width: AVATAR,
    height: AVATAR,
    borderRadius: Radii.pill,
  },
  onlineDot: {
    position: 'absolute',
    right: 0,
    bottom: 0,
    width: 14,
    height: 14,
    borderRadius: Radii.pill,
    borderWidth: 2.5,
  },
  groupBadge: {
    position: 'absolute',
    right: -1,
    bottom: -1,
    width: 20,
    height: 20,
    borderRadius: Radii.pill,
    borderWidth: 2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  rowText: { flex: 1, gap: 2 },
  rowTop: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: Spacing.sm,
  },
  name: {
    ...Typography.body,
    fontWeight: '600',
    flex: 1,
  },
  nameUnread: { fontWeight: '700' },
  time: { ...Typography.micro },
  timeUnread: { fontWeight: '700' },
  rowBottom: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: Spacing.sm,
  },
  preview: { ...Typography.caption, flex: 1 },
  previewUnread: { fontWeight: '500' },
  badges: { flexDirection: 'row', alignItems: 'center', gap: Spacing.xs },
  unreadBadge: {
    minWidth: 20,
    height: 20,
    borderRadius: Radii.pill,
    paddingHorizontal: 6,
    alignItems: 'center',
    justifyContent: 'center',
  },
  unreadBadgeText: {
    ...Typography.micro,
    fontWeight: '700',
  },
  manageBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.4)',
    justifyContent: 'flex-end',
  },
  manageSheet: {
    borderTopLeftRadius: Radii.lg,
    borderTopRightRadius: Radii.lg,
    paddingTop: Spacing.md,
  },
  manageTitle: {
    ...Typography.caption,
    paddingHorizontal: Spacing.lg,
    paddingBottom: Spacing.sm,
    opacity: 0.6,
  },
  manageRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.md,
    paddingHorizontal: Spacing.lg,
    paddingVertical: Spacing.md,
  },
  manageLabel: {
    ...Typography.body,
  },
  archivedRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.md,
    paddingHorizontal: Spacing.lg,
    paddingVertical: Spacing.md,
  },
  archivedLabel: { ...Typography.body, flex: 1 },
  archivedCount: { ...Typography.bodyStrong },
  anonBadge: {
    minWidth: 22,
    height: 22,
    borderRadius: Radii.pill,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 6,
  },
  anonBadgeText: { ...Typography.caption, fontWeight: '700' },
  separator: {
    height: 1,
    marginLeft: Spacing.lg + AVATAR + Spacing.md,
  },

  // ── Filter chips ─────────────────────────────────────────────────────────────
  filterWrap: {
    borderBottomWidth: 1,
  },
  filterRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
    paddingHorizontal: Spacing.lg,
    paddingVertical: Spacing.sm + 2,
  },
  chip: {
    paddingHorizontal: Spacing.md,
    paddingVertical: 7,
    borderRadius: Radii.pill,
    borderWidth: 1,
  },
  chipText: {
    ...Typography.caption,
    fontWeight: '700',
    maxWidth: 130,
  },
  addChip: {
    width: 34,
    height: 34,
    borderRadius: Radii.pill,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },

  // ── Create-filter sheet ──────────────────────────────────────────────────────
  sheetOverlay: {
    flex: 1,
    justifyContent: 'flex-end',
    backgroundColor: 'rgba(0,0,0,0.5)',
  },
  sheet: {
    borderTopLeftRadius: Radii.xl,
    borderTopRightRadius: Radii.xl,
    paddingHorizontal: Spacing.lg,
  },
  sheetHandle: {
    alignItems: 'center',
    paddingTop: Spacing.sm,
    paddingBottom: Spacing.xs,
  },
  sheetHandleBar: {
    width: 36,
    height: 4,
    borderRadius: Radii.pill,
  },
  sheetHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: Spacing.sm,
  },
  sheetTitle: { ...Typography.h3 },
  nameInput: {
    ...Typography.body,
    fontSize: 15,
    borderWidth: 1,
    borderRadius: Radii.md,
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm + 2,
    marginTop: Spacing.xs,
  },
  selectLabel: {
    ...Typography.micro,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginTop: Spacing.lg,
    marginBottom: Spacing.xs,
  },
  chatSelectScroll: {
    maxHeight: 300,
  },
  selectRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.md,
    paddingVertical: Spacing.sm,
    paddingHorizontal: Spacing.xs,
    borderRadius: Radii.md,
  },
  selectAvatar: {
    width: 40,
    height: 40,
    borderRadius: Radii.pill,
  },
  selectName: {
    ...Typography.body,
    fontSize: 15,
    flex: 1,
  },
  checkCircle: {
    width: 24,
    height: 24,
    borderRadius: Radii.pill,
    borderWidth: 1.5,
    alignItems: 'center',
    justifyContent: 'center',
  },
  saveBtn: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: Spacing.md,
    borderRadius: Radii.pill,
    marginTop: Spacing.md,
  },
  saveBtnText: {
    ...Typography.body,
    fontWeight: '700',
  },

  // ── Delete confirm ───────────────────────────────────────────────────────────
  dimOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.45)',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: Spacing.xl,
  },
  promptCard: {
    borderRadius: Radii.xl,
    borderWidth: 1,
    padding: Spacing.lg,
    alignItems: 'center',
    gap: Spacing.sm,
    width: '100%',
  },
  promptIcon: {
    width: 52,
    height: 52,
    borderRadius: Radii.pill,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: Spacing.xs,
  },
  promptTitle: { ...Typography.h3, textAlign: 'center' },
  promptBody: { ...Typography.caption, textAlign: 'center' },
  promptActions: { flexDirection: 'row', gap: Spacing.sm, marginTop: Spacing.sm, width: '100%' },
  promptBtn: {
    flex: 1,
    alignItems: 'center',
    paddingVertical: Spacing.sm + 2,
    borderRadius: Radii.pill,
    borderWidth: 1.5,
  },
  promptBtnText: { ...Typography.caption, fontWeight: '700' },

  fab: {
    position: 'absolute',
    right: Spacing.lg,
    bottom: Spacing.lg,
    width: 56,
    height: 56,
    borderRadius: Radii.pill,
    alignItems: 'center',
    justifyContent: 'center',
    shadowOpacity: 0.35,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 6 },
    elevation: 8,
  },
  fabSmall: {
    position: 'absolute',
    right: Spacing.lg + 8,
    // Clear of the main button, which is 56 tall at Spacing.lg from the edge.
    bottom: Spacing.lg + 68,
    width: 44,
    height: 44,
    borderRadius: Radii.pill,
    borderWidth: StyleSheet.hairlineWidth,
    alignItems: 'center',
    justifyContent: 'center',
    elevation: 4,
  },
  fabPressed: {
    transform: [{ scale: 0.95 }],
  },
});
