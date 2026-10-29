import { Ionicons } from '@expo/vector-icons';
import { Image } from 'expo-image';
import * as ImagePicker from 'expo-image-picker';
import { router, useLocalSearchParams } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useEffect, useMemo, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Switch, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ListPicker } from '@/components/chat/list-picker';
import { PeoplePicker } from '@/components/ui/people-picker';
import { NoteEditor } from '@/components/chat/note-editor';
import { Text } from '@/components/ui/text';
import { Radii, Spacing, Typography } from '@/constants/theme';
import {
  blockChat,
  DISAPPEAR_OPTIONS,
  setDisappearing,
  listMessages,
  createChat,
  reportChat,
  type ChatDTO,
  type ChatPermission,
  type ChatPrivacy,
  type ReportReason,
} from '@/data/api/messages';
import { appAlert, appPrompt } from '@/data/dialog-store';
import {
  addGroupMembers,
  bulkGroupMembers,
  leaveGroup,
  removeGroupMember,
  setGroupMemberRole,
} from '@/data/api/groups';
import { getCurrentUser } from '@/data/auth-store';
import {
  hasLockCode,
  isValidCode,
  setLockCode,
  relockAll,
  verifyLockCode,
} from '@/data/chat-lock';
import {
  forgetChatPrefs,
  setChatPref,
  setChatWallpaper,
  useChatPrefs,
} from '@/data/chat-prefs';
import {
  clearChat,
  refreshChats,
  removeChat,
  setChatPrivacy,
  setChatSettings,
  useChats,
} from '@/data/chat-store';
import {
  ensureKeysPublished,
  getIdentityPublic,
  invalidateGroupEpoch,
  loadSession,
  safetyNumber,
} from '@/data/crypto';
import { getNote } from '@/data/db/notes';
import { useCustomFilters } from '@/data/filter-store';
import { refreshGroup, useGroup } from '@/data/group-store';
import { clearMediaCache, formatBytes, mediaCacheSize } from '@/data/media-cache';
import { mapApiMessage } from '@/data/message-map';
import { type ChatPreview, type Message } from '@/data/mock';
import { block, blockedAmong, refreshBlocks, useBlocked } from '@/data/block-store';
import { persistThemeImage } from '@/data/theme-assets';
import { useTheme } from '@/hooks/use-theme';
import { t } from '@/i18n';

const MAX_MEDIA_PREVIEW = 6;
const DEFAULT_PRIVACY_TYPES = [
  'text', 'image', 'video', 'audio', 'document', 'sticker',
  'location', 'contact', 'poll', 'event', 'reply', 'game',
];

export default function ChatInfoScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { colors, isDark } = useTheme();

  // Single source of truth: the same store the list renders from, so a
  // toggle here is reflected there without either screen refetching.
  const { chats } = useChats();
  const apiChat: ChatDTO | null = useMemo(
    () => chats.find((c) => c.id === id) ?? null,
    [chats, id],
  );

  useEffect(() => {
    if (!chats.length) void refreshChats();
  }, [chats.length]);

  const isGroup = apiChat?.type === 'group';
  const group = useGroup(isGroup ? id : undefined);
  const allBlocked = useBlocked();
  // Recomputed as the roster or the block list changes — someone can be added
  // to the group, or unblocked, while this screen is open.
  const blockedHere = useMemo(
    () => blockedAmong((group?.members ?? []).map((m) => m.id)),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- blockedAmong reads the store
    [group?.members, allBlocked],
  );

  useEffect(() => {
    if (isGroup && id) refreshGroup(id).catch(() => {});
    void refreshBlocks();
  }, [isGroup, id]);

  const chat: ChatPreview | undefined = apiChat
    ? {
          id: apiChat.id,
          name: apiChat.title ?? group?.name ?? 'Chat',
          username: apiChat.peer_username ? `@${apiChat.peer_username.replace(/^@/, '')}` : '',
          avatarUri: apiChat.avatar_url ?? group?.avatarUri ?? '',
          lastMessage: '',
          timestamp: '',
          unreadCount: apiChat.unread_count,
          online: false,
          isGroup: apiChat.type === 'group',
          memberCount: group?.members.length,
        }
    : group
      ? {
          id: group.id,
          name: group.name,
          username: '',
          avatarUri: group.avatarUri,
          lastMessage: '',
          timestamp: '',
          unreadCount: 0,
          online: false,
          isGroup: true,
          memberCount: group.members.length,
        }
      : undefined;

  // Mute and favourite are server-backed per-participant settings; they
  // read straight off the chat so they survive leaving the screen.
  const muted = !!apiChat?.muted_until;
  const favorite = !!apiChat?.pinned_at;
  const currentUserId = getCurrentUser()?.id;
  const isPrivacyAdmin = !!apiChat &&
    (apiChat.created_by === currentUserId || !!group?.members.some(
      (member) => member.id === currentUserId && member.role === 'admin',
    ));

  const applySetting = async (settings: Parameters<typeof setChatSettings>[1]) => {
    if (!id) return;
    try {
      await setChatSettings(id, settings);
    } catch {
      appAlert(t('chats.action_failed_title'), t('chats.action_failed_body'));
    }
  };

  const privacy: ChatPrivacy = {
    forwarding_disabled: apiChat?.privacy?.forwarding_disabled ?? false,
    screenshot_protection_enabled: apiChat?.privacy?.screenshot_protection_enabled ?? false,
    links_require_confirmation: apiChat?.privacy?.links_require_confirmation ?? false,
    who_can_message: apiChat?.privacy?.who_can_message ?? 'everyone',
    who_can_call: apiChat?.privacy?.who_can_call ?? 'everyone',
    allowed_message_types: apiChat?.privacy?.allowed_message_types?.length
      ? apiChat.privacy.allowed_message_types
      : DEFAULT_PRIVACY_TYPES,
  };
  const [advancedPrivacyOpen, setAdvancedPrivacyOpen] = useState(false);
  const applyPrivacy = async (patch: Parameters<typeof setChatPrivacy>[1]) => {
    if (!id || !isPrivacyAdmin) return;
    try {
      await setChatPrivacy(id, patch);
    } catch {
      appAlert(t('chats.action_failed_title'), t('chats.action_failed_body'));
    }
  };

  const togglePrivacyType = (messageType: string, enabled: boolean) => {
    const current = privacy.allowed_message_types?.length
      ? privacy.allowed_message_types
      : DEFAULT_PRIVACY_TYPES;
    const next = enabled
      ? Array.from(new Set([...current, messageType]))
      : current.filter((type) => type !== messageType);
    if (next.length === 0) {
      appAlert(t('chat_info.advanced_privacy'), t('chat_info.privacy_keep_one_type'));
      return;
    }
    void applyPrivacy({ allowed_message_types: next });
  };

  const pickPrivacyPermission = (key: 'who_can_message' | 'who_can_call') => {
    if (!isGroup || !isPrivacyAdmin) return;
    const choices: { value: ChatPermission; label: string }[] = [
      { value: 'everyone', label: t('chat_info.privacy_everyone') },
      { value: 'admins', label: t('chat_info.privacy_admins') },
    ];
    appAlert(
      key === 'who_can_message'
        ? t('chat_info.privacy_who_can_message')
        : t('chat_info.privacy_who_can_call'),
      t('chat_info.privacy_admin_hint'),
      choices.map((choice) => ({
        text: choice.label + (privacy[key] === choice.value ? '  ✓' : ''),
        onPress: () => void applyPrivacy({ [key]: choice.value }),
      })).concat([{ text: t('common.cancel'), onPress: () => {} }]),
    );
  };

  // Device-local prefs: they describe this phone, not the account, so they
  // live in SecureStore instead of syncing to the server.
  const { locked, filesVisible: fileVisible, wallpaper } = useChatPrefs(id);

  const chooseWallpaperPhoto = async () => {
    if (!id) return;
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'],
      quality: 0.85,
      allowsEditing: true,
      aspect: [9, 16],
    });
    if (result.canceled || !result.assets[0]) return;
    const imageUri = await persistThemeImage(result.assets[0].uri);
    setChatWallpaper(id, {
      color: wallpaper?.color,
      imageUri,
      dim: wallpaper?.dim ?? 35,
      blur: wallpaper?.blur ?? false,
      animation: wallpaper?.animation ?? 'none',
    });
  };

  const clearWallpaper = () => {
    if (id) setChatWallpaper(id, undefined);
  };

  const setWallpaperColor = (color: string) => {
    if (!id) return;
    setChatWallpaper(id, {
      color,
      // A solid swatch is a replacement, not a tint over the previous photo.
      imageUri: undefined,
      dim: wallpaper?.dim ?? 35,
      blur: wallpaper?.blur ?? false,
      animation: wallpaper?.animation ?? 'none',
    });
  };

  // Real messages for the media strip and the storage estimate. These used
  // to read the mock MESSAGES fixture, so a real chat showed someone else's
  // media — or nothing at all.
  const [messages, setMessages] = useState<Message[]>([]);
  useEffect(() => {
    if (!id) return;
    let cancelled = false;
    const me = getCurrentUser()?.id;
    listMessages(id, 50)
      .then((list) => {
        if (cancelled || !list) return;
        setMessages([...list].reverse().map((m) => mapApiMessage(m, me)));
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [id]);
  const [safetyDigits, setSafetyDigits] = useState<string | null>(null);
  useEffect(() => {
    if (!apiChat?.peer_user_id) return;
    let cancelled = false;
    (async () => {
      try {
        await ensureKeysPublished();
        const local = await getIdentityPublic();
        if (!local || cancelled) return;
        const session = await loadSession(apiChat.peer_user_id!);
        const digits = safetyNumber(local, session?.peerIdentityPublic);
        if (!cancelled) setSafetyDigits(digits);
      } catch {
        /* keys not ready */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [apiChat?.peer_user_id]);

  // Measured from disk rather than guessed from the message count, which
  // bore no relation to what media was actually cached.
  const [cacheBytes, setCacheBytes] = useState(0);
  useEffect(() => {
    let cancelled = false;
    mediaCacheSize().then((n) => {
      if (!cancelled) setCacheBytes(n);
    });
    return () => {
      cancelled = true;
    };
  }, [id]);

  const confirmClearCache = () =>
    appAlert(t('chat_info.manage_storage'), t('chat_info.clear_cache_confirm'), [
      { text: t('common.cancel'), style: 'cancel' },
      {
        text: t('chat_info.clear_cache'),
        style: 'destructive',
        onPress: () => {
          // Only the local copies. The originals stay on the server until
          // its retention sweep collects them, so nothing is lost for good.
          void clearMediaCache().then(() => setCacheBytes(0));
        },
      },
    ]);

  /**
   * Locking requires a passcode; unlocking requires proving you know it.
   *
   * Both directions matter. Without the first, "locked" is decoration.
   * Without the second, anyone holding the phone just turns the switch off.
   */
  const onToggleLock = (next: boolean) => {
    if (!id) return;
    void (async () => {
      const configured = await hasLockCode();

      if (!next) {
        promptCode(t('chat_info.lock_enter_code'), async (code) => {
          if (!(await verifyLockCode(code))) return false;
          setChatPref(id, 'locked', false);
          return true;
        });
        return;
      }

      // Locking hides the chat immediately, including from this screen.
      //
      // It used to stay revealed for the rest of the session so it would not
      // vanish "from under" whoever just locked it. That was backwards: the
      // one moment a person wants proof the lock works is the moment they
      // turn it on, and a chat still sitting in the list reads as a lock
      // that did nothing.
      const lockAndLeave = () => {
        setChatPref(id, 'locked', true);
        relockAll();
        router.replace('/(tabs)');
      };

      if (!configured) {
        promptCode(t('chat_info.lock_set_code'), async (code) => {
          if (!isValidCode(code)) return false;
          await setLockCode(code);
          lockAndLeave();
          appAlert(t('chat_info.lock_set_title'), t('chat_info.lock_set_body'));
          return true;
        });
        return;
      }

      promptCode(t('chat_info.lock_enter_code'), async (code) => {
        if (!(await verifyLockCode(code))) return false;
        lockAndLeave();
        return true;
      });
    })();
  };

  /**
   * Ask for the code, retrying on a wrong one.
   *
   * Alert.prompt is iOS-only, so this uses the in-app dialog — which also
   * lets the field be a real secure entry rather than plain text.
   */
  const promptCode = (title: string, onSubmit: (code: string) => Promise<boolean>) =>
    appPrompt(title, {
      message: t('chat_info.lock_code_hint'),
      placeholder: t('chat_info.lock_code_placeholder'),
      secure: true,
      keyboard: 'number-pad',
      cancelLabel: t('common.cancel'),
      submitLabel: t('common.confirm'),
      // Returning false keeps the dialog open on a wrong code, so the
      // person is not thrown back to the screen to start again.
      onSubmit,
    });

  const [showLists, setShowLists] = useState(false);
  const [showNote, setShowNote] = useState(false);
  const allLists = useCustomFilters();
  const memberOf = id ? allLists.filter((f) => f.chatIds.includes(id)) : [];

  const [notePreview, setNotePreview] = useState('');
  useEffect(() => {
    if (!id) return;
    let cancelled = false;
    getNote(id)
      .then((n) => {
        if (!cancelled) setNotePreview(firstLine(n?.body ?? ''));
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [id]);

  /**
   * Disappearing messages.
   *
   * Each message's clock starts when it is read, not when it is sent — a
   * timer that runs while someone is asleep can destroy a message they never
   * saw, which is loss rather than privacy. The picker says so, because
   * "24 hours" alone does not tell you from when.
   */
  const [disappearSeconds, setDisappearSeconds] = useState(0);
  useEffect(() => {
    setDisappearSeconds(apiChat?.disappear_seconds ?? 0);
  }, [apiChat?.disappear_seconds]);

  const disappearLabel = (sec: number) =>
    sec === 0 ? t('chat_info.off') : t(`chat_info.disappear_${sec}` as never);

  const pickDisappearing = () => {
    if (!id) return;
    appAlert(
      t('chat_info.disappearing'),
      t('chat_info.disappearing_hint'),
      DISAPPEAR_OPTIONS.map((sec) => ({
        text: disappearLabel(sec) + (sec === disappearSeconds ? '  ✓' : ''),
        onPress: () => {
          const previous = disappearSeconds;
          setDisappearSeconds(sec);
          setDisappearing(id, sec).catch(() => {
            setDisappearSeconds(previous);
            failed();
          });
        },
      })).concat([{ text: t('common.cancel'), onPress: () => {} }]),
    );
  };

  /**
   * Managing a group's people.
   *
   * addGroupMembers, removeGroupMember and setGroupMemberRole all existed in
   * the API layer and none of them was ever called: a group could be created
   * and then never changed.
   */
  const meId = getCurrentUser()?.id;
  const isGroupAdmin =
    isGroup && (group?.members ?? []).some((m) => m.id === meId && m.role === 'admin');
  const [addingMembers, setAddingMembers] = useState(false);
  const [memberQuery, setMemberQuery] = useState('');
  const [showAllMembers, setShowAllMembers] = useState(false);
  const [selectedMembers, setSelectedMembers] = useState<string[]>([]);

  const visibleMembers = useMemo(() => {
    const query = memberQuery.trim().toLowerCase();
    const filtered = (group?.members ?? []).filter(
      (m) => !query || `${m.name} ${m.username}`.toLowerCase().includes(query),
    );
    return showAllMembers || query ? filtered : filtered.slice(0, 8);
  }, [group?.members, memberQuery, showAllMembers]);

  const openMemberChat = (memberId: string) => {
    createChat(memberId)
      .then((result) => router.push(`/chat/${result.chat_id}`))
      .catch(failed);
  };

  const toggleMember = (memberId: string) => {
    setSelectedMembers((current) =>
      current.includes(memberId) ? current.filter((id) => id !== memberId) : [...current, memberId],
    );
  };

  const applyBulkRole = (role: 'admin' | 'moderator' | 'member') => {
    if (!id || selectedMembers.length === 0) return;
    bulkGroupMembers(id, selectedMembers, 'role', role)
      .then(() => {
        setSelectedMembers([]);
        return refreshGroup(id);
      })
      .catch(failed);
  };

  const confirmBulkMembers = () => {
    if (!id || selectedMembers.length === 0) return;
    appAlert(t('chat_info.selected_members', { count: selectedMembers.length }), t('chat_info.bulk_members_hint'), [
      { text: t('chat_info.make_moderator'), onPress: () => applyBulkRole('moderator') },
      { text: t('chat_info.make_admin'), onPress: () => applyBulkRole('admin') },
      {
        text: t('chat_info.remove_member'),
        style: 'destructive',
        onPress: () => appAlert(t('chat_info.remove_member'), t('chat_info.bulk_remove_confirm'), [
          { text: t('common.cancel'), style: 'cancel' },
          {
            text: t('chat_info.remove_member'),
            style: 'destructive',
            onPress: () => {
              bulkGroupMembers(id, selectedMembers, 'remove')
                .then(() => {
                  setSelectedMembers([]);
                  invalidateGroupEpoch(id);
                  return refreshGroup(id);
                })
                .catch(failed);
            },
          },
        ]),
      },
      { text: t('common.cancel'), style: 'cancel' },
    ]);
  };

  const manageMember = (m: { id: string; name: string; role?: string }) => {
    if (!id || !isGroupAdmin || m.id === meId) return;
    const isAdmin = m.role === 'admin';
    appAlert(m.name, t('chat_info.manage_member_hint'), [
      {
        text: isAdmin ? t('chat_info.make_moderator') : t('chat_info.make_admin'),
        onPress: () => {
          setGroupMemberRole(id, m.id, isAdmin ? 'moderator' : 'admin')
            .then(() => refreshGroup(id))
            .catch(failed);
        },
      },
      ...(m.role === 'moderator'
        ? [
            {
              text: t('chat_info.demote_member'),
              onPress: () =>
                setGroupMemberRole(id, m.id, 'member').then(() => refreshGroup(id)).catch(failed),
            },
          ]
        : []),
      {
        text: t('chat_info.remove_member'),
        style: 'destructive',
        onPress: () => {
          removeGroupMember(id, m.id)
            .then(() => {
              // The server has rotated the key epoch. Forgetting the cached
              // one is what makes the removal bite: keep using the old
              // generation and the person just removed can still read every
              // message sent after leaving.
              invalidateGroupEpoch(id);
              return refreshGroup(id);
            })
            .catch(failed);
        },
      },
      { text: t('common.cancel'), style: 'cancel' },
    ]);
  };

  /**
   * Add people, having asked how far back they may read.
   *
   * Invalidating the key epoch matters here too: joining rotates the group's
   * sender keys, so the keys the new member receives only open messages from
   * now on — the encryption and the visibility rule agree.
   */
  const addMembersWith = async (userIds: string[], shareHistory: boolean) => {
    if (!id || userIds.length === 0) return;
    try {
      await addGroupMembers(id, userIds, shareHistory);
      invalidateGroupEpoch(id);
      await refreshGroup(id);
    } catch {
      appAlert(t('chats.action_failed_title'), t('chats.action_failed_body'));
    }
  };

  const failed = () =>
    appAlert(t('chats.action_failed_title'), t('chats.action_failed_body'));

  const confirmBlock = () =>
    appAlert(t('chat_info.block', { name: chat?.name ?? '' }), t('chat_info.block_confirm'), [
      { text: t('common.cancel'), style: 'cancel' },
      {
        text: t('chat_info.block_confirm_action'),
        style: 'destructive',
        onPress: () => {
          if (!id) return;
          // The person, not the conversation. Blocking used to set a status on
          // the chat, which stopped you writing to them as well and could
          // never be undone.
          const peer = apiChat?.peer_user_id;
          (peer ? block(peer) : blockChat(id))
            .then(() => {
              void refreshChats();
              router.back();
            })
            .catch(failed);
        },
      },
    ]);

  const confirmReport = () =>
    appAlert(t('chat_info.report', { name: chat?.name ?? '' }), t('chat_info.report_reason'), [
      { text: t('common.cancel'), style: 'cancel' },
      { text: t('chat_info.report_spam'), onPress: () => submitReport('spam') },
      { text: t('chat_info.report_abuse'), onPress: () => submitReport('abuse') },
      { text: t('chat_info.report_scam'), onPress: () => submitReport('scam') },
    ]);

  // Reporting blocks as well. Leaving the conversation open to someone you
  // just reported is the outcome the report was meant to end.
  const submitReport = (reason: ReportReason) => {
    if (!id) return;
    reportChat(id, reason, { block: true })
      .then(() => {
        void refreshChats();
        appAlert(t('chat_info.report_sent'), t('chat_info.report_sent_body'));
        router.back();
      })
      .catch(failed);
  };

  const confirmLeaveGroup = () =>
    appAlert(t('chat_info.leave_group'), t('chat_info.leave_group_confirm'), [
      { text: t('common.cancel'), style: 'cancel' },
      {
        text: t('chat_info.leave_group'),
        style: 'destructive',
        onPress: () => {
          if (!id) return;
          leaveGroup(id)
            .then(() => {
              void refreshChats();
              router.replace('/(tabs)');
            })
            .catch(failed);
        },
      },
    ]);

  const showSafetyNumber = () => {
    if (!safetyDigits) {
      appAlert(t('chat_info.encryption_title'), t('chat_info.encryption_hint'));
      return;
    }
    appAlert(t('chat_info.encryption_title'), safetyDigits);
  };

  if (!chat) {
    return (
      <SafeAreaView style={[styles.safe, { backgroundColor: colors.background }]}>
        <Text style={[styles.fallback, { color: colors.text }]}>{t('chat.not_found')}</Text>
      </SafeAreaView>
    );
  }

  const memberCount = group?.members.length ?? chat.memberCount ?? 0;
  const mediaItems = (fileVisible ? messages : [])
    .filter((m) => m.media?.uri || m.attachment?.kind === 'sticker')
    .slice(-MAX_MEDIA_PREVIEW)
    .reverse();
  // Groups the caller is actually in, from the same store the list uses.
  const commonGroups = !isGroup
    ? chats
        .filter((c) => c.type === 'group')
        .slice(0, 3)
        .map((c) => ({
          id: c.id,
          name: c.title ?? 'Group',
          avatarUri: c.avatar_url ?? '',
          memberCount: undefined as number | undefined,
        }))
    : [];

  return (
    <SafeAreaView
      style={[styles.safe, { backgroundColor: colors.background }]}
      edges={['top', 'bottom']}
    >
      <StatusBar style={isDark ? 'light' : 'dark'} />

      {/* Header */}
      <View style={styles.header}>
        <Pressable
          onPress={() => router.back()}
          hitSlop={12}
          style={({ pressed }) => [
            styles.iconBtn,
            pressed && { backgroundColor: colors.surfaceMuted },
          ]}
        >
          <Ionicons name="chevron-back" size={24} color={colors.text} />
        </Pressable>
        <View style={{ flex: 1 }} />
        <Pressable hitSlop={12} style={styles.iconBtn}>
          <Ionicons name="ellipsis-vertical" size={20} color={colors.text} />
        </Pressable>
      </View>

      <ScrollView
        contentContainerStyle={styles.body}
        showsVerticalScrollIndicator={false}
      >
        {/* Identity */}
        <View style={styles.identity}>
          <Image
            source={{ uri: chat.avatarUri }}
            style={[styles.avatar, { backgroundColor: colors.surfaceMuted }]}
            contentFit="cover"
          />
          <View style={styles.identityNameRow}>
            <Text style={[styles.name, { color: colors.text }]} numberOfLines={1}>
              {chat.name}
            </Text>
          </View>
          <Text style={[styles.subtitle, { color: colors.textSecondary }]} numberOfLines={1}>
            {isGroup
              ? t('chat_info.group_subtitle', { count: memberCount })
              : chat.username}
          </Text>
        </View>

        {/* Action buttons */}
        <View style={styles.actions}>
          <ActionButton
            icon="chatbox-outline"
            label={t('chat_info.message')}
            onPress={() => router.replace(`/chat/${chat.id}`)}
          />
          <ActionButton
            icon="home"
            label={t('hangout.open_short')}
            onPress={() => router.push(`/call/${chat.id}?mode=voice`)}
          />
          {!isGroup ? (
            <>
              <ActionButton
                icon="call-outline"
                label={t('call.voice_call')}
                onPress={() => router.push(`/call/${chat.id}?mode=voice`)}
              />
              <ActionButton
                icon="videocam-outline"
                label={t('call.video_call')}
                onPress={() => router.push(`/call/${chat.id}?mode=video`)}
              />
            </>
          ) : (
            <>
              <ActionButton
                icon="videocam-outline"
                label={t('call.video_call')}
                onPress={() => router.push(`/call/${chat.id}?mode=video`)}
              />
            </>
          )}
        </View>

        {/* Houseparty-style hangout entry */}
        <Section colors={colors}>
          {/* The room was a picture of a room: a grid filled from bundled
              sample chats, a 900ms fake connect, and mute/camera buttons that
              toggled a colour. This is the call screen, which carries audio. */}
          <Row
            icon="home-outline"
            label={t('hangout.open')}
            subtitle={t('hangout.open_hint')}
            colors={colors}
            onPress={() => router.push(`/call/${chat.id}?mode=voice`)}
          />
          <Divider colors={colors} />
          <Row
            icon="game-controller-outline"
            label={t('hangout.games')}
            subtitle={t('hangout.games_hint')}
            colors={colors}
            onPress={() => router.push(`/chat/${chat.id}?game=1`)}
          />
          <Divider colors={colors} />
          <Row
            icon="radio-outline"
            label={t('hangout.mode_live')}
            subtitle={t('hangout.live_hint')}
            colors={colors}
            onPress={() => router.push(`/live/new?chat=${chat.id}`)}
          />
        </Section>

        {/* 1:1 add to lists / notes */}
        {!isGroup ? (
          <Section colors={colors}>
            <Row
              icon="list-outline"
              label={t('chat_info.add_to_lists')}
              subtitle={
                memberOf.length > 0
                  ? memberOf.map((f) => f.name).join(' · ')
                  : t('lists.none_yet')
              }
              colors={colors}
              onPress={() => setShowLists(true)}
            />
            <Divider colors={colors} />
            <Row
              icon="reader-outline"
              label={t('chat_info.add_notes')}
              // The first line of the note, so the row says what is in there
              // instead of making the user open it to find out.
              subtitle={notePreview || t('notes.none_yet')}
              colors={colors}
              onPress={() => setShowNote(true)}
            />
          </Section>
        ) : null}

        {/* Media preview */}
        <Pressable
          onPress={() => id && router.push(`/chat-media/${id}`)}
          style={styles.sectionTitleRow}
          accessibilityRole="button"
        >
          <SectionTitle colors={colors}>{t('chat_info.files_links_documents')}</SectionTitle>
          <Ionicons name="chevron-forward" size={16} color={colors.textSecondary} />
        </Pressable>
        <View style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.border }]}>
          {mediaItems.length > 0 ? (
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.mediaRow}>
              {mediaItems.map((m) => (
                <MediaTile key={m.id} msg={m} colors={colors} />
              ))}
            </ScrollView>
          ) : (
            <Text style={[styles.emptyText, { color: colors.textSecondary }]}>
              {t('chat_info.no_files')}
            </Text>
          )}
        </View>

        <Section colors={colors}>
          <Row
            icon="folder-outline"
            label={t('chat_info.manage_storage')}
            subtitle={formatBytes(cacheBytes)}
            colors={colors}
            onPress={confirmClearCache}
          />
          <Divider colors={colors} />
          <RowToggle
            icon="notifications-outline"
            label={t('chat_info.notifications')}
            value={!muted}
            onValueChange={(v) => void applySetting({ muted: !v })}
            colors={colors}
          />
          <Divider colors={colors} />
          <RowToggle
            icon="images-outline"
            label={t('chat_info.file_visibility')}
            value={fileVisible}
            onValueChange={(v) => id && setChatPref(id, 'filesVisible', v)}
            colors={colors}
          />
          <Divider colors={colors} />
          <Row
            icon="color-palette-outline"
            label={t('themes.wallpaper')}
            subtitle={wallpaper?.imageUri ? t('themes.change_photo') : t('themes.wallpaper_photo')}
            colors={colors}
            onPress={chooseWallpaperPhoto}
          />
          <View style={styles.wallpaperControls}>
            {['#EEF1F6', '#E8F5E9', '#FFF3E0', '#E3F2FD', '#0E0F13', '#12141C'].map((color) => (
              <Pressable
                key={color}
                accessibilityLabel={color}
                onPress={() => setWallpaperColor(color)}
                style={[styles.wallpaperSwatch, { backgroundColor: color, borderColor: colors.border }]}
              />
            ))}
            {wallpaper ? (
              <Pressable onPress={clearWallpaper} hitSlop={8}>
                <Text style={[styles.wallpaperReset, { color: colors.danger }]}>
                  {t('themes.remove_photo')}
                </Text>
              </Pressable>
            ) : null}
          </View>
        </Section>

        {/* Encryption */}
        <Section colors={colors}>
          <Row
            icon="lock-closed-outline"
            label={t('chat_info.encryption_title')}
            subtitle={
              safetyDigits ? safetyDigits.slice(0, 24) + '…' : t('chat_info.encryption_hint')
            }
            colors={colors}
            onPress={showSafetyNumber}
          />
          <Divider colors={colors} />
          <Row
            icon="timer-outline"
            label={t('chat_info.disappearing')}
            value={disappearLabel(disappearSeconds)}
            colors={colors}
            onPress={pickDisappearing}
          />
          <Divider colors={colors} />
          <RowToggle
            icon="lock-closed"
            label={t('chat_info.lock_chat')}
            subtitle={t('chat_info.lock_chat_hint')}
            value={locked}
            onValueChange={onToggleLock}
            colors={colors}
          />
          <Divider colors={colors} />
          <Row
            icon="shield-checkmark-outline"
            label={t('chat_info.advanced_privacy')}
            value={advancedPrivacyOpen ? t('chat_info.on') : t('chat_info.off')}
            subtitle={
              isPrivacyAdmin
                ? t('chat_info.privacy_control_hint')
                : t('chat_info.privacy_read_only_hint')
            }
            colors={colors}
            onPress={() => setAdvancedPrivacyOpen((open) => !open)}
          />
          {advancedPrivacyOpen ? (
            <View style={{ backgroundColor: colors.surfaceMuted }}>
              <RowToggle
                icon="arrow-redo-outline"
                label={t('chat_info.privacy_forwarding')}
                subtitle={t('chat_info.privacy_forwarding_hint')}
                value={!privacy.forwarding_disabled}
                onValueChange={(enabled) => void applyPrivacy({ forwarding_disabled: !enabled })}
                colors={colors}
              />
              <Divider colors={colors} />
              <RowToggle
                icon="phone-portrait-outline"
                label={t('chat_info.privacy_screenshot')}
                subtitle={t('chat_info.privacy_screenshot_hint')}
                value={privacy.screenshot_protection_enabled}
                onValueChange={(enabled) => void applyPrivacy({ screenshot_protection_enabled: enabled })}
                colors={colors}
              />
              <Divider colors={colors} />
              <RowToggle
                icon="link-outline"
                label={t('chat_info.privacy_links')}
                subtitle={t('chat_info.privacy_links_hint')}
                value={privacy.links_require_confirmation}
                onValueChange={(enabled) => void applyPrivacy({ links_require_confirmation: enabled })}
                colors={colors}
              />
              {isGroup ? (
                <>
                  <Divider colors={colors} />
                  <Row
                    icon="chatbubble-ellipses-outline"
                    label={t('chat_info.privacy_who_can_message')}
                    value={privacyPermissionLabel(privacy.who_can_message)}
                    colors={colors}
                    onPress={() => pickPrivacyPermission('who_can_message')}
                  />
                  <Divider colors={colors} />
                  <Row
                    icon="call-outline"
                    label={t('chat_info.privacy_who_can_call')}
                    value={privacyPermissionLabel(privacy.who_can_call)}
                    colors={colors}
                    onPress={() => pickPrivacyPermission('who_can_call')}
                  />
                </>
              ) : null}
              <Divider colors={colors} />
              <Text style={[styles.privacyTypesTitle, { color: colors.textSecondary }]}>
                {t('chat_info.privacy_message_types')}
              </Text>
              {DEFAULT_PRIVACY_TYPES.map((messageType, index) => (
                <View key={messageType}>
                  {index > 0 ? <Divider colors={colors} /> : null}
                  <RowToggle
                    icon="ellipse-outline"
                    label={privacyMessageTypeLabel(messageType)}
                    value={privacy.allowed_message_types.includes(messageType)}
                    onValueChange={(enabled) => togglePrivacyType(messageType, enabled)}
                    colors={colors}
                  />
                </View>
              ))}
            </View>
          ) : null}
        </Section>

        {/* 1:1 — common groups */}
        {!isGroup && commonGroups.length > 0 ? (
          <>
            <SectionTitle colors={colors}>
              {t('chat_info.common_groups_count', { count: commonGroups.length })}
            </SectionTitle>
            <Section colors={colors}>
              <Row
                icon="people-circle-outline"
                label={t('chat_info.create_group_with', { name: chat.name })}
                colors={colors}
              />
              <Divider colors={colors} />
              <Row
                icon="people-outline"
                label={t('chat_info.add_to_groups')}
                subtitle={t('chat_info.add_to_groups_hint')}
                colors={colors}
              />
              {commonGroups.map((g) => (
                <View key={g.id}>
                  <Divider colors={colors} />
                  <Pressable
                    onPress={() => router.push(`/chat/${g.id}`)}
                    style={({ pressed }) => [
                      styles.row,
                      pressed && { backgroundColor: colors.surfaceMuted },
                    ]}
                  >
                    <Image
                      source={{ uri: g.avatarUri }}
                      style={[styles.rowAvatar, { backgroundColor: colors.surfaceMuted }]}
                      contentFit="cover"
                    />
                    <View style={{ flex: 1 }}>
                      <Text style={[styles.rowLabel, { color: colors.text }]} numberOfLines={1}>
                        {g.name}
                      </Text>
                      <Text style={[styles.rowSub, { color: colors.textSecondary }]} numberOfLines={1}>
                        {t('chat_info.members_count', { count: g.memberCount ?? 0 })}
                      </Text>
                    </View>
                  </Pressable>
                </View>
              ))}
            </Section>
          </>
        ) : null}

        {/* Members (groups only) */}
        {isGroup ? (
          <>
            <SectionTitle colors={colors}>
              {t('chat_info.members_count', { count: memberCount })}
            </SectionTitle>
            <Section colors={colors}>
              {/* Only for admins: the server refuses anyone else, and a row
                  that opens onto a refusal is worse than one that is absent. */}
              {isGroupAdmin ? (
                <Row
                  icon="person-add-outline"
                  label={t('chat_info.add_members')}
                  colors={colors}
                  onPress={() => setAddingMembers(true)}
                />
              ) : null}
              {/*
                Someone here is someone you blocked.
                
                A block deliberately does not reach groups — a group is a place
                with other people in it, and one member's decision about
                another is not a reason to end their conversation. Being told
                is what makes allowing it fair.
              */}
              {blockedHere.length > 0 ? (
                <>
                  <Divider colors={colors} />
                  <View style={[styles.row, { gap: Spacing.sm }]}>
                    <Ionicons name="ban-outline" size={18} color={colors.textSecondary} />
                    <Text style={[styles.blockNotice, { color: colors.textSecondary }]}>
                      {blockedHere.length === 1
                        ? t('blocked.in_group_one', {
                            name: blockedHere[0].display_name || blockedHere[0].username,
                          })
                        : t('blocked.in_group_many', { count: blockedHere.length })}
                    </Text>
                  </View>
                </>
              ) : null}
              <TextInput
                value={memberQuery}
                onChangeText={setMemberQuery}
                placeholder={t('chat_info.search_members')}
                placeholderTextColor={colors.textMuted}
                style={[styles.memberSearch, { color: colors.text, borderColor: colors.border }]}
                autoCapitalize="none"
                clearButtonMode="while-editing"
              />
              {isGroupAdmin && selectedMembers.length > 0 ? (
                <Pressable
                  onPress={confirmBulkMembers}
                  style={[styles.bulkAction, { backgroundColor: colors.surfaceMuted }]}
                >
                  <Ionicons name="people-outline" size={17} color={colors.primary} />
                  <Text style={[styles.bulkActionText, { color: colors.primary }]}>
                    {t('chat_info.manage_selected', { count: selectedMembers.length })}
                  </Text>
                </Pressable>
              ) : null}
              {visibleMembers.map((m) => (
                <View key={m.id}>
                  <Divider colors={colors} />
                  <Pressable
                    onPress={() => openMemberChat(m.id)}
                    style={({ pressed }) => [
                      styles.row,
                      pressed && { backgroundColor: colors.surfaceMuted },
                    ]}
                  >
                    {isGroupAdmin && m.id !== meId ? (
                      <Pressable onPress={() => toggleMember(m.id)} hitSlop={8}>
                        <Ionicons
                          name={selectedMembers.includes(m.id) ? 'checkbox' : 'square-outline'}
                          size={20}
                          color={selectedMembers.includes(m.id) ? colors.primary : colors.textMuted}
                        />
                      </Pressable>
                    ) : null}
                    <Image
                      source={{ uri: m.avatarUri }}
                      style={[styles.rowAvatar, { backgroundColor: colors.surfaceMuted }]}
                      contentFit="cover"
                    />
                    <View style={{ flex: 1 }}>
                      <Text style={[styles.rowLabel, { color: colors.text }]} numberOfLines={1}>
                        {m.name}
                      </Text>
                      {m.username ? (
                        <Text style={[styles.rowSub, { color: colors.textSecondary }]} numberOfLines={1}>
                          {m.username}
                        </Text>
                      ) : null}
                    </View>
                    {m.role !== 'member' ? (
                      <View style={[styles.adminPill, { backgroundColor: colors.surfaceMuted }]}>
                        <Text style={[styles.adminPillText, { color: colors.textSecondary }]}>
                          {m.role === 'admin' ? t('chat_info.admin') : t('chat_info.moderator')}
                        </Text>
                      </View>
                    ) : null}
                    {isGroupAdmin && m.id !== meId ? (
                      <Pressable onPress={() => manageMember(m)} hitSlop={8}>
                        <Ionicons name="ellipsis-vertical" size={18} color={colors.textSecondary} />
                      </Pressable>
                    ) : null}
                  </Pressable>
                </View>
              ))}
              {(group?.members ?? []).length > 8 && !memberQuery ? (
                <Pressable onPress={() => setShowAllMembers((v) => !v)} style={styles.expandMembers}>
                  <Text style={[styles.expandMembersText, { color: colors.primary }]}>
                    {showAllMembers ? t('chat_info.show_less') : t('chat_info.show_all_members')}
                  </Text>
                </Pressable>
              ) : null}
            </Section>
          </>
        ) : null}

        {/* Favourites + Clear */}
        <Section colors={colors}>
          <RowToggle
            icon="heart-outline"
            label={t('chat_info.add_to_favorites')}
            value={favorite}
            onValueChange={(v) => void applySetting({ pinned: v })}
            colors={colors}
          />
          <Divider colors={colors} />
          <Row
            icon="archive-outline"
            label={t('chats.archive')}
            colors={colors}
            onPress={() => {
              void applySetting({ archived: true });
              router.back();
            }}
          />
          <Divider colors={colors} />
          <Row
            icon="trash-outline"
            label={t('chat_info.clear_chat')}
            colors={colors}
            destructive
            onPress={() =>
              appAlert(t('chat_info.clear_chat'), t('chat_info.clear_chat_confirm'), [
                { text: t('common.cancel'), style: 'cancel' },
                {
                  text: t('chat_info.clear_chat'),
                  style: 'destructive',
                  onPress: () => {
                    if (!id) return;
                    clearChat(id)
                      .then(() => setMessages([]))
                      .catch(() =>
                        appAlert(t('chats.action_failed_title'), t('chats.action_failed_body')),
                      );
                  },
                },
              ])
            }
          />
        </Section>

        {/* Destructive actions */}
        <Section colors={colors}>
          {isGroup ? (
            <Row
              icon="exit-outline"
              label={t('chat_info.leave_group')}
              colors={colors}
              destructive
              onPress={confirmLeaveGroup}
            />
          ) : (
            <>
              <Row
                icon="ban-outline"
                label={t('chat_info.block', { name: chat.name })}
                colors={colors}
                destructive
                onPress={confirmBlock}
              />
              <Divider colors={colors} />
              <Row
                icon="thumbs-down-outline"
                label={t('chat_info.report', { name: chat.name })}
                colors={colors}
                destructive
                onPress={confirmReport}
              />
            </>
          )}
          <Divider colors={colors} />
          <Row
            icon="trash-bin-outline"
            label={t('chats.delete')}
            colors={colors}
            destructive
            onPress={() =>
              appAlert(t('chats.delete'), t('chat_info.delete_chat_confirm'), [
                { text: t('common.cancel'), style: 'cancel' },
                {
                  text: t('chats.delete'),
                  style: 'destructive',
                  onPress: () => {
                    if (!id) return;
                    removeChat(id)
                      .then(() => {
                        forgetChatPrefs(id);
                        router.replace('/(tabs)');
                      })
                      .catch(() =>
                        appAlert(t('chats.action_failed_title'), t('chats.action_failed_body')),
                      );
                  },
                },
              ])
            }
          />
        </Section>

        <View style={{ height: Spacing.xl }} />
      </ScrollView>

      {id ? (
        <>
          <PeoplePicker
            visible={addingMembers}
            title={t('chat_info.add_members')}
            confirmLabel={t('common.done')}
            excludeIds={(group?.members ?? []).map((m) => m.id)}
            onClose={() => setAddingMembers(false)}
            onConfirm={(people) => {
              if (people.length === 0) return;
              // Asked at the moment of adding: the decision belongs to the
              // person making it. A group-wide switch could be flipped later
              // and retroactively expose a conversation to someone who joined
              // under different terms.
              appAlert(t('chat_info.share_history_title'), t('chat_info.share_history_body'), [
                {
                  text: t('chat_info.share_history_no'),
                  onPress: () => void addMembersWith(people.map((p) => p.id), false),
                },
                {
                  text: t('chat_info.share_history_yes'),
                  onPress: () => void addMembersWith(people.map((p) => p.id), true),
                },
              ]);
            }}
          />
          <ListPicker visible={showLists} chatId={id} onClose={() => setShowLists(false)} />
          <NoteEditor
            visible={showNote}
            chatId={id}
            onClose={(saved) => {
              setShowNote(false);
              setNotePreview(firstLine(saved));
            }}
          />
        </>
      ) : null}

    </SafeAreaView>
  );
}

// ── Small reusable cells ─────────────────────────────────────────────────────

type Colors = ReturnType<typeof useTheme>['colors'];

function ActionButton({
  icon,
  label,
  onPress,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  onPress?: () => void;
}) {
  const { colors } = useTheme();
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [
        styles.actionBtn,
        { backgroundColor: colors.surface, borderColor: colors.border },
        pressed && { opacity: 0.8 },
      ]}
    >
      <Ionicons name={icon} size={20} color={colors.text} />
      <Text style={[styles.actionLabel, { color: colors.text }]} numberOfLines={1}>
        {label}
      </Text>
    </Pressable>
  );
}

function SectionTitle({ children, colors }: { children: React.ReactNode; colors: Colors }) {
  return <Text style={[styles.sectionTitle, { color: colors.textSecondary }]}>{children}</Text>;
}

function Section({ children, colors }: { children: React.ReactNode; colors: Colors }) {
  return (
    <View style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.border }]}>
      {children}
    </View>
  );
}

function Divider({ colors }: { colors: Colors }) {
  return <View style={[styles.divider, { backgroundColor: colors.divider }]} />;
}

function Row({
  icon,
  iconColor,
  label,
  subtitle,
  value,
  destructive,
  colors,
  onPress,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  iconColor?: string;
  label: string;
  subtitle?: string;
  value?: string;
  destructive?: boolean;
  colors: Colors;
  onPress?: () => void;
}) {
  const textColor = destructive ? colors.danger : colors.text;
  const content = (
    <>
      <Ionicons name={icon} size={20} color={iconColor ?? textColor} />
      <View style={styles.rowText}>
        <Text style={[styles.rowLabel, { color: textColor }]}>{label}</Text>
        {subtitle ? (
          <Text style={[styles.rowSub, { color: colors.textSecondary }]} numberOfLines={3}>
            {subtitle}
          </Text>
        ) : null}
      </View>
      {value ? (
        <Text style={[styles.rowValue, { color: colors.textSecondary }]}>{value}</Text>
      ) : onPress ? (
        <Ionicons name="chevron-forward" size={16} color={colors.textMuted} />
      ) : null}
    </>
  );
  if (onPress) {
    return (
      <Pressable onPress={onPress} style={({ pressed }) => [styles.row, pressed && { opacity: 0.7 }]}>
        {content}
      </Pressable>
    );
  }
  return <View style={styles.row}>{content}</View>;
}

function RowToggle({
  icon,
  label,
  subtitle,
  value,
  onValueChange,
  colors,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  subtitle?: string;
  value: boolean;
  onValueChange: (v: boolean) => void;
  colors: Colors;
}) {
  return (
    <View style={styles.row}>
      <Ionicons name={icon} size={20} color={colors.text} />
      <View style={styles.rowText}>
        <Text style={[styles.rowLabel, { color: colors.text }]}>{label}</Text>
        {subtitle ? (
          <Text style={[styles.rowSub, { color: colors.textSecondary }]} numberOfLines={3}>
            {subtitle}
          </Text>
        ) : null}
      </View>
      <Switch
        value={value}
        onValueChange={onValueChange}
        trackColor={{ false: colors.surfaceMuted, true: colors.primary }}
        thumbColor="#FFFFFF"
      />
    </View>
  );
}

function privacyPermissionLabel(permission: ChatPermission): string {
  return permission === 'admins' ? t('chat_info.privacy_admins') : t('chat_info.privacy_everyone');
}

function privacyMessageTypeLabel(messageType: string): string {
  const labels: Record<string, string> = {
    text: t('chat_info.privacy_type_text'),
    image: t('chat_info.privacy_type_image'),
    video: t('chat_info.privacy_type_video'),
    audio: t('chat_info.privacy_type_audio'),
    document: t('chat_info.privacy_type_document'),
    sticker: t('chat_info.privacy_type_sticker'),
    location: t('chat_info.privacy_type_location'),
    contact: t('chat_info.privacy_type_contact'),
    poll: t('chat_info.privacy_type_poll'),
    event: t('chat_info.privacy_type_event'),
    reply: t('chat_info.privacy_type_reply'),
    game: t('chat_info.privacy_type_game'),
  };
  return labels[messageType] ?? messageType;
}

function MediaTile({ msg, colors }: { msg: Message; colors: Colors }) {
  const uri =
    (msg.attachment?.kind === 'sticker' ? msg.attachment.uri : undefined) ?? msg.media?.uri;
  if (!uri) return null;
  return (
    <View style={[styles.mediaTile, { backgroundColor: colors.surfaceMuted }]}>
      <Image source={{ uri }} style={styles.mediaImg} contentFit="cover" />
    </View>
  );
}

// Rough storage estimate from message count — for the demo only.

const styles = StyleSheet.create({
  safe: { flex: 1 },
  fallback: { ...Typography.body, padding: Spacing.xl },

  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: Spacing.sm,
    paddingVertical: Spacing.sm,
    gap: Spacing.xs,
  },
  iconBtn: {
    width: 36,
    height: 36,
    borderRadius: Radii.pill,
    alignItems: 'center',
    justifyContent: 'center',
  },

  body: {
    paddingHorizontal: Spacing.lg,
    paddingBottom: Spacing.xl,
    gap: Spacing.md,
  },

  identity: {
    alignItems: 'center',
    paddingVertical: Spacing.lg,
    gap: 6,
  },
  avatar: { width: 132, height: 132, borderRadius: Radii.pill },
  identityNameRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.xs, marginTop: Spacing.md },
  name: { ...Typography.h2, fontSize: 22, textAlign: 'center' },
  subtitle: { ...Typography.body, textAlign: 'center' },

  actions: {
    flexDirection: 'row',
    gap: Spacing.sm,
  },
  actionBtn: {
    flex: 1,
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingVertical: Spacing.md,
    borderRadius: Radii.lg,
    borderWidth: 1,
  },
  actionLabel: { ...Typography.micro, fontWeight: '700' },

  sectionTitle: {
    ...Typography.micro,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginTop: Spacing.md,
    marginLeft: Spacing.sm,
  },

  sectionTitleRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingRight: Spacing.lg },
  card: {
    borderRadius: Radii.lg,
    borderWidth: 1,
    overflow: 'hidden',
  },
  divider: { height: StyleSheet.hairlineWidth, marginLeft: Spacing.lg + 24 + Spacing.sm },

  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.md,
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm + 4,
    minHeight: 56,
  },
  rowAvatar: { width: 36, height: 36, borderRadius: Radii.pill },
  rowText: { flex: 1, gap: 2 },
  rowLabel: { ...Typography.body, fontSize: 15 },
  rowSub: { ...Typography.caption, lineHeight: 18 },
  rowValue: { ...Typography.caption },

  adminPill: {
    paddingHorizontal: Spacing.sm,
    paddingVertical: 4,
    borderRadius: Radii.pill,
  },
  adminPillText: { ...Typography.micro, fontWeight: '700' },
  memberSearch: {
    margin: Spacing.md,
    paddingHorizontal: Spacing.sm,
    paddingVertical: Spacing.sm,
    borderWidth: 1,
    borderRadius: Radii.md,
    ...Typography.body,
  },
  bulkAction: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
    marginHorizontal: Spacing.md,
    marginBottom: Spacing.sm,
    padding: Spacing.sm,
    borderRadius: Radii.md,
  },
  bulkActionText: { ...Typography.caption, fontWeight: '700' },
  expandMembers: { alignItems: 'center', padding: Spacing.md },
  expandMembersText: { ...Typography.caption, fontWeight: '700' },

  mediaRow: { gap: Spacing.sm, padding: Spacing.sm },
  wallpaperControls: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: Spacing.sm,
    paddingHorizontal: Spacing.md,
    paddingBottom: Spacing.md,
  },
  wallpaperSwatch: { width: 28, height: 28, borderRadius: Radii.pill, borderWidth: 1 },
  wallpaperReset: { ...Typography.caption, fontWeight: '700' },
  mediaTile: {
    width: 92,
    height: 92,
    borderRadius: Radii.md,
    overflow: 'hidden',
  },
  mediaImg: { width: '100%', height: '100%' },
  emptyText: { ...Typography.caption, padding: Spacing.md },
  blockNotice: { ...Typography.caption, flex: 1 },
  privacyTypesTitle: {
    ...Typography.micro,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 0.4,
    paddingHorizontal: Spacing.md,
    paddingTop: Spacing.md,
  },
});

/** First non-empty line, trimmed for a one-line subtitle. */
function firstLine(text: string): string {
  const line = text.split('\n').find((l) => l.trim().length > 0) ?? '';
  return line.trim().slice(0, 60);
}
