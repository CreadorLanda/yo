import { Ionicons } from '@expo/vector-icons';
import {
  RecordingPresets,
  requestRecordingPermissionsAsync,
  setAudioModeAsync,
  useAudioPlayer,
  useAudioPlayerStatus,
  useAudioRecorder,
} from 'expo-audio';
import { BlurView } from 'expo-blur';
import * as Clipboard from 'expo-clipboard';
import * as DocumentPicker from 'expo-document-picker';
import * as Haptics from 'expo-haptics';
import { Image } from 'expo-image';
import * as ImagePicker from 'expo-image-picker';
import { router, useLocalSearchParams } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Dimensions,
  FlatList,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  View,
  type StyleProp,
  type TextStyle,
} from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import { KeyboardAvoidingView } from 'react-native-keyboard-controller';
import Animated, {
  Extrapolation,
  FadeIn,
  interpolate,
  runOnJS,
  type SharedValue,
  useAnimatedStyle,
  useSharedValue,
  withDelay,
  withRepeat,
  withSpring,
  withTiming,
} from 'react-native-reanimated';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';

import { AttachmentBubble } from '@/components/chat/attachment-bubbles';
import { MediaEditor, type EditorAsset, type EditorResult } from '@/components/chat/media-editor';
import { AnimatedWallpaper } from '@/components/chat/animated-wallpaper';
import { GlassSurface } from '@/components/ui/glass-surface';
import { Text, TextInput, type TextInputHandle } from '@/components/ui/text';
import { appAlert } from '@/data/dialog-store';
import { ApiError } from '@/data/api/client';
import { AppIcon } from '@/components/ui/app-icon';
import { CachedImage } from '@/components/ui/cached-image';
import { ForwardPicker } from '@/components/chat/forward-picker';
import { MediaViewer, type ViewerItem } from '@/components/chat/media-viewer';
import { MessageInfoSheet } from '@/components/chat/message-info';
import { formatSpeed, nextSpeed } from '@/components/chat/speed-control';
import { StickerPicker } from '@/components/chat/sticker-picker';
import { AttachmentComposer } from '@/components/chat/attachment-composer';
import {
  GameRoom,
  type GameChatMessage,
  type GamePlayer,
} from '@/components/game/game-room';
import { extractGamePayloads, MAX_ROUNDS, type GameMessagePayload } from '@/data/game';
import { EmptyState } from '@/components/ui/empty-state';
import { StateTransition } from '@/components/ui/state-transition';
import { Radii, Spacing, Typography } from '@/constants/theme';
import { dandaraReply, dandaraSuggestions } from '@/data/dandara';
import { markChatRead, refreshChats, useChats } from '@/data/chat-store';
import type { StickerDTO } from '@/data/api/stickers';
import { noteStickerUsed, refreshStickerPacks, useStickerPacks } from '@/data/sticker-store';
import { removeSticker, saveSticker } from '@/data/api/stickers';
import { showToast } from '@/data/toast-store';
import { refreshGroup, useGroup } from '@/data/group-store';
import {
  encodeMediaContent,
  mediaFileURL,
  uploadEncryptedMedia,
  uploadMedia,
} from '@/data/api/media';
import {
  acceptChat,
  addReaction,
  blockChat,
  connectRealtime,
  deleteMessage as apiDeleteMessage,
  editMessage as apiEditMessage,
  listMessages,
  openLimitedMessage,
  setDisappearing,
  DISAPPEAR_OPTIONS,
  votePoll,
  type PollTally,
  markRead,
  postReceipts,
  removeReaction,
  sendMessage as apiSendMessage,
  setTyping as apiSetTyping,
  type ChatDTO,
  type MessageDTO,
  type RealtimeEvent,
  type ReactionDTO,
} from '@/data/api/messages';
import {
  CHATS,
  DANDARA,
  MESSAGES,
  type ChatPreview,
  type MediaAttachment,
  type Message,
  type MessageAttachment,
} from '@/data/mock';
import {
  collapseReactions,
  decryptMessageContent,
  mapApiMessage,
  STICKER_BUBBLE_SIZE,
  serverMessageId,
} from '@/data/message-map';
import { linkReplies } from '@/data/reply-link';
import { ensureLocal, mediaIdFromURL, useCacheState } from '@/data/media-cache';
import {
  loadCachedMessages,
  markCachedMessageOpened,
  saveCachedMessages,
  trimCachedChat,
} from '@/data/db/messages';
import {
  E2EEUnavailable,
  encryptForGroup,
  encryptForPeerOrFail,
  ensureKeysPublished,
  ensurePeerIdentityCurrent,
  groupEpoch,
  isGroupEnvelope,
  syncGroupKeys,
} from '@/data/crypto';
import { CallRow } from '@/components/chat/call-row';
import { callHistory, type CallLogEntry } from '@/data/api/calls';
import { setOpenChat } from '@/data/notification-builder';
import { describeE2EEBlocked, reportE2EEBlocked } from '@/data/e2ee-blocked';
import { getGroup, type GroupMemberDTO } from '@/data/api/groups';
import { bubbleRadii } from '@/data/theme-store';
import { useTheme } from '@/hooks/use-theme';
import { useCurrentUser } from '@/data/auth-store';
import { handleCallEvent } from '@/data/incoming-call';
import { handleLiveEvent } from '@/data/live-store';
import { t } from '@/i18n';

const CHAT_REACTIONS = ['❤️', '👍', '😂', '😮', '😢', '🙏'];
const REACTION_BAR_HEIGHT = 56;
const MENU_ITEM_HEIGHT = 48;
const MENU_GAP = 10;
const REPLY_THRESHOLD = 56;
const LOCK_THRESHOLD = 78;
const CANCEL_THRESHOLD = 96;
const VOICE_BARS = 26;

/**
 * Message type sent for each rich attachment. The schema has accepted
 * these since the first messages migration; nothing was ever sending them.
 */
const ATTACHMENT_WIRE_TYPE: Record<string, string | undefined> = {
  location: 'location',
  contact: 'contact',
  poll: 'poll',
  event: 'event',
  sticker: 'sticker',
  game: 'game', // truth-or-dare; server schema accepts it (migration 0033)
};

const ATTACH_ITEMS: { key: string; icon: keyof typeof Ionicons.glyphMap; color: string }[] = [
  { key: 'document', icon: 'document-text', color: '#8B5CF6' },
  { key: 'gallery', icon: 'images', color: '#EC4899' },
  { key: 'camera', icon: 'camera', color: '#F43F5E' },
  { key: 'audio', icon: 'musical-notes', color: '#14B8A6' },
  { key: 'make_sticker', icon: 'happy', color: '#F59E0B' },
  { key: 'games', icon: 'game-controller', color: '#0EA5E9' },
  { key: 'dandara', icon: 'sparkles', color: '#A855F7' },
  { key: 'location', icon: 'location', color: '#22C55E' },
  { key: 'contact', icon: 'person', color: '#3B82F6' },
  { key: 'poll', icon: 'stats-chart', color: '#F59E0B' },
  { key: 'event', icon: 'calendar', color: '#EF4444' },
];

/**
 * Turn whatever was thrown into something reportable.
 *
 * Media sends were failing before any network call and the catch blocks
 * discarded the reason, so the only symptom was a bubble that disappeared.
 */
/**
 * Does this body have to be decrypted before it can be mapped?
 *
 * Both call sites tested `startsWith('soc1.')`, which silently excluded group
 * envelopes — they carry the `soc1g.` prefix, so a group message would have
 * been mapped straight from its ciphertext.
 */
function needsDecrypt(content?: string | null): boolean {
  return !!content && (content.startsWith('soc1.') || isGroupEnvelope(content));
}

function describeError(err: unknown): string {
  // Checked first: a refusal to encrypt is the one failure here that the
  // reader can act on, and it would otherwise surface as a bare error name.
  const blocked = describeE2EEBlocked(err);
  if (blocked) return blocked;
  if (err instanceof ApiError) return `${err.code}${err.message ? ` — ${err.message}` : ''}`;
  if (err instanceof Error) return err.message;
  return t('chats.action_failed_body');
}

function formatDuration(totalSec: number): string {
  const safe = Math.max(0, Math.floor(totalSec));
  const m = Math.floor(safe / 60);
  const s = safe % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}

type ReactionEntry = { emoji: string; count: number; mine: boolean };

type GroupedMessage = Message & {
  isFirstInGroup: boolean;
  isLastInGroup: boolean;
};

type MenuTarget = {
  msg: GroupedMessage;
  rect: { x: number; y: number; width: number; height: number };
  mine: boolean;
};

function groupMessages(messages: Message[]): GroupedMessage[] {
  return messages.map((msg, i) => {
    const breaksWith = (other?: Message) =>
      !other ||
      other.system ||
      msg.system ||
      other.fromMe !== msg.fromMe ||
      other.senderName !== msg.senderName;
    return {
      ...msg,
      isFirstInGroup: breaksWith(messages[i - 1]),
      isLastInGroup: breaksWith(messages[i + 1]),
    };
  });
}

function nowTime(): string {
  const now = new Date();
  return `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
}

/**
 * Hops after which a message reads as "forwarded many times".
 *
 * Matches the threshold people already know from other messengers. The exact
 * number is arbitrary; what matters is that there is a point where the label
 * stops being neutral and starts being a warning.
 */
const FORWARD_MANY = 5;

export default function ChatScreen() {
  const { id, game: openGame } = useLocalSearchParams<{ id: string; game?: string }>();
  const { chats: storeChats } = useChats();
  const apiChatInfo: ChatDTO | null = useMemo(
    () => storeChats.find((c) => c.id === id) ?? null,
    [storeChats, id],
  );
  // Undefined while the chat is still unknown — the distinction the load
  // effect depends on. A group has no single peer and must not wait for one
  // that never arrives.
  const chatType = apiChatInfo?.type;

  // Dandara is a local assistant surface, not a server chat — it is the one
  // entry that legitimately comes from the bundled fixtures.
  const isAIChat = id === DANDARA.id;
  const chat = useMemo<ChatPreview | undefined>(() => {
    if (isAIChat) return CHATS.find((c) => c.id === DANDARA.id);
    if (!apiChatInfo) return undefined;
    return {
      id: apiChatInfo.id,
      name: apiChatInfo.title ?? 'Chat',
      username: apiChatInfo.peer_username
        ? `@${apiChatInfo.peer_username.replace(/^@/, '')}`
        : '',
      avatarUri: apiChatInfo.avatar_url ?? '',
      lastMessage: '',
      timestamp: '',
      unreadCount: apiChatInfo.unread_count,
      online: false,
      isGroup: apiChatInfo.type === 'group',
      isPending: apiChatInfo.status === 'pending',
      pinned: !!apiChatInfo.pinned_at,
      muted: !!apiChatInfo.muted_until,
    };
  }, [isAIChat, apiChatInfo]);
  // Only the assistant thread seeds from fixtures; real chats load from the API.
  const [messages, setMessages] = useState<Message[]>(() =>
    id === DANDARA.id ? MESSAGES[DANDARA.id] ?? [] : [],
  );
  const [draft, setDraft] = useState('');
  const [searchMode, setSearchMode] = useState(false);
  const [query, setQuery] = useState('');
  const [reactionsMap, setReactionsMap] = useState<Record<string, ReactionEntry[]>>({});
  const [menuTarget, setMenuTarget] = useState<MenuTarget | null>(null);
  const [replyTarget, setReplyTarget] = useState<Message | null>(null);
  const [showAttach, setShowAttach] = useState(false);
  const [showStickers, setShowStickers] = useState(false);
  const { packs: stickerPacks } = useStickerPacks();
  const [viewerStart, setViewerStart] = useState<number | null>(null);
  const [infoMessageId, setInfoMessageId] = useState<number | null>(null);

  /**
   * Every photo and video in the thread, so the viewer can page through
   * them instead of showing only the one that was tapped.
   */
  const galleryItems = useMemo<ViewerItem[]>(
    () =>
      messages
        .filter((m) => m.media && m.media.type !== 'audio' && !m.deletedAt)
        .map((m) => ({
          id: m.id,
          uri: m.media!.uri,
          type: m.media!.type === 'video' ? 'video' : 'image',
          senderName: m.fromMe ? t('chat.you') : m.senderName || chat?.name,
          timestamp: m.timestamp,
          mediaKey: m.media!.key,
          mime: m.media!.mime,
        })),
    [messages, chat?.name],
  );
  const [editorAsset, setEditorAsset] = useState<EditorAsset | null>(null);
  const [editorMode, setEditorMode] = useState<'send' | 'sticker'>('send');
  /** Kept so the edited file can reuse the original asset's metadata. */
  const [pendingAsset, setPendingAsset] = useState<ImagePicker.ImagePickerAsset | null>(null);
  const [composeKind, setComposeKind] = useState<string | null>(null);
  const [editingMsgId, setEditingMsgId] = useState<string | null>(null);
  const [deleteTargets, setDeleteTargets] = useState<Message[]>([]);
  const [forwardTargets, setForwardTargets] = useState<Message[]>([]);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const selectionMode = selectedIds.size > 0;
  const [dandaraTyping, setDandaraTyping] = useState(false);
  /** Peer typing from realtime backend (non-AI chats). */
  // What the other person is doing, or null. Two states rather than a
  // boolean: holding the mic and typing look identical from here otherwise,
  // and they mean very different things to whoever is waiting.
  const [peerActivity, setPeerActivity] = useState<'typing' | 'recording' | null>(null);
  const peerTyping = peerActivity !== null;
  const peerTypingClearRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const typingSentRef = useRef(false);
  const currentUser = useCurrentUser();
  const meId = currentUser?.id;
  const { colors, isDark, chat: chrome, layout, metrics } = useTheme();

  const audioRecorder = useAudioRecorder(RecordingPresets.HIGH_QUALITY);
  const [recordPhase, setRecordPhase] = useState<'idle' | 'recording' | 'locked'>('idle');
  const [elapsedSec, setElapsedSec] = useState(0);
  const recordStartRef = useRef(0);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const recordPermRef = useRef(false);
  const dandaraTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const listRef = useRef<FlatList<GroupedMessage>>(null);
  // Measured, not assumed — see the header block in the tree below.
  const [headerH, setHeaderH] = useState(0);
  const composerInputRef = useRef<TextInputHandle>(null);
  const dragX = useSharedValue(0);
  const dragY = useSharedValue(0);
  const recOriginX = useSharedValue(0);
  const recOriginY = useSharedValue(0);
  const recActive = useSharedValue(false);
  const recLocked = useSharedValue(false);
  const recCancelled = useSharedValue(false);
  const micScale = useSharedValue(1);
  const micHalo = useSharedValue(0);
  const recExit = useSharedValue(0);

  const micStyle = useAnimatedStyle(() => ({
    transform: [
      { translateX: dragX.value },
      { translateY: dragY.value },
      { scale: micScale.value },
    ],
  }));

  useEffect(() => {
    requestRecordingPermissionsAsync()
      .then((r) => {
        recordPermRef.current = r.granted;
      })
      .catch(() => {});
    setAudioModeAsync({ playsInSilentMode: true }).catch(() => {});
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
      if (dandaraTimerRef.current) clearTimeout(dandaraTimerRef.current);
    };
  }, []);

  // Paint from disk. Separate from the network effect and keyed only on the
  // chat, so it runs once: cached bodies are already decrypted and need
  // nothing the peer would provide.
  useEffect(() => {
    if (!id || !meId) return;
    let cancelled = false;
    loadCachedMessages(id, 50)
      .then((cached) => {
        // Seed only — the network result replaces this wholesale, and
        // overwriting live messages with stale rows would be a regression.
        if (cancelled || cached.length === 0) return;
        // Quotes reconstructed here too: the cache stores the decrypted DTO,
        // which carries reply_to_id but no quoted text.
        setMessages(linkReplies(cached.map((m) => mapApiMessage(m, meId))));
      })
      .catch((err) => {
        // Loud on purpose. Swallowing this is how a completely dead local
        // database looks exactly like a working one that happens to be
        // empty — every read falls through to the network and the only
        // symptom is that nothing is ever faster.
        console.warn('[db] local cache read failed:', err);
      });
    return () => {
      cancelled = true;
    };
  }, [id, meId]);

  // Reconcile with the API.
  useEffect(() => {
    if (!id || !meId) return;
    let cancelled = false;

    // Wait until the chat is known at all, not merely until it is known to
    // be direct. `isDirect` is false while apiChatInfo is still null, so
    // guarding on it alone let the first run through anyway — the exact
    // fetch-without-a-peer this is meant to prevent.
    //
    // Without the peer, our own outbound messages decrypt to nothing and
    // that gets written into the cache; the re-run once it lands refetches
    // and repaints the whole thread, which is the reload being complained
    // about.
    if (!isAIChat) {
      if (!chatType) return;
      if (chatType === 'direct' && !apiChatInfo?.peer_user_id) return;
    }

    listMessages(id, 50)
      .then(async (apiMsgs) => {
        if (cancelled || !apiMsgs || apiMsgs.length === 0) return;
        // API returns newest-first; UI expects chronological (oldest first).
        const ordered = [...apiMsgs].reverse();
        const peerId = apiChatInfo?.peer_user_id;
        // Sequential, not Promise.all. Decryption is not independent per
        // message: the first envelope carrying a handshake is what creates
        // the session the rest need. Run in parallel, every message races
        // that one and loses, so an entire thread comes back undecryptable
        // even though the material to read it was right there.
        const decrypted: { dto: MessageDTO; body: string; msg: Message }[] = [];
        for (const m of ordered) {
          const base = mapApiMessage(m, meId);
          if (base.text === '🔒 …' || needsDecrypt(m.content)) {
            const plain = await decryptMessageContent(m, meId, peerId);
            // Re-map from the decrypted body rather than patching `text`.
            // The cache replays mapApiMessage over exactly this plaintext,
            // so mapping it any other way here would make a reloaded
            // thread render differently from a freshly fetched one — and
            // an encrypted media envelope would surface as raw JSON.
            const plainDTO = { ...m, content: plain };
            decrypted.push({ dto: plainDTO, body: plain, msg: mapApiMessage(plainDTO, meId) });
          } else {
            decrypted.push({ dto: m, body: m.content, msg: base });
          }
        }

        // Reactions come with the history now. Without this the map started
        // empty on every open and only a live websocket event could fill it,
        // which is why a reaction vanished the moment you left the chat.
        setReactionsMap((prev) => {
          const next = { ...prev };
          for (const m of ordered) {
            if (m.reactions?.length) {
              next[String(m.id)] = collapseReactions(m.reactions, meId);
            }
          }
          return next;
        });
        if (cancelled) return;
        const mapped = decrypted.map((d) => d.msg);
        setMessages(linkReplies(mapped));

        // Write through in the background: the screen is already correct, so
        // a slow disk must not hold it up, and a failure here costs only the
        // next open's speed.
        saveCachedMessages(
          id,
          decrypted.map(({ dto, body }) => ({ dto, body })),
        )
          .then(() => trimCachedChat(id))
          .catch(() => {});

        // Ack delivery for inbound, then mark the latest as read.
        const inboundIds = ordered
          .filter((m) => m.sender_id !== meId && !m.deleted_at)
          .map((m) => m.id);
        if (inboundIds.length > 0) {
          postReceipts(id, inboundIds, 'delivered').catch(() => {});
          const last = inboundIds[inboundIds.length - 1];
          markRead(id, last).catch(() => {});
          postReceipts(id, [last], 'read').catch(() => {});
        }
      })
      .catch(() => {
        /* keep mock seed when offline / mock-only chat */
      });
    return () => {
      cancelled = true;
    };
  }, [id, meId, apiChatInfo?.peer_user_id, chatType, isAIChat]);

  // Load chat info from the API + ensure E2EE keys are ready.
  useEffect(() => {
    if (!id) return;
    // Swallowing this hid a total failure: no PRNG meant no keys were ever
    // published and every message silently fell back to plaintext.
    ensureKeysPublished().catch((err) => {
      console.warn('[crypto] key publication failed:', err);
    });
    // The store owns the chat list; opening a chat also clears its badge.
    void refreshChats();
    markChatRead(id);
  }, [id]);

  // Re-key when the peer's identity has changed under us.
  //
  // Encryption against a stale session keeps succeeding locally, so nothing
  // here fails — the peer just sees "missing keys" on every message while
  // this side looks healthy. Checking costs one request and consumes no
  // one-time key, and dropping the session makes the next send re-establish.
  useEffect(() => {
    const peerId = apiChatInfo?.peer_user_id;
    const peerName = apiChatInfo?.peer_username;
    if (!peerId || !peerName) return;
    ensurePeerIdentityCurrent(peerId, peerName).catch(() => {});
  }, [apiChatInfo?.peer_user_id, apiChatInfo?.peer_username]);

  // Realtime WebSocket — message / typing / receipt / reaction fan-out.
  useEffect(() => {
    if (!id || !meId) return;
    let ws: WebSocket | null = null;
    let closed = false;
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null;

    const handleEvent = (ev: RealtimeEvent) => {
        // A call can arrive on any screen; the store decides what to show.
        if (handleCallEvent(ev.type, ev.payload)) return;
        // A broadcast likewise: it starts, ends and changes size on any screen.
        if (handleLiveEvent(ev.type, ev.payload)) return;
      if (ev.chat_id && ev.chat_id !== id) return;
      const payload = ev.payload as Record<string, unknown> | null | undefined;

      if (ev.type === 'message.new' && payload) {
        const dto = payload as unknown as MessageDTO;
        if (String(dto.chat_id) !== id && ev.chat_id !== id) return;
        const peerId = apiChatInfo?.peer_user_id;
        void (async () => {
          // A system message in a group is how a membership change reaches
          // us when someone else made it. The server has already rotated the
          // key epoch; re-syncing here is what stops us carrying on with the
          // generation the departing member still holds.
          if (isGroup && dto.message_type === 'system') {
            syncGroupKeys(id).catch(() => {});
          }
          let mapped = mapApiMessage(dto, meId);
          if (mapped.text === '🔒 …' || needsDecrypt(dto.content)) {
            // Re-mapped from the decrypted body, not patched. Assigning to
            // `text` alone left everything else derived from the envelope, so
            // an encrypted attachment arriving live rendered as a message
            // with no attachment — while the same message rendered correctly
            // after a reload, which is the history path a few lines up.
            const plain = await decryptMessageContent(dto, meId, peerId);
            mapped = mapApiMessage({ ...dto, content: plain }, meId);
          }
          setMessages((prev) => {
            if (prev.some((m) => m.id === mapped.id)) return prev;
            // Drop matching optimistic bubble (temp id) with same text from me.
            if (mapped.fromMe) {
              const withoutOpt = prev.filter(
                (m) => !(m.fromMe && m.id.startsWith('tmp_') && m.text === mapped.text),
              );
              return [...withoutOpt, mapped];
            }
            return [...prev, mapped];
          });
          if (!mapped.fromMe && !mapped.deletedAt) {
            const mid = Number(mapped.id);
            if (Number.isFinite(mid)) {
              postReceipts(id, [mid], 'delivered').catch(() => {});
              markRead(id, mid).catch(() => {});
              postReceipts(id, [mid], 'read').catch(() => {});
            }
          }
        })();
        return;
      }

      if (ev.type === 'message.edited' && payload) {
        const dto = payload as unknown as MessageDTO;
        const mapped = mapApiMessage(dto, meId);
        setMessages((prev) => prev.map((m) => (m.id === mapped.id ? { ...m, ...mapped } : m)));
        return;
      }

      if (ev.type === 'message.deleted' && payload) {
        const dto = payload as unknown as MessageDTO;
        const mid = String(dto.id);
        setMessages((prev) =>
          prev.map((m) =>
            m.id === mid
              ? { ...m, deletedAt: dto.deleted_at ?? new Date().toISOString(), text: '' }
              : m,
          ),
        );
        return;
      }

      // Delivery ticks used to need a reopen — the server published these
      // all along, the chat just never listened.
      if (ev.type === 'receipt' && payload) {
        const r = payload as { message_id?: number; status?: string };
        if (r.message_id && r.status) {
          setMessages((prev) =>
            prev.map((m) =>
              m.id === String(r.message_id)
                ? { ...m, status: r.status === 'read' ? 'read' : 'delivered' }
                : m,
            ),
          );
        }
        return;
      }

      if (ev.type === 'message.reaction' && payload) {
        const r = payload as { message_id?: number; reactions?: ReactionDTO[] };
        if (r.message_id) {
          setReactionsMap((prev) => ({
            ...prev,
            [String(r.message_id)]: collapseReactions(r.reactions ?? [], meId),
          }));
        }
        return;
      }

      if (ev.type === 'typing' && payload) {
        const uid = String(payload.user_id ?? '');
        if (uid && uid === meId) return;
        const typing = !!payload.typing;
        const kind = payload.kind === 'recording' ? 'recording' : 'typing';
        setPeerActivity(typing ? kind : null);
        if (peerTypingClearRef.current) clearTimeout(peerTypingClearRef.current);
        if (typing) {
          // Clears itself. An indicator stuck because someone closed the app
          // mid-word is worse than none — it says "they are still there" when
          // they are not. Recording gets longer: a voice note takes a while,
          // and a bar that vanishes mid-recording reads as them giving up.
          peerTypingClearRef.current = setTimeout(
            () => setPeerActivity(null),
            kind === 'recording' ? 12000 : 4000,
          );
        }
        return;
      }

      if (ev.type === 'receipt' && payload) {
        const mid = String(payload.message_id ?? '');
        const status = payload.status === 'read' ? 'read' : 'delivered';
        if (!mid) return;
        setMessages((prev) =>
          prev.map((m) => {
            if (m.id !== mid || !m.fromMe) return m;
            // Don't downgrade read → delivered.
            if (m.status === 'read') return m;
            return { ...m, status };
          }),
        );
        return;
      }

      if (ev.type === 'message.reaction' && payload) {
        const mid = String(payload.message_id ?? '');
        const reactions = payload.reactions as
          | { message_id: number; user_id: string; emoji: string; created_at: string }[]
          | undefined;
        if (!mid || !reactions) return;
        setReactionsMap((prev) => ({
          ...prev,
          [mid]: collapseReactions(reactions, meId),
        }));
      }
    };

    const connect = () => {
      connectRealtime(handleEvent, () => {
        if (closed) return;
        reconnectTimer = setTimeout(connect, 2500);
      }).then((sock) => {
        if (closed) {
          sock?.close();
          return;
        }
        ws = sock;
      });
    };
    connect();

    return () => {
      closed = true;
      if (reconnectTimer) clearTimeout(reconnectTimer);
      if (peerTypingClearRef.current) clearTimeout(peerTypingClearRef.current);
      ws?.close();
      // Stop typing on leave.
      apiSetTyping(id, false).catch(() => {});
    };
  }, [id, meId]);

  // Keep the latest message (and typing bubble) in view.
  useEffect(() => {
    if (searchMode) return;
    const tId = setTimeout(() => listRef.current?.scrollToEnd({ animated: true }), 80);
    return () => clearTimeout(tId);
  }, [messages.length, dandaraTyping, peerTyping, searchMode]);

  const isGroup = !!chat?.isGroup || apiChatInfo?.type === 'group';
  // Tell the notification builder which conversation is on screen, so it stays
  // quiet about this one. The server pushes to connected clients now; only the
  // client knows what the reader is actually looking at.
  useEffect(() => {
    setOpenChat(id ?? null);
    return () => setOpenChat(null);
  }, [id]);

  useEffect(() => {
    if (!isGroup || !id) return;
    refreshGroup(id).catch(() => {});
    // Pull the sender keys other members sealed for us, and the current
    // epoch, before anything needs them. The decrypt path can fetch on
    // demand, but doing it here means the first message of a session opens
    // immediately instead of after a round trip.
    syncGroupKeys(id).catch(() => {});
  }, [isGroup, id]);
  const isPending = apiChatInfo?.status === 'pending';
  const isBlocked = apiChatInfo?.status === 'blocked';
  const iSentRequest = isPending && apiChatInfo?.created_by === currentUser?.id;
  // Requester may send one intro message while pending; recipient only accept/block.
  const hasMyIntro = messages.some((m) => m.fromMe);
  const canCompose =
    !isBlocked && (!isPending || (iSentRequest && !hasMyIntro));
  const group = useGroup(isGroup ? id : undefined);

  // Broadcast typing while the user is composing.
  useEffect(() => {
    if (!id || !canCompose || isAIChat) return;
    const hasText = draft.trim().length > 0;
    if (hasText && !typingSentRef.current) {
      typingSentRef.current = true;
      apiSetTyping(id, true).catch(() => {});
    }
    if (!hasText && typingSentRef.current) {
      typingSentRef.current = false;
      apiSetTyping(id, false).catch(() => {});
    }
    const stop = setTimeout(() => {
      if (typingSentRef.current) {
        typingSentRef.current = false;
        apiSetTyping(id, false).catch(() => {});
      }
    }, 3000);
    return () => clearTimeout(stop);
  }, [draft, id, isAIChat, canCompose]);

  // Apply the group's history settings: hide pre-join messages when history is
  // off, and cap how many of them a new member can see.
  const visible = useMemo<Message[]>(() => {
    if (!isGroup || !group) return messages;
    const historical = messages.filter((m) => m.historical);
    const rest = messages.filter((m) => !m.historical);
    if (!group.historyEnabled) return rest;
    const shown =
      group.historyLimit === Infinity ? historical : historical.slice(-group.historyLimit);
    return [...shown, ...rest];
  }, [messages, isGroup, group]);

  const trimmedQuery = query.trim();
  const searching = searchMode && trimmedQuery.length > 0;

  const filtered = useMemo<Message[]>(() => {
    if (!searching) return visible;
    const q = trimmedQuery.toLowerCase();
    return visible.filter((m) => !m.system && m.text.toLowerCase().includes(q));
  }, [visible, searching, trimmedQuery]);

  const grouped = useMemo(() => groupMessages(filtered), [filtered]);

  const appendMessage = (
    msg: Omit<Message, 'id' | 'timestamp' | 'fromMe' | 'status'> & { id?: string },
  ) => {
    setMessages((prev) => [
      ...prev,
      {
        id: msg.id ?? `tmp_${Date.now()}`,
        fromMe: true,
        timestamp: nowTime(),
        status: 'sent',
        ...msg,
      },
    ]);
  };

  const appendDandara = (text: string) => {
    setMessages((prev) => [
      ...prev,
      {
        id: `d${Date.now()}`,
        text,
        fromMe: false,
        timestamp: nowTime(),
        isAI: true,
        senderName: DANDARA.name,
        senderAvatarUri: DANDARA.avatarUri,
      },
    ]);
  };

  const triggerDandara = (prompt: string) => {
    setDandaraTyping(true);
    if (dandaraTimerRef.current) clearTimeout(dandaraTimerRef.current);
    dandaraTimerRef.current = setTimeout(() => {
      setDandaraTyping(false);
      appendDandara(dandaraReply(prompt));
    }, 1400);
  };

  // ── Voice recording ──────────────────────────────────────────────────────
  const resetRecordingValues = () => {
    dragX.value = 0;
    dragY.value = 0;
    recActive.value = false;
    recLocked.value = false;
    recCancelled.value = false;
    micScale.value = withTiming(1, { duration: 150 });
    micHalo.value = 0;
    recExit.value = 0;
  };

  const stopTimer = () => {
    if (timerRef.current) clearInterval(timerRef.current);
    timerRef.current = null;
  };

  const beginRecording = async () => {
    if (!recordPermRef.current) {
      const r = await requestRecordingPermissionsAsync().catch(() => null);
      recordPermRef.current = !!r?.granted;
      if (!recordPermRef.current) {
        recActive.value = false;
        return;
      }
    }
    try {
      await setAudioModeAsync({ allowsRecording: true, playsInSilentMode: true });
      await audioRecorder.prepareToRecordAsync();
      audioRecorder.record();
    } catch {
      recActive.value = false;
      return;
    }
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {});
    recordStartRef.current = Date.now();
    setElapsedSec(0);
    setRecordPhase('recording');
    // The other side sees "recording audio" rather than the typing dots.
    if (id && !isAIChat) apiSetTyping(id, true, 'recording').catch(() => {});
    micScale.value = withSpring(1.7, { damping: 12 });
    micHalo.value = withRepeat(withTiming(1, { duration: 1100 }), -1, false);
    stopTimer();
    timerRef.current = setInterval(() => {
      setElapsedSec(Math.floor((Date.now() - recordStartRef.current) / 1000));
    }, 300);
  };

  const lockRecording = () => {
    setRecordPhase('locked');
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
    micScale.value = withTiming(1, { duration: 150 });
    micHalo.value = 0;
  };

  const finishRecording = async () => {
    stopTimer();
    const duration = Math.round((Date.now() - recordStartRef.current) / 1000);
    setRecordPhase('idle');
    resetRecordingValues();
    // Cleared on every way out — sent, cancelled or abandoned. A recording
    // indicator that outlives the recording is the failure this guards.
    if (id && !isAIChat) apiSetTyping(id, false, 'recording').catch(() => {});
    try {
      await audioRecorder.stop();
      await setAudioModeAsync({ allowsRecording: false, playsInSilentMode: true });
      const uri = audioRecorder.uri;
      if (uri && duration >= 1) {
        const tempId = `tmp_${Date.now()}`;
        appendMessage({
          id: tempId,
          text: '',
          media: { type: 'audio', uri, durationSec: duration },
          replyTo: replyTarget
            ? { id: replyTarget.id, text: replySnippet(replyTarget), fromMe: replyTarget.fromMe, senderName: replyTarget.senderName, icon: replyIcon(replyTarget) }
            : undefined,
        });
        if (id && !isAIChat) {
          try {
            const { object: uploaded, key: voiceKey } = await uploadEncryptedMedia({
              uri,
              name: `voice-${Date.now()}.m4a`,
              mimeType: 'audio/mp4',
              durationMs: duration * 1000,
            });
            const body = encodeMediaContent(uploaded.url, '', voiceKey);
            const dto = await apiSendMessage(id, await encryptBody(body), 'audio');
            const mapped = mapApiMessage(dto, meId);
            setMessages((prev) => {
              if (prev.some((m) => m.id === mapped.id)) {
                return prev.filter((m) => m.id !== tempId);
              }
              return prev.map((m) => (m.id === tempId ? mapped : m));
            });
          } catch (err) {
            // Silently keeping the bubble made a failed send look like a
            // successful one that vanished on reload. Say what broke.
            appAlert(t('chats.action_failed_title'), describeError(err));
          }
        }
      }
    } catch {
      /* discard on failure */
    }
    setReplyTarget(null);
  };

  const cancelRecording = async () => {
    stopTimer();
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Rigid).catch(() => {});
    recExit.value = withTiming(1, { duration: 260 });
    dragX.value = withTiming(0, { duration: 200 });
    dragY.value = withTiming(0, { duration: 200 });
    micScale.value = withTiming(1, { duration: 200 });
    micHalo.value = 0;
    try {
      await audioRecorder.stop();
      await setAudioModeAsync({ allowsRecording: false, playsInSilentMode: true });
    } catch {
      /* nothing to discard */
    }
    setTimeout(() => {
      setRecordPhase('idle');
    // Cleared on every way out — sent, cancelled or abandoned. A recording
    // indicator that outlives the recording is the failure this guards.
    if (id && !isAIChat) apiSetTyping(id, false, 'recording').catch(() => {});
      resetRecordingValues();
    }, 280);
  };

  const recordGesture = Gesture.LongPress()
    .minDuration(220)
    .maxDistance(100000)
    .shouldCancelWhenOutside(false)
    .onStart((e) => {
      recOriginX.value = e.absoluteX;
      recOriginY.value = e.absoluteY;
      dragX.value = 0;
      dragY.value = 0;
      recActive.value = true;
      recLocked.value = false;
      recCancelled.value = false;
      recExit.value = 0;
      runOnJS(beginRecording)();
    })
    .onTouchesMove((e) => {
      if (!recActive.value || recLocked.value || recCancelled.value) return;
      const touch = e.allTouches[0];
      if (!touch) return;
      const dx = Math.min(0, touch.absoluteX - recOriginX.value);
      const dy = Math.min(0, touch.absoluteY - recOriginY.value);
      if (dy < -LOCK_THRESHOLD) {
        recLocked.value = true;
        dragX.value = withTiming(0);
        dragY.value = withTiming(0);
        runOnJS(lockRecording)();
        return;
      }
      if (dx < -CANCEL_THRESHOLD) {
        recCancelled.value = true;
        runOnJS(cancelRecording)();
        return;
      }
      dragX.value = dx;
      dragY.value = dy;
    })
    .onEnd(() => {
      const wasActive = recActive.value;
      recActive.value = false;
      if (!wasActive || recLocked.value || recCancelled.value) return;
      runOnJS(finishRecording)();
    });

  const openMenu = (target: MenuTarget) => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {});
    setMenuTarget(target);
  };

  const closeMenu = () => setMenuTarget(null);

  const handleReact = (msgId: string, emoji: string) => {
    const mid = serverMessageId(msgId);
    const existing = reactionsMap[msgId] ?? [];
    const mine = existing.find((r) => r.mine);
    const removing = mine?.emoji === emoji;

    // Optimistic UI
    setReactionsMap((prev) => {
      const list = [...(prev[msgId] ?? [])];
      const mineIdx = list.findIndex((r) => r.mine);
      const myEmoji = mineIdx >= 0 ? list[mineIdx].emoji : null;

      if (mineIdx >= 0) {
        if (list[mineIdx].count <= 1) list.splice(mineIdx, 1);
        else list[mineIdx] = { ...list[mineIdx], count: list[mineIdx].count - 1, mine: false };
      }
      if (myEmoji === emoji) return { ...prev, [msgId]: list };

      const idx = list.findIndex((r) => r.emoji === emoji);
      if (idx >= 0) list[idx] = { ...list[idx], count: list[idx].count + 1, mine: true };
      else list.push({ emoji, count: 1, mine: true });

      return { ...prev, [msgId]: list };
    });

    if (layout.hapticsOnReact) {
      Haptics.selectionAsync().catch(() => {});
    }
    if (id && mid != null) {
      const req = removing
        ? removeReaction(id, mid, emoji)
        : addReaction(id, mid, emoji);
      req
        .then((rows) => {
          setReactionsMap((prev) => ({
            ...prev,
            [msgId]: collapseReactions(rows, meId),
          }));
        })
        .catch(() => {
          /* keep optimistic */
        });
    }
  };

  const reactFromMenu = (emoji: string) => {
    if (!menuTarget) return;
    handleReact(menuTarget.msg.id, emoji);
    Haptics.selectionAsync().catch(() => {});
  };

  const replyFromMenu = () => {
    if (menuTarget) setReplyTarget(menuTarget.msg);
  };

  const copyFromMenu = () => {
    if (menuTarget?.msg.text) Clipboard.setStringAsync(menuTarget.msg.text).catch(() => {});
  };

  const forwardFromMenu = () => {
    if (menuTarget) setForwardTargets([menuTarget.msg]);
  };

  const editFromMenu = () => {
    if (!menuTarget) return;
    const msg = menuTarget.msg;
    setEditingMsgId(msg.id);
    setDraft(msg.text);
    setReplyTarget(null);
    setTimeout(() => composerInputRef.current?.focus(), 120);
  };

  const deleteFromMenu = () => {
    if (menuTarget) setDeleteTargets([menuTarget.msg]);
  };

  const cancelEdit = () => {
    setEditingMsgId(null);
    setDraft('');
  };

  /**
   * A sticker in the thread is identified by its media URL, which is what
   * the saved pack stores too — so this works for stickers I sent and for
   * ones I received.
   */
  const savedStickerFor = (msg: Message) => {
    const uri = msg.attachment?.kind === 'sticker' ? msg.attachment.uri : null;
    if (!uri) return null;
    for (const pack of stickerPacks) {
      const hit = pack.stickers?.find((s) => mediaFileURL(s.url) === uri);
      if (hit) return hit;
    }
    return null;
  };

  const isStickerSaved = (msg: Message) => !!savedStickerFor(msg);

  const toggleSavedSticker = async () => {
    const msg = menuTarget?.msg;
    closeMenu();
    if (!msg || msg.attachment?.kind !== 'sticker') return;
    const existing = savedStickerFor(msg);
    try {
      if (existing) {
        await removeSticker(existing.id);
        showToast(t('stickers.removed'));
      } else {
        // The message carries a media URL; recover the id from it.
        const mediaId = msg.attachment.uri.match(/media\/([0-9a-f-]{36})\/file/i)?.[1];
        if (!mediaId) return;
        await saveSticker({ media_id: mediaId });
        showToast(t('stickers.saved'));
      }
      await refreshStickerPacks();
    } catch {
      appAlert(t('chats.action_failed_title'), t('chats.action_failed_body'));
    }
  };

  /** Open the gallery positioned on the tapped item. */
  const openViewer = useCallback(
    (msg: Message) => {
      const i = galleryItems.findIndex((g) => g.id === msg.id);
      if (i >= 0) setViewerStart(i);
    },
    [galleryItems],
  );

  const replyFromViewer = useCallback(
    (msgId: string) => {
      const msg = messages.find((m) => m.id === msgId);
      setViewerStart(null);
      if (msg) setReplyTarget(msg);
    },
    [messages],
  );

  const forwardFromViewer = useCallback(
    (msgId: string) => {
      const msg = messages.find((m) => m.id === msgId);
      setViewerStart(null);
      if (msg) setForwardTargets([msg]);
    },
    [messages],
  );

  // ── Multi-select ─────────────────────────────────────────────────────────
  const startSelection = (msg: Message) => {
    setSelectedIds(new Set([msg.id]));
    Haptics.selectionAsync().catch(() => {});
  };

  const toggleSelect = (msgId: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(msgId)) next.delete(msgId);
      else next.add(msgId);
      return next;
    });
  };

  const clearSelection = () => setSelectedIds(new Set());

  const selectFromMenu = () => {
    if (menuTarget) startSelection(menuTarget.msg);
  };

  // Resolve currently-selected (and not-deleted) messages — used by bulk actions.
  const selectedMessages = (): Message[] =>
    visible.filter((m) => selectedIds.has(m.id) && !m.deletedAt);

  const bulkForward = () => {
    const list = selectedMessages();
    if (list.length === 0) return;
    setForwardTargets(list);
  };

  const bulkDelete = () => {
    const list = selectedMessages();
    if (list.length === 0) return;
    setDeleteTargets(list);
  };

  const bulkCopy = () => {
    const txt = selectedMessages()
      .map((m) => m.text)
      .filter(Boolean)
      .join('\n\n');
    if (txt) Clipboard.setStringAsync(txt).catch(() => {});
    clearSelection();
  };

  // Apply the delete action chosen from the confirmation modal — handles
  // single message (from the context menu) and bulk (from selection mode).
  // 'me'  — local-only soft delete.
  // 'all' — propagates to the bridge / other clients.
  const confirmDelete = (scope: 'me' | 'all') => {
    if (deleteTargets.length === 0) return;
    const targets = [...deleteTargets];
    const ids = new Set(targets.map((t) => t.id));
    setMessages((prev) =>
      prev.map((m) =>
        ids.has(m.id)
          ? { ...m, deletedAt: new Date().toISOString(), text: '' }
          : m,
      ),
    );
    // Propagate soft-delete to API for own messages with server ids.
    if (id && scope === 'all') {
      for (const t of targets) {
        const mid = serverMessageId(t.id);
        if (mid != null && t.fromMe) {
          apiDeleteMessage(id, mid).catch(() => {});
        }
      }
    } else if (id) {
      // delete for me — still soft-delete on server when we are the sender
      for (const t of targets) {
        const mid = serverMessageId(t.id);
        if (mid != null && t.fromMe) {
          apiDeleteMessage(id, mid).catch(() => {});
        }
      }
    }
    Haptics.impactAsync(
      scope === 'all' ? Haptics.ImpactFeedbackStyle.Rigid : Haptics.ImpactFeedbackStyle.Light,
    ).catch(() => {});
    setDeleteTargets([]);
    clearSelection();
  };

  // Forward for real: one POST per message into the destination chat,
  // encrypted for that chat's peer (not this one's). This used to append
  // to the in-memory MESSAGES fixture, so forwards vanished on reload.
  /**
   * Send one message on to your story.
   *
   * Opens the normal composer prefilled rather than publishing straight
   * away: a story carries a caption, a duration and an audience, and
   * publishing on a single tap would decide all three for you.
   *
   * One at a time — a story is a single frame, so a multi-select forward has
   * no meaning here and the option is hidden for it.
   */
  /**
   * Change the disappearing timer from inside the conversation.
   *
   * Either side may, including turning off what the other turned on: it is a
   * property of this conversation and both people live with it. It applies
   * only here — one chat's timer says nothing about any other.
   */
  const pickDisappearing = () => {
    if (!id) return;
    const current = apiChatInfo?.disappear_seconds ?? 0;
    appAlert(
      t('chat_info.disappearing'),
      t('chat_info.disappearing_hint'),
      DISAPPEAR_OPTIONS.map((sec) => ({
        text:
          (sec === 0
            ? t('chat_info.off')
            : t(`chat_info.disappear_${sec}` as never)) + (sec === current ? '  ✓' : ''),
        onPress: () => {
          setDisappearing(id, sec).catch(() => {
            appAlert(t('chats.action_failed_title'), t('chats.action_failed_body'));
          });
        },
      })).concat([{ text: t('common.cancel'), onPress: () => {} }]),
    );
  };

  const forwardToStory = () => {
    const msg = forwardTargets[0];
    if (!msg) return;
    setForwardTargets([]);
    clearSelection();

    const media = msg.media;
    const params = new URLSearchParams();
    if (media?.uri) {
      params.set('forwardMedia', media.uri);
      params.set('forwardKind', media.type === 'video' ? 'video' : 'image');
      if (msg.text) params.set('forwardText', msg.text);
    } else {
      params.set('forwardText', msg.text);
    }
    router.push(`/story/create?${params.toString()}`);
  };

  const forwardTo = async (destChatId: string) => {
    if (forwardTargets.length === 0) return;
    const dest = storeChats.find((c) => c.id === destChatId);
    const toSend = [...forwardTargets];

    Haptics.selectionAsync().catch(() => {});
    setForwardTargets([]);
    clearSelection();

    try {
      for (const msg of toSend) {
        // Forwarding is not exempt: a message that was encrypted in one
        // conversation must not leave in the clear from another, and an
        // unknown destination is not a licence to send in the clear.
        let payload: string;
        try {
          payload = await encryptForChat(destChatId, dest, msg.text);
        } catch (err) {
          reportE2EEBlocked(err);
          return;
        }
        // Carry the hop count and, for a forwarded channel post, the way
        // back to it. Without this the label never appears, because the
        // server only ever saw a first-hand message.
        await apiSendMessage(destChatId, payload, 'text', undefined, null, {
          // The count this message already carried; the server adds the hop.
          forwardCount: msg.forwardCount ?? 0,
          sourceChannelId: msg.sourceChannelId,
          sourcePostId: msg.sourcePostId,
        });
      }
      await refreshChats();
    } catch {
      appAlert(t('chats.action_failed_title'), t('chats.action_failed_body'));
    }
  };

  const replyFromSwipe = (msg: Message) => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
    setReplyTarget(msg);
  };

  /** Absolute media URL back to the stored server path. */
  const stripApiBase = (uri: string) =>
    uri.startsWith('http') ? uri.replace(/^https?:\/\/[^/]+/, '') : uri;

  const submitText = (text: string) => {
    if (!text) return;
    // If we're editing an existing message, update it in place and bail out.
    if (editingMsgId) {
      const editId = editingMsgId;
      setMessages((prev) =>
        prev.map((m) => (m.id === editId ? { ...m, text, edited: true } : m)),
      );
      setEditingMsgId(null);
      const mid = serverMessageId(editId);
      if (id && mid != null) {
        // A media message stores its payload (url, key, caption) in the
        // body. Sending bare text would overwrite it and lose the file for
        // good, so edit the caption inside the payload instead.
        const target = messages.find((m) => m.id === editId);
        const isMedia = !!target?.media;
        const body = isMedia
          ? encodeMediaContent(
              stripApiBase(target!.media!.uri),
              text,
              target!.media!.key ?? null,
            )
          : text;

        apiEditMessage(id, mid, body)
          .then((dto) => {
            const mapped = mapApiMessage(dto, meId);
            // Keep the resolved media we already have; the round-trip only
            // needs to confirm the edit.
            if (isMedia && target?.media) mapped.media = { ...target.media };
            setMessages((prev) => prev.map((m) => (m.id === editId ? mapped : m)));
          })
          .catch(() => {
            /* keep optimistic edit */
          });
      }
      return;
    }
    const tempId = `tmp_${Date.now()}`;
    const reply = replyTarget
      ? {
          id: replyTarget.id,
          text: replySnippet(replyTarget),
          fromMe: replyTarget.fromMe,
          senderName: replyTarget.senderName,
          icon: replyIcon(replyTarget),
        }
      : undefined;
    appendMessage({
      id: tempId,
      text,
      replyTo: reply,
    });
    setReplyTarget(null);
    if (isAIChat || /@dandara/i.test(text)) triggerDandara(text);

    if (id && !isAIChat) {
      const replyTo = reply ? serverMessageId(reply.id) ?? undefined : undefined;
      (async () => {
        let payload: string;
        // Direct chats are end-to-end encrypted or they do not send.
        //
        // This used to fall back to plaintext on any failure, silently: the
        // sender's screen looked identical whether the message went out
        // encrypted or in the clear, so the one promise the app makes about
        // messages was broken precisely when nobody could tell. Groups are
        // excluded because they have no E2EE yet — blocking there would stop
        // group messaging outright, which is a different decision.
        //
        // One path for every chat and every message kind. This branch used
        // to read `type !== 'group'`, so a group's text messages skipped
        // encryption altogether — the most common message in the app was the
        // one left in the clear, while its photos were sealed.
        try {
          payload = await encryptBody(text);
        } catch (err) {
          // Nothing goes to the server. The bubble comes back off the thread
          // and the text returns to the box, so the message is not lost and
          // the failure is not mistaken for a delivery.
          setMessages((prev) => prev.filter((m) => m.id !== tempId));
          setDraft((d) => (d ? d : text));
          reportE2EEBlocked(err);
          return;
        }
        try {
          const dto = await apiSendMessage(id, payload, 'text', replyTo ?? undefined);
          const mapped = mapApiMessage(dto, meId);
          // Show plaintext in UI even if wire was encrypted.
          mapped.text = text;
          // Keep the quote the optimistic bubble was showing. The server
          // returns only reply_to_id — it cannot return the quoted text,
          // which is encrypted — so dropping this made the quote blink out
          // the instant the message was confirmed.
          if (reply) mapped.replyTo = reply;
          setMessages((prev) => {
            if (prev.some((m) => m.id === mapped.id)) {
              return prev.filter((m) => m.id !== tempId);
            }
            const idx = prev.findIndex((m) => m.id === tempId);
            if (idx >= 0) {
              const next = [...prev];
              next[idx] = mapped;
              return next;
            }
            return [...prev, mapped];
          });
        } catch {
          // Keep optimistic bubble; failed sync surfaces on next open/reload.
        }
      })();
    }
  };

  const handleSend = () => {
    const text = draft.trim();
    if (!text || !canCompose) return;
    submitText(text);
    setDraft('');
    typingSentRef.current = false;
    if (id && !isAIChat) apiSetTyping(id, false).catch(() => {});
  };

  /**
   * Send a sticker. It goes as message_type 'sticker' carrying the media
   * URL, so it is not E2EE-wrapped like text — the bytes already live on
   * the server as a media object either way.
   */
  const sendSticker = async (sticker: StickerDTO) => {
    if (!canCompose || !id) return;
    setShowStickers(false);
    noteStickerUsed(sticker);

    const tempId = `tmp-${Date.now()}`;
    const uri = mediaFileURL(sticker.url);
    setMessages((prev) => [
      ...prev,
      {
        id: tempId,
        text: '',
        fromMe: true,
        timestamp: nowTime(),
        status: 'sent',
        attachment: { kind: 'sticker', uri, width: STICKER_BUBBLE_SIZE, height: STICKER_BUBBLE_SIZE },
      },
    ]);

    try {
      const dto = await apiSendMessage(
        id,
        await encryptBody(encodeMediaContent(sticker.url)),
        'sticker',
      );
      setMessages((prev) => {
        const mapped = mapApiMessage(dto, meId);
        mapped.attachment = { kind: 'sticker', uri, width: STICKER_BUBBLE_SIZE, height: STICKER_BUBBLE_SIZE };
        const without = prev.filter((m) => m.id !== tempId);
        return without.some((m) => m.id === mapped.id) ? without : [...without, mapped];
      });
      await refreshChats();
    } catch {
      setMessages((prev) => prev.filter((m) => m.id !== tempId));
      appAlert(t('chats.action_failed_title'), t('chats.action_failed_body'));
    }
  };

  const addAsset = async (
    asset: ImagePicker.ImagePickerAsset,
    captionOverride?: string,
    viewLimit?: number | null,
  ) => {
    if (!canCompose) return;
    // The editor hands its caption in directly. Reading `draft` here would
    // see the value from before setDraft landed — React state is async, so
    // the caption was always empty on the first send.
    const caption = (captionOverride ?? draft).trim();
    const kind = asset.type === 'video' ? 'video' : 'image';
    const localUri = asset.uri;
    const media: MediaAttachment = {
      type: kind,
      uri: localUri,
      durationSec: asset.duration ? Math.round(asset.duration / 1000) : undefined,
    };
    const tempId = `tmp_${Date.now()}`;
    appendMessage({
      id: tempId,
      text: caption,
      media,
      replyTo: replyTarget
        ? { id: replyTarget.id, text: replySnippet(replyTarget), fromMe: replyTarget.fromMe, senderName: replyTarget.senderName, icon: replyIcon(replyTarget) }
        : undefined,
    });
    setDraft('');
    setReplyTarget(null);
    if (!id || isAIChat) return;

    try {
      const mime = asset.mimeType ?? (kind === 'video' ? 'video/mp4' : 'image/jpeg');
      const { object: uploaded, key: mediaKey } = await uploadEncryptedMedia({
        uri: localUri,
        mimeType: mime,
        width: asset.width,
        height: asset.height,
        durationMs: asset.duration ? Math.round(asset.duration) : undefined,
      });
      const remoteUri = mediaFileURL(uploaded.url);
      // Swap local preview for remote URL.
      setMessages((prev) =>
        prev.map((m) =>
          m.id === tempId && m.media
            ? { ...m, media: { ...m.media, uri: remoteUri, key: mediaKey, mime, sizeBytes: uploaded.size_bytes } }
            : m,
        ),
      );
      // The key travels inside the message body, which encryptBody then
      // encrypts for the peer. It used to say the same thing and send the
      // body in the clear, which handed the server the file key.
      const body = encodeMediaContent(uploaded.url, caption, mediaKey);
      const dto = await apiSendMessage(
        id,
        await encryptBody(body),
        kind,
        undefined,
        viewLimit,
      );
      const mapped = mapApiMessage(dto, meId);
      setMessages((prev) => {
        if (prev.some((m) => m.id === mapped.id)) {
          return prev.filter((m) => m.id !== tempId);
        }
        return prev.map((m) => (m.id === tempId ? mapped : m));
      });
    } catch (err) {
      appAlert(t('chats.action_failed_title'), describeError(err));
      // Keep local optimistic bubble if upload/send fails.
    }
  };

  const handleAcceptRequest = async () => {
    if (!id) return;
    try {
      await acceptChat(id);
      await refreshChats();
    } catch {
      // stay pending; user can retry
    }
  };

  const handleDeclineRequest = async () => {
    if (!id) return;
    try {
      await blockChat(id);
      await refreshChats();
    } catch {
      // stay pending
    }
  };

  const pickFromLibrary = async () => {
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images', 'videos'],
      quality: 0.8,
    });
    if (!result.canceled && result.assets[0]) openEditor(result.assets[0]);
  };

  const openCamera = async () => {
    const perm = await ImagePicker.requestCameraPermissionsAsync();
    if (!perm.granted) return;
    const result = await ImagePicker.launchCameraAsync({
      mediaTypes: ['images', 'videos'],
      quality: 0.8,
      videoMaxDuration: 60,
    });
    if (!result.canceled && result.assets[0]) openEditor(result.assets[0]);
  };

  /**
   * Every image and video goes through the editor before sending, so crop,
   * draw, text and stickers are always one step away.
   */
  const openEditor = (asset: ImagePicker.ImagePickerAsset) => {
    setPendingAsset(asset);
    setEditorAsset({ uri: asset.uri, type: asset.type === 'video' ? 'video' : 'image' });
    setEditorMode('send');
  };

  /** Pick a photo or video and open the editor in sticker mode. */
  const pickForSticker = async () => {
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images', 'videos'],
      quality: 1,
    });
    if (!result.canceled && result.assets[0]) makeSticker(result.assets[0]);
  };

  /** Turn the picked media into a sticker instead of sending it. */
  const makeSticker = (asset: ImagePicker.ImagePickerAsset) => {
    setPendingAsset(asset);
    setEditorAsset({ uri: asset.uri, type: asset.type === 'video' ? 'video' : 'image' });
    setEditorMode('sticker');
  };

  const handleEditorDone = async (res: EditorResult) => {
    const original = pendingAsset;
    setEditorAsset(null);
    setPendingAsset(null);

    if (editorMode === 'sticker') {
      try {
        const ext = res.mime === 'image/webp' ? 'webp' : 'png';
        const media = await uploadMedia({
          uri: res.uri,
          name: `sticker-${Date.now()}.${ext}`,
          mimeType: res.mime,
        });
        await saveSticker({ media_id: media.id });
        await refreshStickerPacks();
        showToast(t('stickers.saved'));
      } catch {
        appAlert(t('stickers.import_failed_title'), t('stickers.import_failed_body'));
      }
      return;
    }

    // Reuse the existing upload+send path, with the edited file swapped in.
    if (original) {
      addAsset(
        { ...original, uri: res.uri, type: res.type === 'video' ? 'video' : 'image' },
        res.caption,
        res.viewLimit,
      );
    }
  };

  /**
   * Send an audio file from storage. Voice notes are recorded with the mic
   * button; this is for music or a clip the user already has.
   */
  const pickAudio = async () => {
    const result = await DocumentPicker.getDocumentAsync({
      type: 'audio/*',
      copyToCacheDirectory: true,
    });
    if (result.canceled || !result.assets?.[0]) return;
    const asset = result.assets[0];
    if (!id || isAIChat) return;
    try {
      const { object: uploaded, key: audioKey } = await uploadEncryptedMedia({
        uri: asset.uri,
        name: asset.name,
        mimeType: asset.mimeType ?? 'audio/mpeg',
      });
      const dto = await apiSendMessage(
        id,
        await encryptBody(encodeMediaContent(uploaded.url, asset.name, audioKey)),
        'audio',
      );
      setMessages((prev) => [...prev, mapApiMessage(dto, meId)]);
      await refreshChats();
    } catch (err) {
      appAlert(t('chats.action_failed_title'), describeError(err));
    }
  };

  // One-line preview for a quoted/replied message.
  const replySnippet = (m: Message): string => {
    if (m.deletedAt) return t(m.fromMe ? 'chat.deleted_self' : 'chat.deleted_other');
    if (m.attachment) {
      const a = m.attachment;
      if (a.kind === 'document') return t('chat.attach_document');
      if (a.kind === 'location') return a.live ? t('chat.live_location') : t('chat.attach_location');
      if (a.kind === 'contact') return t('chat.attach_contact');
      if (a.kind === 'sticker') return t('chat.sticker');
      if (a.kind === 'poll') return t('chat.poll_label');
      if (a.kind === 'event') return t('chat.event_label');
      return t('chat.game_invite');
    }
    if (m.media) {
      return m.media.type === 'audio' ? t('chat.voice_message') : t('chat.attach_gallery');
    }
    return m.text;
  };

  // Icon shown next to a quoted/replied message preview.
  const replyIcon = (m: Message): keyof typeof Ionicons.glyphMap | undefined => {
    if (m.deletedAt) return 'ban-outline';
    if (m.attachment) {
      const k = m.attachment.kind;
      if (k === 'document') return 'document-text';
      if (k === 'location') return 'location';
      if (k === 'contact') return 'person';
      if (k === 'sticker') return 'happy';
      if (k === 'poll') return 'stats-chart';
      if (k === 'event') return 'calendar';
      return 'game-controller';
    }
    if (m.media) {
      if (m.media.type === 'audio') return 'mic';
      if (m.media.type === 'video') return 'videocam';
      return 'image';
    }
    return undefined;
  };

  /**
   * Send a rich attachment (location, contact, poll, event…).
   *
   * This used to only append locally, so nothing ever left the device —
   * the bubble vanished on reload. The payload is JSON in the message
   * body, using the message_type the schema already allowed.
   */
  const sendAttachment = async (attachment: MessageAttachment) => {
    const reply = replyTarget;
    appendMessage({
      text: '',
      attachment,
      replyTo: reply
        ? { id: reply.id, text: replySnippet(reply), fromMe: reply.fromMe, senderName: reply.senderName, icon: replyIcon(reply) }
        : undefined,
    });
    setReplyTarget(null);
    setComposeKind(null);

    // Documents upload their bytes separately and are sent there.
    if (!id || isAIChat || attachment.kind === 'document') return;

    const wireType = ATTACHMENT_WIRE_TYPE[attachment.kind];
    if (!wireType) return;
    try {
      await apiSendMessage(
        id,
        await encryptBody(JSON.stringify(attachment)),
        wireType,
        reply ? serverMessageId(reply.id) ?? undefined : undefined,
      );
      await refreshChats();
    } catch {
      appAlert(t('chats.action_failed_title'), t('chats.action_failed_body'));
    }
  };

  const pickDocument = async () => {
    const result = await DocumentPicker.getDocumentAsync({ copyToCacheDirectory: true });
    if (result.canceled || !result.assets?.[0]) return;
    const asset = result.assets[0];
    const dot = asset.name.lastIndexOf('.');
    const ext = dot >= 0 ? asset.name.slice(dot + 1) : 'file';
    const bytes = asset.size ?? 0;
    const sizeLabel =
      bytes >= 1024 * 1024
        ? `${(bytes / (1024 * 1024)).toFixed(1)} MB`
        : bytes > 0
          ? `${Math.max(1, Math.round(bytes / 1024))} KB`
          : '—';
    // url/key are filled in after the upload below.
    sendAttachment({ kind: 'document', name: asset.name, ext, sizeLabel });
    // Also upload + send as document message when online.
    if (id && !isAIChat && asset.uri) {
      try {
        const { object: uploaded, key: docKey } = await uploadEncryptedMedia({
          uri: asset.uri,
          name: asset.name,
          mimeType: asset.mimeType ?? 'application/octet-stream',
        });
        const body = encodeMediaContent(uploaded.url, asset.name, docKey);
        await apiSendMessage(id, await encryptBody(body), 'document');
      } catch (err) {
        appAlert(t('chats.action_failed_title'), describeError(err));
      }
    }
  };

  const handleAttachPick = (key: string) => {
    setShowAttach(false);
    // Let the menu finish dismissing before the next surface appears.
    if (key === 'gallery') {
      setTimeout(pickFromLibrary, 300);
    } else if (key === 'camera') {
      setTimeout(openCamera, 300);
    } else if (key === 'audio') {
      setTimeout(pickAudio, 300);
    } else if (key === 'make_sticker') {
      setTimeout(pickForSticker, 300);
    } else if (key === 'document') {
      setTimeout(pickDocument, 300);
    } else if (key === 'dandara') {
      setDraft((d) => (/@dandara/i.test(d) ? d : `@Dandara ${d}`));
      setTimeout(() => composerInputRef.current?.focus(), 320);
    } else {
      setTimeout(() => setComposeKind(key), 280);
    }
  };

  const handleVote = (msgId: string, optionId: string) => {
    let updated: MessageAttachment | null = null;
    setMessages((prev) =>
      prev.map((m) => {
        const att = m.attachment;
        if (m.id !== msgId || !att || att.kind !== 'poll') return m;
        const options = att.options.map((o) => {
          if (o.id === optionId) {
            return { ...o, voted: !o.voted, votes: o.votes + (o.voted ? -1 : 1) };
          }
          if (!att.multi && o.voted) {
            return { ...o, voted: false, votes: o.votes - 1 };
          }
          return o;
        });
        updated = { ...att, options };
        return { ...m, attachment: updated };
      }),
    );

    // Votes are their own record on the server, not an edit of the message.
    // Editing is the author's alone, so persisting a vote that way returned
    // 403 on every poll the user did not create themselves.
    const mid = serverMessageId(msgId);
    if (id && mid != null && updated) {
      const chosen = (updated as Extract<MessageAttachment, { kind: 'poll' }>).options
        .filter((o) => o.voted)
        .map((o) => o.id);
      votePoll(id, mid, chosen)
        .then((tally) => applyPollTally(msgId, tally))
        .catch(() => {
          appAlert(t('chats.action_failed_title'), t('chats.action_failed_body'));
        });
    }
  };

  /**
   * Replace a poll's counts with the server's, which is the only place they
   * are authoritative — the optimistic update above only knows about this
   * user's own click.
   */
  const applyPollTally = (msgId: string, tally: PollTally) => {
    setMessages((prev) =>
      prev.map((m) => {
        const att = m.attachment;
        if (m.id !== msgId || !att || att.kind !== 'poll') return m;
        return {
          ...m,
          attachment: {
            ...att,
            options: att.options.map((o) => ({
              ...o,
              votes: tally.counts[o.id] ?? 0,
              voted: tally.mine.includes(o.id),
            })),
          },
        };
      }),
    );
  };

  /**
   * Call outcomes, keyed by call id.
   *
   * The row a call leaves in the thread carries only the call id: whether it
   * was answered, missed, or is still running changes after the row is
   * written, so baking it into the message would make the thread lie.
   *
   * Fetched once per chat open. Cheap, and the alternative — a request per
   * call row — is not.
   */
  const [callLog, setCallLog] = useState<Record<string, CallLogEntry>>({});
  useEffect(() => {
    if (!id) return;
    let cancelled = false;
    callHistory()
      .then((rows) => {
        if (cancelled) return;
        const map: Record<string, CallLogEntry> = {};
        for (const r of rows ?? []) map[r.id] = r;
        setCallLog(map);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [id, messages.length]);

  // ── Truth or Dare room ───────────────────────────────────────────────────
  const [gameOpen, setGameOpen] = useState(false);


  /**
   * Who is at the table.
   *
   * A one-to-one chat used to yield nobody, so the game entry in that chat's
   * info screen led to a refusal — and the engine never needed a group in the
   * first place. It takes a list of ids, derives the turn from
   * (seed, round, ids), and rides the same encrypted message channel a pair
   * already shares. Two people are a game.
   */
  const gamePlayers = useMemo<GamePlayer[]>(() => {
    if (isGroup) {
      if (!group?.members?.length) return [];
      return group.members.map((m) => ({
        id: m.id,
        name: m.name || m.username,
        // The store keeps the handle with its @; the room adds its own.
        username: m.username?.replace(/^@/, '') || undefined,
        avatarUri: m.avatarUri,
      }));
    }
    const peerId = apiChatInfo?.peer_user_id;
    if (!peerId || !currentUser?.id || isAIChat) return [];
    // Ordered by id so both phones build the same list — the roulette is
    // derived from the order, and two different orders are two different games.
    return [
      {
        id: currentUser.id,
        name: currentUser.display_name || currentUser.username || '',
        username: currentUser.username?.replace(/^@/, '') || undefined,
        avatarUri: currentUser.avatar_uri ?? undefined,
      },
      {
        id: peerId,
        name: apiChatInfo?.title || apiChatInfo?.peer_username || '',
        username: apiChatInfo?.peer_username?.replace(/^@/, '') || undefined,
        avatarUri: apiChatInfo?.avatar_url ?? undefined,
      },
    ].sort((a, b) => a.id.localeCompare(b.id));
  }, [isGroup, group, apiChatInfo, currentUser, isAIChat]);

  const gamePayloads = useMemo<GameMessagePayload[]>(
    () => extractGamePayloads(messages),
    [messages],
  );

  /**
   * The group's ordinary conversation, for the room's chat strip.
   *
   * Game events and system notices are dropped: the room already renders the
   * game, and repeating it as chat lines would be the same information twice.
   * Everything here has been decrypted by the chat screen already — the room
   * never sees ciphertext, and never sends any either.
   */
  const gameChat = useMemo<GameChatMessage[]>(
    () =>
      messages
        .filter((m) => !m.system && !m.attachment && !m.deletedAt && m.text)
        .slice(-60)
        .map((m) => ({
          id: m.id,
          text: m.text,
          fromMe: m.fromMe,
          senderName: m.fromMe ? t('game.chat_you') : m.senderName ?? '',
          // Matched by id, not by name: two members can share a display name,
          // which in a game about whose turn it is would be the worst place
          // to guess.
          senderUsername: gamePlayers.find((p) => p.id === m.senderId)?.username,
        })),
    [messages, gamePlayers],
  );

  /**
   * Opened straight from the room, via `?game=1`.
   *
   * The game runs on this screen's message stream, so the room cannot host it
   * — it would need a second, unsynchronised copy. It sends people here
   * instead.
   *
   * Waits for the players: arriving before the chat has loaded would refuse a
   * game that is perfectly playable a second later. Once the chat is known and
   * still cannot seat two, say so — the route was a promise of a game, and
   * doing nothing at all is how the old games failed.
   */
  const gameRouteHandled = useRef(false);
  useEffect(() => {
    if (openGame !== '1' || gameRouteHandled.current) return;
    if (gamePlayers.length >= 2) {
      gameRouteHandled.current = true;
      setGameOpen(true);
      return;
    }
    if (!apiChatInfo) return; // chat not loaded yet
    if (isGroup && !group) return; // members still arriving
    gameRouteHandled.current = true;
    appAlert(t('game.title'), t('game.need_two'));
  }, [openGame, gamePlayers.length, apiChatInfo, isGroup, group]);

  const sendGame = (payload: GameMessagePayload) => {
    // The invite bubble and the engine share the same message shape; the
    // engine payload already carries kind/game plus its action fields.
    sendAttachment({
      ...payload,
      name: t('game.title'),
      tagline: t('game.round_of', { round: 1, max: MAX_ROUNDS }),
      color: '#6366F1',
      icon: 'dice',
    });
  };

  const handlePlayGame = () => {
    if (gamePlayers.length < 2) {
      appAlert(t('game.title'), t('game.need_two'));
      return;
    }
    setGameOpen(true);
  };

  // Mark a view-once message as opened. On a real backend this would also
  // fire an event to the bridge so the sender sees "Opened".
  /**
   * Open a limited-view message, consuming one of its opens.
   *
   * This used to flip a local flag and nothing else, so reopening the chat
   * showed the message sealed again and the limit meant nothing. The server
   * is the only place that can count: a client that tracks its own opens is
   * a client that can decide not to.
   */
  /**
   * Encrypt a message body for this conversation, or refuse to send it.
   *
   * Every kind of message goes through here, not just text. Media was the
   * worse case: uploadEncryptedMedia encrypts the file bytes with a per-file
   * key and that key travels inside the body — so a body sent in the clear
   * handed the server the ciphertext and the key to it in the same request.
   * Two comments in the codebase asserted the body was "itself E2E encrypted
   * for the peer"; it was not, and 10 of 23 media messages in the database
   * had a readable file key.
   *
   * Groups take the sender-key path: one symmetric key per member, sealed to
   * the others over the pairwise session. See data/crypto/group-session.
   */
  const encryptForChat = async (
    chatId: string,
    chat: ChatDTO | null | undefined,
    body: string,
  ): Promise<string> => {
    // Cheap after the first call: publishing is gated on when it last
    // succeeded. It used to run in full on every send, which is where the
    // delay before a direct message moved came from.
    await ensureKeysPublished();

    if (chat?.type === 'group') {
      // Forwarding targets a chat other than the one on screen, so the
      // members cannot be taken from the loaded group.
      const members =
        chatId === id && group?.members?.length
          ? group.members.map((m) => ({
              user_id: m.id,
              username: m.username.replace(/^@/, ''),
            }))
          : ((await getGroup(chatId)).members ?? []).map((m: GroupMemberDTO) => ({
              user_id: m.user_id,
              username: m.username,
            }));
      if (members.length === 0) throw new E2EEUnavailable('peer_unknown');
      return encryptForGroup(chatId, body, members, await groupEpoch(chatId));
    }

    if (!chat?.peer_user_id) throw new E2EEUnavailable('peer_unknown');
    return encryptForPeerOrFail(chat.peer_user_id, body, {
      peerUsername: chat.peer_username,
    });
  };

  const encryptBody = (body: string): Promise<string> =>
    encryptForChat(id ?? '', apiChatInfo, body);

  /**
   * Messages opened during this visit to the screen.
   *
   * Deliberately not persisted and deliberately not the same thing as the
   * server's "spent". Spent says the allowance is gone; this says the
   * content is on screen right now. Leaving the chat closes it again, which
   * is what a view-once message is for.
   */
  const [revealed, setRevealed] = useState<Set<string>>(new Set());

  const handleViewOnce = (msgId: string) => {
    const serverId = serverMessageId(msgId);
    if (!id || serverId == null) {
      setRevealed((prev) => new Set(prev).add(msgId));
      return;
    }
    openLimitedMessage(id, serverId)
      .then(({ views_left }) => {
        // Revealed first, then marked spent: the tap has to show something.
        setRevealed((prev) => new Set(prev).add(msgId));
        void markCachedMessageOpened(msgId, views_left ?? 0);
        setMessages((prev) =>
          prev.map((m) =>
            m.id === msgId
              ? { ...m, viewed: (views_left ?? 0) <= 0, viewsLeft: views_left ?? 0 }
              : m,
          ),
        );
      })
      .catch((err) => {
        // 410 means it was already used up — show it as spent rather than
        // as an error, because that is what happened.
        const code = err instanceof ApiError ? err.code : '';
        if (code === 'views_exhausted') {
          setMessages((prev) =>
            prev.map((m) => (m.id === msgId ? { ...m, viewed: true, viewsLeft: 0 } : m)),
          );
          appAlert(t('chat.view_once_spent_title'), t('chat.view_once_spent_body'));
          return;
        }
        appAlert(t('chats.action_failed_title'), t('chats.action_failed_body'));
      });
  };

  const hasDraft = draft.trim().length > 0;
  const memberCount = group?.members.length ?? (chat?.memberCount ?? 0);

  const closeSearch = () => {
    setSearchMode(false);
    setQuery('');
  };

  /**
   * Attach and camera, as one group so the theme can put them on either side
   * of the input. `attachSide` was a knob the creator offered and the composer
   * ignored — the icons were hardcoded to the right whatever it said.
   */
  const attachControls = (
    <>
      {canCompose ? (
        <Pressable
          hitSlop={8}
          style={layout.attachSide === 'left' ? styles.composerLeft : styles.composerRight}
          onPress={() => setShowAttach(true)}
          accessibilityLabel={t('chat.attach')}
        >
          <AppIcon slot="attach" size={22} color={colors.textSecondary} />
        </Pressable>
      ) : null}
      {canCompose && !hasDraft ? (
        <Pressable
          hitSlop={8}
          style={layout.attachSide === 'left' ? styles.composerLeft : styles.composerRight}
          onPress={openCamera}
          accessibilityLabel={t('chat.camera')}
        >
          <AppIcon slot="camera" size={22} color={colors.textSecondary} />
        </Pressable>
      ) : null}
    </>
  );

  return (
    <SafeAreaView style={[styles.safe, { backgroundColor: colors.background }]} edges={['top', 'bottom']}>
      <StatusBar style={isDark ? 'light' : 'dark'} />

      {/* Selection-mode header replaces both the normal and the search header
          while messages are selected. Search and selection are mutually
          exclusive — entering selection cancels search. */}
      {/*
        The header floats over the thread rather than sitting above it.

        Glass is only worth anything over something that moves: a blur of a
        flat colour is that same flat colour. So the messages scroll
        underneath, and the list is padded by the height measured here —
        which has to be measured rather than assumed, because the search and
        selection headers are not the same height as the normal one.

        The layout is the same whether or not glass is on. When it is off the
        backdrop is opaque and covers the thread exactly as the old in-flow
        header did, which is what keeps this one code path instead of two.
      */}
      <View
        style={styles.headerFloat}
        onLayout={(e) => setHeaderH(e.nativeEvent.layout.height)}
      >
        <GlassSurface
          color={colors.surface}
          style={StyleSheet.absoluteFill}
          pointerEvents="none"
        />
        {selectionMode ? (
          <View style={[styles.header, { borderBottomColor: colors.divider }]}>
            <Pressable
              onPress={clearSelection}
              hitSlop={12}
              style={({ pressed }) => [styles.backBtn, pressed && { backgroundColor: colors.surfaceMuted }]}
              accessibilityLabel={t('chat.cancel')}
            >
              <Ionicons name="close" size={22} color={colors.text} />
            </Pressable>
            <Text style={[styles.peerName, { color: colors.text, flex: 1 }]} numberOfLines={1}>
              {t('chat.selected_count', { count: selectedIds.size })}
            </Text>
            <View style={styles.headerActions}>
              <Pressable
                hitSlop={8}
                style={styles.iconBtn}
                onPress={bulkCopy}
                accessibilityLabel={t('chat.copy')}
              >
                <Ionicons name="copy-outline" size={20} color={colors.text} />
              </Pressable>
              <Pressable
                hitSlop={8}
                style={styles.iconBtn}
                onPress={bulkForward}
                accessibilityLabel={t('chat.forward')}
              >
                <Ionicons name="arrow-redo-outline" size={20} color={colors.text} />
              </Pressable>
              <Pressable
                hitSlop={8}
                style={styles.iconBtn}
                onPress={bulkDelete}
                accessibilityLabel={t('chat.delete')}
              >
                <Ionicons name="trash-outline" size={20} color={colors.danger} />
              </Pressable>
            </View>
          </View>
        ) : (
        <StateTransition transitionKey={searchMode}>
        {searchMode ? (
          <View style={[styles.header, { borderBottomColor: colors.divider }]}>
            <Pressable
              onPress={closeSearch}
              hitSlop={12}
              style={styles.backBtn}
              accessibilityLabel={t('chat.close_search')}
            >
              <Ionicons name="chevron-back" size={24} color={colors.text} />
            </Pressable>
            <View style={[styles.searchField, { backgroundColor: colors.surfaceMuted }]}>
              <Ionicons name="search" size={16} color={colors.textMuted} />
              <TextInput
                value={query}
                onChangeText={setQuery}
                placeholder={t('chat.search_placeholder')}
                placeholderTextColor={colors.textMuted}
                autoFocus
                style={[styles.searchInput, { color: colors.text }]}
              />
              {trimmedQuery.length > 0 ? (
                <Pressable onPress={() => setQuery('')} hitSlop={8}>
                  <Ionicons name="close-circle" size={18} color={colors.textMuted} />
                </Pressable>
              ) : null}
            </View>
          </View>
        ) : (
          <View style={[styles.header, { borderBottomColor: colors.divider }]}>
            <Pressable
              onPress={() => router.back()}
              hitSlop={12}
              style={({ pressed }) => [
                styles.backBtn,
                pressed && [styles.iconBtnPressed, { backgroundColor: colors.surfaceMuted }],
              ]}
            >
              <Ionicons name="chevron-back" size={24} color={colors.text} />
            </Pressable>

            <Pressable
              style={styles.peer}
              hitSlop={6}
              onPress={() => router.push(`/chat-info/${id!}`)}
              accessibilityRole="button"
              accessibilityLabel={isGroup ? t('chat_info.group_title') : t('chat_info.title')}
            >
              <View>
                <Image
                  source={{ uri: chat?.avatarUri || apiChatInfo?.avatar_url }}
                  style={[styles.peerAvatar, { backgroundColor: colors.surfaceMuted }]}
                  contentFit="cover"
                />
                {(chat?.online) && !isGroup ? (
                  <View
                    style={[
                      styles.peerOnlineDot,
                      { backgroundColor: colors.success, borderColor: colors.surface },
                    ]}
                  />
                ) : null}
              </View>
              <View style={styles.peerInfo}>
                <Text style={[styles.peerName, { color: colors.text }]} numberOfLines={1}>
                  {chat?.name || apiChatInfo?.title || 'Chat'}
                </Text>
                <View style={styles.peerStatusRow}>
                  <Text style={[styles.peerStatus, { color: colors.textSecondary }]} numberOfLines={1}>
                    {isAIChat
                      ? t('chat.ai_subtitle')
                      : isGroup
                        ? t('group.members_count', { count: memberCount })
                        : chat?.online
                          ? t('chats.online')
                          : t('chats.last_seen')}
                  </Text>
                </View>
              </View>
            </Pressable>

            <View style={styles.headerActions}>
              <Pressable
                hitSlop={8}
                style={styles.iconBtn}
                onPress={() => setSearchMode(true)}
                accessibilityLabel={t('chat.search')}
              >
                <Ionicons name="search" size={20} color={colors.text} />
              </Pressable>
              {!isAIChat ? (
                <Pressable
                  hitSlop={8}
                  style={styles.iconBtn}
                  onPress={() => router.push(`/call/${id!}?mode=voice`)}
                  accessibilityLabel={t('hangout.open')}
                >
                  <Ionicons name="home" size={20} color={colors.text} />
                </Pressable>
              ) : null}
              {isGroup ? (
                <Pressable
                  hitSlop={8}
                  style={styles.iconBtn}
                  onPress={() => router.push(`/chat-info/${id!}`)}
                  accessibilityLabel={t('chat_info.group_title')}
                >
                  <Ionicons name="ellipsis-vertical" size={20} color={colors.text} />
                </Pressable>
              ) : (
                <>
                  <Pressable
                    hitSlop={8}
                    style={styles.iconBtn}
                    onPress={() => router.push(`/call/${id!}?mode=video`)}
                    accessibilityLabel={t('call.video_call')}
                  >
                    <Ionicons name="videocam-outline" size={22} color={colors.text} />
                  </Pressable>
                  <Pressable
                    hitSlop={8}
                    style={styles.iconBtn}
                    onPress={() => router.push(`/call/${id!}?mode=voice`)}
                    accessibilityLabel={t('call.voice_call')}
                  >
                    <Ionicons name="call-outline" size={20} color={colors.text} />
                  </Pressable>
                </>
              )}
            </View>
          </View>
        )}

        </StateTransition>
        )}
      </View>

      <KeyboardAvoidingView style={styles.flex} behavior="padding">
        <View style={[styles.thread, { backgroundColor: chrome.wallpaper || colors.surfaceMuted }]}>
          {chrome.wallpaperImage ? (
            <Image
              source={{ uri: chrome.wallpaperImage }}
              style={StyleSheet.absoluteFillObject}
              contentFit="cover"
              blurRadius={layout.wallpaperBlur ? 12 : 0}
            />
          ) : null}
          {/* Over the photo, under the dim: the movement is part of the
              wallpaper, so it gets darkened along with it. `info` is the
              second hue on purpose — it is a token a pack can set, which is
              the only handle a theme author has on what the aurora does. */}
          <AnimatedWallpaper
            animation={layout.wallpaperAnimation}
            tint={colors.primary}
            accent={colors.info}
          />
          {chrome.wallpaperImage || layout.wallpaperDim > 0 ? (
            <View
              pointerEvents="none"
              style={[
                StyleSheet.absoluteFillObject,
                {
                  backgroundColor: `rgba(0,0,0,${
                    chrome.wallpaperImage ? layout.wallpaperDim / 100 : 0
                  })`,
                },
              ]}
            />
          ) : null}
          <StateTransition transitionKey={searchMode} style={styles.flex}>
          <FlatList
            ref={listRef}
            data={grouped}
            keyExtractor={(item) => item.id}
            renderItem={({ item }) =>
              item.call ? (
                // A call is neither a bubble nor a divider: it is a row you
                // can act on, and while the call is running that action is
                // "join" rather than "call back".
                <CallRow
                  chatId={id!}
                  callId={item.call.callId}
                  mode={item.call.mode}
                  entry={callLog[item.call.callId]}
                  fromMe={item.fromMe}
                  timestamp={item.timestamp}
                />
              ) : item.system ? (
                <SystemDivider
                  msg={item}
                  mine={item.fromMe}
                  peerName={chat?.name ?? ''}
                  onPressDisappearing={pickDisappearing}
                />
              ) : (
                <Bubble
                  msg={item}
                  isGroup={isGroup}
                  query={searching ? trimmedQuery : ''}
                  reactions={reactionsMap[item.id] ?? []}
                  onOpenMedia={openViewer}
                  selectionMode={selectionMode}
                  selected={selectedIds.has(item.id)}
                  onToggleSelect={toggleSelect}
                  onOpenMenu={openMenu}
                  onReact={handleReact}
                  onReply={replyFromSwipe}
                  onVote={handleVote}
                  onPlay={handlePlayGame}
                  onViewOnce={handleViewOnce}
                  revealed={revealed}
                />
              )
            }
            contentContainerStyle={[styles.threadContent, { paddingTop: headerH + Spacing.md }]}
            keyboardShouldPersistTaps="handled"
            ListHeaderComponent={
              searchMode ? null : (
                <View style={styles.threadHeader}>
                  {isGroup && group ? (
                    <HistoryBanner
                      enabled={group.historyEnabled}
                      viewOnly={group.historyMode === 'view-only'}
                      shown={visible.filter((m) => m.historical).length}
                      limit={group.historyLimit}
                    />
                  ) : layout.datePillStyle === 'hidden' ? null : (
                    <View
                      style={[
                        styles.dayPill,
                        layout.datePillStyle === 'text' && { backgroundColor: 'transparent' },
                        layout.datePillStyle === 'pill' && {
                          backgroundColor: chrome.datePillBg || colors.surface,
                        },
                        !layout.centerDatePills && { alignSelf: 'flex-start' },
                      ]}
                    >
                      <Text style={[styles.dayPillText, { color: chrome.datePillText || colors.textSecondary }]}>
                        {t('chat.today')}
                      </Text>
                    </View>
                  )}
                  <View style={[styles.e2eNotice, { backgroundColor: colors.surface }]}>
                    <Ionicons
                      name={isAIChat ? 'sparkles' : 'lock-closed'}
                      size={11}
                      color={colors.textSecondary}
                    />
                    <Text style={[styles.e2eNoticeText, { color: colors.textSecondary }]}>
                      {isAIChat ? t('chat.ai_disclaimer') : t('chat.encrypted_notice')}
                    </Text>
                  </View>
                </View>
              )
            }
            ListFooterComponent={
              dandaraTyping || (peerTyping && layout.showTypingDots !== false) ? (
                <TypingBubble recording={peerActivity === 'recording'} />
              ) : null
            }
            ListEmptyComponent={
              searching ? (
                <EmptyState
                  icon="search-outline"
                  title={t('chat.search_empty_title')}
                  description={t('chat.search_empty', { query: trimmedQuery })}
                />
              ) : null
            }
          />
          </StateTransition>
        </View>

        {searchMode ? null : (
          <View
            style={[
              styles.composerWrap,
              {
                ...(layout.composerStyle === 'floating'
                  ? { marginHorizontal: 10, marginBottom: 8, borderRadius: 20, overflow: 'hidden' as const }
                  : layout.composerStyle === 'flat'
                    ? { borderTopWidth: 0 }
                    : null),
                // The backdrop is a sibling of the rows, so the bar has to do
                // the clipping the background used to do for itself.
                ...(layout.glassChrome ? { overflow: 'hidden' as const } : null),
              },
            ]}
          >
            {/* Solid when glass is off — the composer never goes see-through
                by accident, only when the theme asks for it. */}
            <GlassSurface
              color={chrome.composerBg || colors.surfaceMuted}
              style={StyleSheet.absoluteFill}
              pointerEvents="none"
            />
            {/* Pending / blocked friend-request banner */}
            {isBlocked ? (
              <View style={[styles.pendingBanner, { backgroundColor: colors.surface, borderTopColor: colors.divider }]}>
                <Ionicons name="ban-outline" size={18} color={colors.danger} />
                <Text style={[styles.pendingText, { color: colors.textSecondary }]} numberOfLines={2}>
                  {t('friend_request.declined')}
                </Text>
              </View>
            ) : isPending ? (
              <View style={[styles.pendingBanner, { backgroundColor: colors.surface, borderTopColor: colors.divider }]}>
                <Ionicons name="time-outline" size={18} color={colors.warning} />
                <Text style={[styles.pendingText, { color: colors.textSecondary }]} numberOfLines={2}>
                  {iSentRequest
                    ? hasMyIntro
                      ? t('friend_request.sent_waiting')
                      : // The chat row exists the moment it is opened, but
                        // nothing has reached the other person until an intro
                        // message is sent. Claiming "request sent" before that
                        // announced something that had not happened.
                        t('friend_request.write_intro')
                    : t('friend_request.pending_for_you')}
                </Text>
                {!iSentRequest ? (
                  <View style={styles.pendingActions}>
                    <Pressable
                      onPress={handleDeclineRequest}
                      style={({ pressed }) => [
                        styles.acceptBtn,
                        { backgroundColor: colors.surfaceMuted },
                        pressed && { opacity: 0.85 },
                      ]}
                    >
                      <Text style={[styles.acceptBtnText, { color: colors.text }]}>
                        {t('friend_request.decline')}
                      </Text>
                    </Pressable>
                    <Pressable
                      onPress={handleAcceptRequest}
                      style={({ pressed }) => [
                        styles.acceptBtn,
                        { backgroundColor: colors.primary },
                        pressed && { opacity: 0.85 },
                      ]}
                    >
                      <Text style={[styles.acceptBtnText, { color: colors.onPrimary }]}>
                        {t('friend_request.accept')}
                      </Text>
                    </Pressable>
                  </View>
                ) : null}
              </View>
            ) : null}

            {/* Dandara suggestion chips — before the first message */}
            {isAIChat && recordPhase === 'idle' && !messages.some((m) => m.fromMe) ? (
              <ScrollView
                horizontal
                showsHorizontalScrollIndicator={false}
                keyboardShouldPersistTaps="handled"
                contentContainerStyle={styles.suggestRow}
              >
                {dandaraSuggestions().map((s) => (
                  <Pressable
                    key={s}
                    onPress={() => submitText(s)}
                    style={({ pressed }) => [
                      styles.suggestChip,
                      { backgroundColor: colors.surface, borderColor: colors.border },
                      pressed && { opacity: 0.7 },
                    ]}
                  >
                    <Ionicons name="sparkles-outline" size={13} color={colors.primary} />
                    <Text style={[styles.suggestChipText, { color: colors.text }]} numberOfLines={1}>
                      {s}
                    </Text>
                  </Pressable>
                ))}
              </ScrollView>
            ) : null}

            {/* Editing bar — mutually exclusive with reply */}
            {editingMsgId && recordPhase === 'idle' ? (
              <View style={[styles.replyBar, { backgroundColor: colors.surface, borderTopColor: colors.divider }]}>
                <Ionicons name="create-outline" size={18} color={colors.primary} />
                <View style={styles.replyBarContent}>
                  <Text style={[styles.replyBarName, { color: colors.primary }]} numberOfLines={1}>
                    {t('chat.editing')}
                  </Text>
                </View>
                <Pressable onPress={cancelEdit} hitSlop={10}>
                  <Ionicons name="close" size={18} color={colors.textMuted} />
                </Pressable>
              </View>
            ) : null}

            {/* Reply preview bar — hidden while recording or editing */}
            {!editingMsgId && replyTarget && recordPhase === 'idle' ? (
              <View style={[styles.replyBar, { backgroundColor: colors.surface, borderTopColor: colors.divider }]}>
                <View style={[styles.replyBarStripe, { backgroundColor: colors.primary }]} />
                <View style={styles.replyBarContent}>
                  <Text style={[styles.replyBarName, { color: colors.primary }]} numberOfLines={1}>
                    {replyTarget.fromMe ? t('chat.you') : replyTarget.senderName ?? chat?.name ?? apiChatInfo?.title ?? 'Chat'}
                  </Text>
                  <View style={styles.replySnippetRow}>
                    {replyIcon(replyTarget) ? (
                      <Ionicons name={replyIcon(replyTarget)} size={13} color={colors.textSecondary} />
                    ) : null}
                    <Text style={[styles.replyBarText, { color: colors.textSecondary }]} numberOfLines={1}>
                      {replySnippet(replyTarget)}
                    </Text>
                  </View>
                </View>
                <Pressable onPress={() => setReplyTarget(null)} hitSlop={10}>
                  <Ionicons name="close" size={18} color={colors.textMuted} />
                </Pressable>
              </View>
            ) : null}

            {/* Composer row */}
            <View style={styles.composerRow}>
              {recordPhase === 'idle' ? (
                <View style={[styles.composer, { backgroundColor: colors.surface }]}>
                  <Pressable
                    hitSlop={8}
                    style={styles.composerLeft}
                    disabled={!canCompose}
                    onPress={() => {
                      Haptics.selectionAsync().catch(() => {});
                      setShowStickers((v) => !v);
                    }}
                    accessibilityRole="button"
                    accessibilityLabel={t('stickers.title')}
                  >
                    <Ionicons
                      name={showStickers ? 'close-outline' : 'happy-outline'}
                      size={22}
                      color={canCompose ? colors.textSecondary : colors.textMuted}
                    />
                  </Pressable>
                  {layout.attachSide === 'left' ? attachControls : null}
                  <TextInput
                    ref={composerInputRef}
                    value={draft}
                    onChangeText={setDraft}
                    placeholder={
                      !canCompose
                        ? iSentRequest
                          ? t('friend_request.waiting_placeholder')
                          : isBlocked
                            ? t('friend_request.declined')
                            : t('friend_request.pending_for_you')
                        : isPending && iSentRequest
                          ? t('friend_request.introduce_placeholder')
                          : t('chat.composer_placeholder')
                    }
                    placeholderTextColor={colors.textMuted}
                    multiline
                    editable={canCompose}
                    style={[styles.composerInput, { color: canCompose ? colors.text : colors.textMuted }]}
                  />
                  {layout.attachSide === 'right' ? attachControls : null}
                </View>
              ) : (
                <RecordingStrip
                  phase={recordPhase}
                  elapsedSec={elapsedSec}
                  dragX={dragX}
                  recExit={recExit}
                  onTrashPress={cancelRecording}
                />
              )}

              {canCompose ? (
                recordPhase === 'locked' ? (
                  <Pressable
                    onPress={finishRecording}
                    style={({ pressed }) => [
                      styles.sendBtn,
                      { backgroundColor: colors.primary, shadowColor: colors.primary },
                      pressed && styles.sendBtnPressed,
                    ]}
                    accessibilityLabel={t('chat.send')}
                  >
                    <AppIcon slot="send" size={22} color={colors.onPrimary} />
                  </Pressable>
                ) : hasDraft ? (
                  <Pressable
                    onPress={handleSend}
                    style={({ pressed }) => [
                      styles.sendBtn,
                      { backgroundColor: colors.primary, shadowColor: colors.primary },
                      pressed && styles.sendBtnPressed,
                    ]}
                    accessibilityLabel={t('chat.send')}
                  >
                    <AppIcon slot="send" size={22} color={colors.onPrimary} />
                  </Pressable>
                ) : (
                  <View style={styles.micWrap}>
                    {recordPhase === 'recording' ? <MicHalo halo={micHalo} /> : null}
                    {recordPhase === 'recording' ? <LockIndicator dragY={dragY} /> : null}
                    <GestureDetector gesture={recordGesture}>
                      <Animated.View
                        accessibilityLabel={t('chat.record_voice')}
                        style={[
                          styles.sendBtn,
                          { backgroundColor: colors.primary, shadowColor: colors.primary },
                          micStyle,
                        ]}
                      >
                        <AppIcon slot="mic" size={22} color={colors.onPrimary} />
                      </Animated.View>
                    </GestureDetector>
                  </View>
                )
              ) : null}
            </View>

            {/* Full-screen editor for any picked photo or video */}
            <MediaEditor
              asset={editorAsset}
              mode={editorMode}
              onCancel={() => {
                setEditorAsset(null);
                setPendingAsset(null);
              }}
              onDone={handleEditorDone}
            />

            {/* Sticker tray, docked under the composer like the keyboard */}
            <StickerPicker
              visible={showStickers && canCompose}
              onPick={sendSticker}
              height={320}
            />
          </View>
        )}
      </KeyboardAvoidingView>

      {/* iOS-style reaction & context menu */}
      {menuTarget ? (
        <ReactionMenu
          target={menuTarget}
          isGroup={isGroup}
          reactions={reactionsMap[menuTarget.msg.id] ?? []}
          onReact={reactFromMenu}
          onReply={replyFromMenu}
          onCopy={copyFromMenu}
          onForward={forwardFromMenu}
          onEdit={editFromMenu}
          onDelete={deleteFromMenu}
          onSelect={selectFromMenu}
          onSaveSticker={toggleSavedSticker}
          stickerSaved={isStickerSaved(menuTarget.msg)}
          onInfo={() => {
            const mid = serverMessageId(menuTarget.msg.id);
            closeMenu();
            if (mid) setInfoMessageId(mid);
          }}
          onClose={closeMenu}
        />
      ) : null}

      {/* Fullscreen photo / video */}
      {viewerStart !== null ? (
        <MediaViewer
          items={galleryItems}
          startIndex={viewerStart}
          onClose={() => setViewerStart(null)}
          onReply={replyFromViewer}
          onForward={forwardFromViewer}
        />
      ) : null}

      {/* Who received and read this message */}
      {id ? (
        <MessageInfoSheet
          chatId={id}
          messageId={infoMessageId}
          onClose={() => setInfoMessageId(null)}
        />
      ) : null}

      {/* Truth or Dare room — fullscreen game layered over the chat */}
      {isGroup && (
        <GameRoom
          visible={gameOpen}
          onClose={() => setGameOpen(false)}
          players={gamePlayers}
          payloads={gamePayloads}
          meId={meId ?? null}
          onSend={sendGame}
          chat={gameChat}
          // The room's composer is the chat's composer. Same path, same
          // encryption — the game adds no way to send anything in the clear.
          onSendText={submitText}
        />
      )}

      {/* Delete confirmation */}
      <DeleteMessageModal
        targets={deleteTargets}
        onCancel={() => setDeleteTargets([])}
        onConfirm={confirmDelete}
      />

      {/* Forward to another chat */}
      <ForwardPicker
        count={forwardTargets.length}
        excludeChatId={id}
        onClose={() => setForwardTargets([])}
        onPick={forwardTo}
        onPickStory={forwardTargets.length === 1 ? forwardToStory : undefined}
      />

      {/* Attachment menu */}
      <AttachSheet
        visible={showAttach}
        onClose={() => setShowAttach(false)}
        onPick={handleAttachPick}
      />

      {/* Attachment compose sheets */}
      <AttachmentComposer
        kind={composeKind}
        onClose={() => setComposeKind(null)}
        onSend={sendAttachment}
      />
    </SafeAreaView>
  );
}

/**
 * A centred notice about the conversation itself.
 *
 * It used to render one hardcoded string regardless of the message, so every
 * system event in every chat read "you joined".
 *
 * The disappearing notice is tappable, and says so. Announcing a change to
 * what happens to everything written afterwards, while making the person go
 * hunting through a settings screen to answer it, is only half a message.
 */
function SystemDivider({
  msg,
  mine,
  peerName,
  onPressDisappearing,
}: {
  msg: GroupedMessage;
  mine: boolean;
  peerName: string;
  onPressDisappearing?: () => void;
}) {
  const { colors } = useTheme();
  const ev = msg.systemEvent;

  if (ev?.kind === 'disappearing') {
    const who = mine ? t('chat.you') : peerName;
    const label =
      ev.seconds === 0
        ? t('chat.disappearing_off_notice', { name: who })
        : t('chat.disappearing_on_notice', {
            name: who,
            duration: t(`chat_info.disappear_${ev.seconds}` as never),
          });
    return (
      <Pressable onPress={onPressDisappearing} style={styles.systemRow}>
        <View style={[styles.systemPill, { backgroundColor: colors.surface }]}>
          <Ionicons name="timer-outline" size={11} color={colors.primary} />
          <Text style={[styles.systemText, { color: colors.textSecondary }]}>
            {label}{' '}
            <Text style={{ color: colors.primary }}>{t('chat.tap_to_change')}</Text>
          </Text>
        </View>
      </Pressable>
    );
  }

  return (
    <View style={styles.systemRow}>
      <View style={[styles.systemPill, { backgroundColor: colors.surface }]}>
        <Ionicons name="person-add" size={11} color={colors.textSecondary} />
        <Text style={[styles.systemText, { color: colors.textSecondary }]}>
          {t('chat.joined')}
        </Text>
      </View>
    </View>
  );
}

function HistoryBanner({
  enabled,
  viewOnly,
  shown,
  limit,
}: {
  enabled: boolean;
  viewOnly: boolean;
  shown: number;
  limit: number;
}) {
  const { colors } = useTheme();
  if (!enabled) {
    return (
      <View style={[styles.historyBanner, { backgroundColor: colors.surface }]}>
        <Ionicons name="eye-off-outline" size={13} color={colors.textSecondary} />
        <Text style={[styles.historyBannerText, { color: colors.textSecondary }]}>
          {t('chat.history_off')}
        </Text>
      </View>
    );
  }
  const allShown = limit === Infinity;
  return (
    <View style={[styles.historyBanner, { backgroundColor: colors.surface }]}>
      <Ionicons name="time-outline" size={13} color={colors.textSecondary} />
      <Text style={[styles.historyBannerText, { color: colors.textSecondary }]}>
        {allShown
          ? t('chat.history_banner_all')
          : t('chat.history_banner', { count: shown })}
        {viewOnly ? `  ·  ${t('chat.history_view_only')}` : ''}
      </Text>
    </View>
  );
}

function HighlightedText({
  text,
  query,
  mentions,
  style,
  highlight,
  mentionColor,
}: {
  text: string;
  query: string;
  mentions?: string[];
  style: StyleProp<TextStyle>;
  highlight: string;
  mentionColor?: string;
}) {
  const q = (query ?? '').trim().toLowerCase();
  const hasMentions = !!mentions && mentions.length > 0;
  if (!q && !hasMentions) return <Text style={style}>{text}</Text>;

  // 1) Split by mentions first so each "@user" is its own segment we won't recolor.
  const mentionRe = hasMentions ? new RegExp(`@(?:${mentions!.join('|')})\\b`, 'gi') : null;
  type Tok = { text: string; mention?: boolean };
  const tokens: Tok[] = [];
  if (mentionRe) {
    let last = 0;
    let m: RegExpExecArray | null;
    while ((m = mentionRe.exec(text)) !== null) {
      if (m.index > last) tokens.push({ text: text.slice(last, m.index) });
      tokens.push({ text: m[0], mention: true });
      last = m.index + m[0].length;
    }
    if (last < text.length) tokens.push({ text: text.slice(last) });
  } else {
    tokens.push({ text });
  }

  // 2) Within plain tokens, split by search-query matches.
  type Part = { text: string; kind: 'plain' | 'match' | 'mention' };
  const parts: Part[] = [];
  for (const tok of tokens) {
    if (tok.mention) {
      parts.push({ text: tok.text, kind: 'mention' });
      continue;
    }
    if (!q) {
      parts.push({ text: tok.text, kind: 'plain' });
      continue;
    }
    const lower = tok.text.toLowerCase();
    let last = 0;
    let i = lower.indexOf(q, last);
    while (i !== -1) {
      if (i > last) parts.push({ text: tok.text.slice(last, i), kind: 'plain' });
      parts.push({ text: tok.text.slice(i, i + q.length), kind: 'match' });
      last = i + q.length;
      i = lower.indexOf(q, last);
    }
    if (last < tok.text.length) parts.push({ text: tok.text.slice(last), kind: 'plain' });
  }

  return (
    <Text style={style}>
      {parts.map((p, i) =>
        p.kind === 'mention' ? (
          <Text key={i} style={{ color: mentionColor, fontWeight: '700' }}>
            {p.text}
          </Text>
        ) : p.kind === 'match' ? (
          <Text key={i} style={{ backgroundColor: highlight, fontWeight: '700' }}>
            {p.text}
          </Text>
        ) : (
          <Text key={i}>{p.text}</Text>
        ),
      )}
    </Text>
  );
}

// Short remaining-time label for ephemeral / live-location countdowns.
function relativeRemaining(iso?: string): string | null {
  if (!iso) return null;
  const ms = new Date(iso).getTime() - Date.now();
  if (ms <= 0) return '0m';
  const m = Math.floor(ms / 60000);
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h`;
  return `${Math.floor(h / 24)}d`;
}

function MetaRow({ msg, onMedia }: { msg: GroupedMessage; onMedia?: boolean }) {
  const { colors, chat } = useTheme();
  const mine = msg.fromMe;
  const dim = onMedia
    ? '#FFFFFF'
    : mine
      ? chat.metaMine || 'rgba(255,255,255,0.78)'
      : chat.metaTheirs || colors.textMuted;
  const ttl = relativeRemaining(msg.expiresAt);
  return (
    <View style={[styles.metaRow, onMedia && styles.metaOverlay]}>
      {msg.edited ? (
        <Text style={[styles.metaTime, { color: dim }]}>{t('chat.edited')} ·</Text>
      ) : null}
      {ttl ? (
        <View style={styles.metaInline}>
          <Ionicons name="timer-outline" size={11} color={dim} />
          <Text style={[styles.metaTime, { color: dim }]}>{ttl}</Text>
        </View>
      ) : null}
      <Text
        style={[
          styles.metaTime,
          { color: dim },
          mine && !onMedia && styles.metaTimeMine,
          onMedia && styles.metaTimeOnMedia,
        ]}
      >
        {msg.timestamp}
      </Text>
      {mine ? (
        <Ionicons
          name={msg.status === 'read' ? 'checkmark-done' : 'checkmark'}
          size={14}
          color={
            onMedia
              ? '#FFFFFF'
              : msg.status === 'read'
                ? '#9DC1FF'
                : dim
          }
        />
      ) : null}
    </View>
  );
}

function MediaContent({
  media,
  onOpen,
  onLongPress,
}: {
  media: MediaAttachment;
  onOpen?: () => void;
  /**
   * The bubble's long-press. A child Pressable swallows the gesture, so
   * without forwarding it the context menu never opened on media.
   */
  onLongPress?: () => void;
}) {
  const { colors } = useTheme();
  if (media.type === 'video') {
    return (
      <Pressable
        onPress={onOpen}
        onLongPress={onLongPress}
        delayLongPress={260}
        style={[styles.media, { backgroundColor: colors.surfaceMuted }]}
      >
        {/* Video posters would mean downloading the clip, which defeats
            tap-to-download; show a dark plate with the size instead. */}
        <View style={[styles.mediaImage, { backgroundColor: colors.surfaceMuted }]} />
        <View style={styles.videoScrim}>
          <View style={styles.playButton}>
            <Ionicons name="play" size={26} color={colors.text} />
          </View>
        </View>
        <View style={styles.videoBadge}>
          <Ionicons name="videocam" size={12} color="#FFFFFF" />
          <Text style={styles.videoBadgeText}>
            {media.durationSec != null
              ? `${Math.floor(media.durationSec / 60)}:${String(media.durationSec % 60).padStart(2, '0')}`
              : t('chat.video')}
          </Text>
        </View>
      </Pressable>
    );
  }
  return (
    <Pressable
      onPress={onOpen}
      onLongPress={onLongPress}
      delayLongPress={260}
      style={[styles.media, { backgroundColor: colors.surfaceMuted }]}
    >
      <CachedImage
        url={media.uri}
        mediaKey={media.key}
        mime={media.mime}
        sizeBytes={media.sizeBytes}
        style={styles.mediaImage}
        contentFit="cover"
        onLongPress={onLongPress}
      />
    </Pressable>
  );
}

// Voice message bubble — play/pause, waveform progress, duration.
function VoiceMessage({
  uri,
  mediaKey,
  mime,
  durationSec,
  mine,
}: {
  uri: string;
  mediaKey?: MediaAttachment['key'];
  mime?: string;
  durationSec: number;
  mine: boolean;
}) {
  const { colors } = useTheme();

  // Audio has to go through the cache like every other attachment.
  //
  // Handing the remote URL straight to the player looks like it works — the
  // player accepts any string — but /api/media/:id/file needs an
  // Authorization header the player never sends, and the bytes behind it are
  // ciphertext. Locally recorded notes are already a file:// path and play
  // as they are; only fetched ones need resolving.
  const remoteId = uri.startsWith('file://') ? null : mediaIdFromURL(uri);
  const cached = useCacheState(remoteId ?? undefined);
  useEffect(() => {
    if (remoteId) void ensureLocal(remoteId, { key: mediaKey, mime: mime ?? 'audio/mp4' });
  }, [remoteId, mediaKey, mime]);

  const source = remoteId ? (cached.status === 'ready' ? cached.uri : null) : uri;
  const player = useAudioPlayer(source);
  const status = useAudioPlayerStatus(player);

  // Playback rate persists across pause/resume for this bubble.
  const [rate, setRate] = useState(1);
  useEffect(() => {
    player.setPlaybackRate(rate);
  }, [rate, player]);

  const total = status.duration && status.duration > 0 ? status.duration : durationSec || 1;
  const elapsed = status.currentTime;
  const playing = status.playing;
  const progress = total > 0 ? Math.min(1, elapsed / total) : 0;

  useEffect(() => {
    if (status.didJustFinish) {
      player.seekTo(0);
      player.pause();
    }
  }, [status.didJustFinish, player]);

  const toggle = () => {
    if (playing) {
      player.pause();
    } else {
      if (status.didJustFinish || elapsed >= total - 0.05) player.seekTo(0);
      player.play();
    }
  };

  const bars = useMemo(
    () =>
      Array.from(
        { length: VOICE_BARS },
        (_, i) => 0.34 + 0.66 * Math.abs(Math.sin(i * 1.7) * Math.cos(i * 0.55)),
      ),
    [],
  );

  const tint = mine ? colors.onPrimary : colors.text;
  const dim = mine ? 'rgba(255,255,255,0.38)' : colors.border;
  const shownTime = playing || elapsed > 0 ? elapsed : total;

  return (
    <View style={styles.voiceMsg}>
      <Pressable onPress={toggle} hitSlop={8} style={styles.voicePlay}>
        <Ionicons name={playing ? 'pause' : 'play'} size={21} color={tint} />
      </Pressable>
      <View style={styles.voiceWave}>
        {bars.map((h, i) => {
          const active = i / VOICE_BARS <= progress;
          return (
            <View
              key={i}
              style={[styles.voiceBar, { height: 5 + h * 15, backgroundColor: active ? tint : dim }]}
            />
          );
        })}
      </View>
      <Text style={[styles.voiceTime, { color: mine ? 'rgba(255,255,255,0.8)' : colors.textSecondary }]}>
        {formatDuration(shownTime)}
      </Text>
      {/* Tap cycles the rate; long-press drops straight back to 1x. */}
      <Pressable
        onPress={() => setRate((r) => nextSpeed(r))}
        onLongPress={() => setRate(1)}
        hitSlop={8}
        style={[
          styles.speedPill,
          { backgroundColor: mine ? 'rgba(255,255,255,0.22)' : colors.surfaceMuted },
        ]}
        accessibilityLabel={t('viewer.faster')}
      >
        <Text
          style={[
            styles.speedPillText,
            { color: mine ? '#fff' : colors.textSecondary },
          ]}
        >
          {formatSpeed(rate)}
        </Text>
      </Pressable>
    </View>
  );
}

// Pulsing halo behind the mic while recording.
function MicHalo({ halo }: { halo: SharedValue<number> }) {
  const { colors } = useTheme();
  const style = useAnimatedStyle(() => ({
    opacity: interpolate(halo.value, [0, 0.7, 1], [0.4, 0.12, 0], Extrapolation.CLAMP),
    transform: [{ scale: interpolate(halo.value, [0, 1], [1, 2.5]) }],
  }));
  return <Animated.View pointerEvents="none" style={[styles.micHalo, { backgroundColor: colors.primary }, style]} />;
}

// Lock hint pill above the mic — fills as the finger drags up.
function LockIndicator({ dragY }: { dragY: SharedValue<number> }) {
  const { colors } = useTheme();
  const style = useAnimatedStyle(() => ({
    opacity: interpolate(dragY.value, [-32, 0], [1, 0.5], Extrapolation.CLAMP),
    transform: [
      { translateY: interpolate(dragY.value, [-LOCK_THRESHOLD, 0], [-10, 0], Extrapolation.CLAMP) },
      { scale: interpolate(dragY.value, [-LOCK_THRESHOLD, 0], [1.16, 1], Extrapolation.CLAMP) },
    ],
  }));
  return (
    <Animated.View
      pointerEvents="none"
      style={[styles.lockIndicator, { backgroundColor: colors.surface, borderColor: colors.border }, style]}
    >
      <Ionicons name="lock-closed" size={15} color={colors.textSecondary} />
      <Ionicons name="chevron-up" size={11} color={colors.textMuted} />
    </Animated.View>
  );
}

// Recording strip — replaces the input pill while recording or locked.
function RecordingStrip({
  phase,
  elapsedSec,
  dragX,
  recExit,
  onTrashPress,
}: {
  phase: 'recording' | 'locked';
  elapsedSec: number;
  dragX: SharedValue<number>;
  recExit: SharedValue<number>;
  onTrashPress: () => void;
}) {
  const { colors } = useTheme();
  const dot = useSharedValue(1);

  useEffect(() => {
    dot.value = withRepeat(withTiming(0.2, { duration: 550 }), -1, true);
  }, [dot]);

  const dotStyle = useAnimatedStyle(() => ({ opacity: dot.value }));
  const stripStyle = useAnimatedStyle(() => ({
    opacity: 1 - recExit.value,
    transform: [{ translateX: -recExit.value * 90 }],
  }));
  const hintStyle = useAnimatedStyle(() => ({
    opacity: interpolate(dragX.value, [-CANCEL_THRESHOLD, -10, 0], [0, 0.5, 0.7], Extrapolation.CLAMP),
    transform: [{ translateX: Math.max(dragX.value, -70) }],
  }));

  return (
    <Animated.View style={[styles.recStrip, { backgroundColor: colors.surface }, stripStyle]}>
      {phase === 'locked' ? (
        <Pressable onPress={onTrashPress} hitSlop={10} style={styles.recTrash}>
          <Ionicons name="trash-outline" size={21} color={colors.danger} />
        </Pressable>
      ) : null}
      <Animated.View style={[styles.recDot, { backgroundColor: colors.danger }, dotStyle]} />
      <Text style={[styles.recTimer, { color: colors.text }]}>{formatDuration(elapsedSec)}</Text>
      {phase === 'recording' ? (
        <Animated.View style={[styles.recHint, hintStyle]}>
          <Ionicons name="chevron-back" size={16} color={colors.textSecondary} />
          <Text style={[styles.recHintText, { color: colors.textSecondary }]} numberOfLines={1}>
            {t('chat.slide_to_cancel')}
          </Text>
        </Animated.View>
      ) : (
        <Text style={[styles.recHintText, { color: colors.textSecondary, marginLeft: Spacing.sm }]}>
          {t('chat.recording')}
        </Text>
      )}
    </Animated.View>
  );
}

// WhatsApp-style attachment grid — slides up when the paperclip is tapped.
function AttachSheet({
  visible,
  onClose,
  onPick,
}: {
  visible: boolean;
  onClose: () => void;
  onPick: (key: string) => void;
}) {
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  return (
    <Modal transparent animationType="slide" visible={visible} onRequestClose={onClose}>
      <View style={styles.attachOverlay}>
        <Pressable style={StyleSheet.absoluteFill} onPress={onClose} />
        <View
          style={[
            styles.attachSheet,
            { backgroundColor: colors.surfaceElevated, paddingBottom: Math.max(insets.bottom, Spacing.lg) },
          ]}
        >
          <View style={styles.attachHandle}>
            <View style={[styles.attachHandleBar, { backgroundColor: colors.border }]} />
          </View>
          <View style={styles.attachGrid}>
            {ATTACH_ITEMS.map((item) => (
              <Pressable
                key={item.key}
                onPress={() => onPick(item.key)}
                style={({ pressed }) => [styles.attachItem, pressed && { opacity: 0.6 }]}
                accessibilityRole="button"
                accessibilityLabel={t(`chat.attach_${item.key}`)}
              >
                <View style={[styles.attachIcon, { backgroundColor: `${item.color}22` }]}>
                  <Ionicons name={item.icon} size={26} color={item.color} />
                </View>
                <Text style={[styles.attachLabel, { color: colors.textSecondary }]} numberOfLines={1}>
                  {t(`chat.attach_${item.key}`)}
                </Text>
              </Pressable>
            ))}
          </View>
        </View>
      </View>
    </Modal>
  );
}

// Animated dot for Dandara's typing indicator.
function TypingDot({ index }: { index: number }) {
  const { colors } = useTheme();
  const v = useSharedValue(0);
  useEffect(() => {
    v.value = withDelay(index * 160, withRepeat(withTiming(1, { duration: 480 }), -1, true));
  }, [v, index]);
  const style = useAnimatedStyle(() => ({
    opacity: 0.35 + v.value * 0.65,
    transform: [{ translateY: -3 * v.value }],
  }));
  return <Animated.View style={[styles.typingDot, { backgroundColor: colors.textMuted }, style]} />;
}

/**
 * Shown while the other side is composing.
 *
 * `recording` swaps the three dots for a mic and a word. Holding the mic looks
 * identical to typing from here otherwise, and the two mean very different
 * things to whoever is waiting: typing resolves in seconds, a voice note can
 * take a minute.
 */
function TypingBubble({ recording = false }: { recording?: boolean }) {
  const { colors, chat, layout } = useTheme();
  const mineEnd = layout.myBubbleSide === 'right';
  const radii = bubbleRadii(layout, false, true, layout.myBubbleSide);
  return (
    <View
      style={[
        styles.bubbleRow,
        {
          justifyContent: mineEnd ? 'flex-start' : 'flex-end',
          marginBottom: 6,
        },
      ]}
    >
      {layout.avatarPosition !== 'hidden' ? (
        <Image
          source={{ uri: DANDARA.avatarUri }}
          style={[styles.senderAvatar, { backgroundColor: colors.surfaceMuted }]}
          contentFit="cover"
        />
      ) : null}
      <View
        style={[
          styles.bubble,
          styles.typingBubble,
          {
            backgroundColor: chat.bubbleTheirs || colors.surface,
            ...radii,
          },
        ]}
      >
        {recording ? (
          <View style={styles.recordingHint}>
            <Ionicons name="mic" size={14} color={colors.danger} />
            <Text style={[styles.recordingHintText, { color: colors.textSecondary }]}>
              {t('chat.recording_audio')}
            </Text>
          </View>
        ) : (
          <View style={styles.typingDots}>
            <TypingDot index={0} />
            <TypingDot index={1} />
            <TypingDot index={2} />
          </View>
        )}
      </View>
    </View>
  );
}

// Inner content of a chat bubble — shared by the live bubble and the menu clone.
function BubbleBody({
  msg,
  mine,
  isGroup,
  query,
  onVote,
  onPlay,
  onViewOnce,
  revealed,
  onOpenMedia,
  onLongPressMedia,
}: {
  msg: GroupedMessage;
  mine: boolean;
  isGroup: boolean;
  query: string;
  onVote?: (optionId: string) => void;
  onPlay?: () => void;
  onViewOnce?: (msgId: string) => void;
  /** Ids opened during this visit — see the screen's `revealed`. */
  revealed?: Set<string>;
  onOpenMedia?: (msg: Message) => void;
  onLongPressMedia?: () => void;
}) {
  const { colors, chat, metrics, layout } = useTheme();
  const isAudio = msg.media?.type === 'audio';
  const isVisualMedia = !!msg.media && !isAudio;
  const hasAttachment = !!msg.attachment;
  const hasText = msg.text.trim().length > 0;
  const mediaOnly = isVisualMedia && !hasText;
  const showSender = (isGroup || !!msg.isAI) && !mine && msg.isFirstInGroup && !!msg.senderName;
  const bodyColor = mine ? chat.textMine || colors.onPrimary : chat.textTheirs || colors.text;
  const mentionCol = mine ? chat.textMine || colors.onPrimary : colors.primary;

  // Deleted message → italic placeholder, no reactions, no swipe-reply target.
  if (msg.deletedAt) {
    const dim = mine ? chat.metaMine || 'rgba(255,255,255,0.75)' : chat.metaTheirs || colors.textMuted;
    return (
      <View style={styles.deletedRow}>
        <Ionicons name="ban-outline" size={14} color={dim} />
        <Text style={[styles.deletedText, { color: dim }]}>
          {mine ? t('chat.deleted_self') : t('chat.deleted_other')}
        </Text>
        <MetaRow msg={msg} />
      </View>
    );
  }

  // View-once gate.
  //
  // The content shows only while the message is open in this session. It used
  // to be gated on `viewed` alone, which inverted the whole feature: once the
  // view had been spent the flag stayed true, so the message displayed its
  // contents from then on, on every reload, forever. A spent one is closed
  // for good and says so.
  if (msg.viewOnce && !revealed?.has(msg.id)) {
    const spent = !!msg.viewed;
    const accent = mine ? colors.onPrimary : colors.primary;
    const body = (
      <>
        <View style={[styles.viewOnceIcon, { borderColor: accent }, spent && styles.viewOnceSpent]}>
          <Ionicons name={spent ? 'eye-off-outline' : 'eye-outline'} size={18} color={accent} />
        </View>
        <View style={styles.viewOnceText}>
          <Text style={[styles.viewOnceTitle, { color: mine ? colors.onPrimary : colors.text }]}>
            {spent ? t('chat.view_once_opened') : t('chat.view_once')}
          </Text>
          <Text style={[styles.viewOnceHint, { color: mine ? 'rgba(255,255,255,0.75)' : colors.textSecondary }]}>
            {spent ? t('chat.view_once_opened_hint') : t('chat.view_once_tap')}
          </Text>
        </View>
        <MetaRow msg={msg} />
      </>
    );
    // Nothing to tap once it is spent: an affordance that only ever produces
    // "already opened" is an invitation to be disappointed.
    if (spent) return <View style={styles.viewOnceRow}>{body}</View>;
    return (
      <Pressable
        onPress={onViewOnce ? () => onViewOnce(msg.id) : undefined}
        style={styles.viewOnceRow}
        accessibilityRole="button"
        accessibilityLabel={t('chat.view_once_tap')}
      >
        {body}
      </Pressable>
    );
  }

  return (
    <>
      {msg.replyTo ? (
        <View
          style={[
            styles.replyQuote,
            {
              backgroundColor: mine ? 'rgba(0,0,0,0.12)' : colors.surfaceMuted,
              borderLeftColor: mine ? 'rgba(255,255,255,0.55)' : colors.primary,
            },
          ]}
        >
          <Text
            style={[styles.replyQuoteName, { color: mine ? 'rgba(255,255,255,0.9)' : colors.primary }]}
            numberOfLines={1}
          >
            {msg.replyTo.fromMe ? t('chat.you') : msg.replyTo.senderName ?? ''}
          </Text>
          <View style={styles.replySnippetRow}>
            {msg.replyTo.icon ? (
              <Ionicons
                name={msg.replyTo.icon as keyof typeof Ionicons.glyphMap}
                size={12}
                color={mine ? 'rgba(255,255,255,0.7)' : colors.textSecondary}
              />
            ) : null}
            <Text
              style={[styles.replyQuoteText, { color: mine ? 'rgba(255,255,255,0.7)' : colors.textSecondary }]}
              numberOfLines={2}
            >
              {msg.replyTo.text}
            </Text>
          </View>
        </View>
      ) : null}

      {/* Forwarded marker.
          Above the sender name, because it qualifies everything below it:
          what follows is not this person's words. "Many times" is a separate
          label rather than a count — the number is not actionable, the fact
          that it has been round the block is. */}
      {msg.forwardCount && msg.forwardCount > 0 ? (
        <View style={styles.forwardedRow}>
          <Ionicons
            name="arrow-redo-outline"
            size={12}
            color={msg.forwardCount >= FORWARD_MANY ? colors.warning : (mine ? chat.metaMine || 'rgba(255,255,255,0.7)' : colors.textMuted)}
          />
          <Text
            style={[
              styles.forwardedText,
              {
                color:
                  msg.forwardCount >= FORWARD_MANY
                    ? colors.warning
                    : mine
                      ? chat.metaMine || 'rgba(255,255,255,0.7)'
                      : colors.textMuted,
              },
            ]}
          >
            {msg.forwardCount >= FORWARD_MANY
              ? t('chat.forwarded_many')
              : t('chat.forwarded')}
          </Text>
        </View>
      ) : null}

      {/* A forwarded channel post keeps a way back to where it came from.
          Without it, "forwarded" is a dead end: you can see something was
          passed along and have no way to check the source. */}
      {msg.sourceChannelId && msg.sourcePostId ? (
        <Pressable
          onPress={() =>
            router.push(`/channel/${msg.sourceChannelId}?post=${msg.sourcePostId}`)
          }
          hitSlop={6}
          style={styles.forwardedRow}
          accessibilityRole="link"
        >
          <Ionicons name="megaphone-outline" size={12} color={colors.primary} />
          <Text style={[styles.forwardedText, { color: colors.primary }]}>
            {t('chat.open_source_post')}
          </Text>
        </Pressable>
      ) : null}

      {showSender ? (
        <View style={styles.senderRow}>
          {msg.isAI ? <Ionicons name="sparkles" size={11} color={colors.primary} /> : null}
          <Text style={[styles.senderName, { color: colors.primary }]} numberOfLines={1}>
            {msg.senderName}
          </Text>
        </View>
      ) : null}

      {/* "Reencaminhada" label is only shown on *incoming* forwards — when
          I forward something, I already know, so we don't tag my own copy. */}
      {msg.forwarded && !mine ? (
        <View style={styles.forwardedRow}>
          <Ionicons name="arrow-redo-outline" size={12} color={colors.textMuted} />
          <Text style={[styles.forwardedText, { color: colors.textMuted }]}>
            {t('chat.forwarded')}
          </Text>
        </View>
      ) : null}

      {isVisualMedia ? (
        <MediaContent
          media={msg.media!}
          onOpen={() => onOpenMedia?.(msg)}
          onLongPress={onLongPressMedia}
        />
      ) : null}

      {isAudio ? (
        <VoiceMessage
          uri={msg.media!.uri}
          mediaKey={msg.media!.key}
          mime={msg.media!.mime}
          durationSec={msg.media!.durationSec ?? 0}
          mine={mine}
        />
      ) : null}

      {msg.attachment ? (
        <AttachmentBubble
          attachment={msg.attachment}
          mine={mine}
          onVote={onVote}
          onPlay={onPlay}
          onLongPress={onLongPressMedia}
        />
      ) : null}

      {hasText ? (
        <View style={isVisualMedia ? styles.captionWrap : undefined}>
          <HighlightedText
            text={msg.text}
            query={query}
            mentions={msg.mentions}
            highlight={colors.warning}
            mentionColor={mentionCol}
            style={[
              styles.bubbleText,
              {
                color: bodyColor,
                fontSize: metrics.fontSize,
                lineHeight: metrics.lineHeight,
                letterSpacing: metrics.letterSpacing,
                fontWeight: mine && layout.boldOutgoing ? '700' : '400',
              },
            ]}
          />
          <MetaRow msg={msg} />
        </View>
      ) : null}

      {(isAudio || hasAttachment) && !hasText ? <MetaRow msg={msg} /> : null}

      {mediaOnly ? <MetaRow msg={msg} onMedia /> : null}
    </>
  );
}

function Bubble({
  msg,
  isGroup,
  query,
  reactions,
  selectionMode,
  selected,
  onToggleSelect,
  onOpenMenu,
  onReact,
  onReply,
  onVote,
  onPlay,
  onViewOnce,
  revealed,
  onOpenMedia,
}: {
  msg: GroupedMessage;
  isGroup: boolean;
  query: string;
  reactions: ReactionEntry[];
  selectionMode: boolean;
  selected: boolean;
  onToggleSelect: (msgId: string) => void;
  onOpenMenu: (target: MenuTarget) => void;
  onReact: (msgId: string, emoji: string) => void;
  onReply: (msg: GroupedMessage) => void;
  onVote: (msgId: string, optionId: string) => void;
  onPlay?: () => void;
  onViewOnce: (msgId: string) => void;
  revealed: Set<string>;
  onOpenMedia: (msg: Message) => void;
}) {
  const { colors, chat: chrome, layout, metrics } = useTheme();
  const mine = msg.fromMe;
  const isVisualMedia = !!msg.media && msg.media.type !== 'audio';
  const showAvatar =
    layout.avatarPosition !== 'hidden' && (isGroup || !!msg.isAI) && !mine;
  const bubbleRef = useRef<View>(null);
  const translateX = useSharedValue(0);

  const mineEnd = layout.myBubbleSide === 'right';
  // Mine aligns to myBubbleSide; theirs to the opposite.
  const alignEnd = mine ? mineEnd : !mineEnd;
  const radii = bubbleRadii(layout, mine, !!msg.isLastInGroup, layout.myBubbleSide);
  // Stickers float on the thread with no bubble behind them — the shape of
  // the sticker is the message, and a background would box in the alpha.
  const isSticker = msg.attachment?.kind === 'sticker';
  const bubbleBg = isSticker
    ? 'transparent'
    : mine
      ? chrome.bubbleMine || colors.primary
      : chrome.bubbleTheirs || colors.surface;
  const checkOnLeft = layout.selectionCheckSide === 'left';

  // Swipe right to reply — drag the bubble, release past the threshold.
  // Disabled in selection mode (taps toggle selection instead).
  const pan = Gesture.Pan()
    .enabled(!selectionMode && layout.swipeReply)
    .activeOffsetX(14)
    .failOffsetY([-12, 12])
    .onUpdate((e) => {
      translateX.value = Math.min(Math.max(e.translationX, 0), 84);
    })
    .onEnd((e) => {
      if (e.translationX > REPLY_THRESHOLD) runOnJS(onReply)(msg);
      translateX.value = withSpring(0, { damping: 18, stiffness: 220 });
    });

  const swipeStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: translateX.value }],
  }));
  const replyIconStyle = useAnimatedStyle(() => ({
    opacity: interpolate(translateX.value, [12, REPLY_THRESHOLD], [0, 1], Extrapolation.CLAMP),
    transform: [
      { scale: interpolate(translateX.value, [12, REPLY_THRESHOLD], [0.4, 1], Extrapolation.CLAMP) },
    ],
  }));

  const handleLongPress = () => {
    if (msg.deletedAt) return;
    bubbleRef.current?.measureInWindow((x, y, width, height) => {
      if (width > 0 && height > 0) {
        onOpenMenu({ msg, rect: { x, y, width, height }, mine });
      }
    });
  };

  const selectCheck = selectionMode ? (
    <View style={styles.selectCheck}>
      <Ionicons
        name={selected ? 'checkmark-circle' : 'ellipse-outline'}
        size={22}
        color={selected ? colors.primary : colors.textMuted}
      />
    </View>
  ) : null;

  const avatarNode = showAvatar ? (
    msg.isLastInGroup ? (
      <Image
        source={{ uri: msg.senderAvatarUri }}
        style={[styles.senderAvatar, { backgroundColor: colors.surfaceMuted }]}
        contentFit="cover"
      />
    ) : (
      <View style={styles.senderAvatarSpacer} />
    )
  ) : null;

  return (
    <GestureDetector gesture={pan}>
      <Pressable
        onPress={selectionMode ? () => onToggleSelect(msg.id) : undefined}
        style={[
          styles.bubbleRow,
          {
            justifyContent: alignEnd ? 'flex-end' : 'flex-start',
            marginBottom: msg.isLastInGroup ? metrics.rowGap : metrics.groupedGap,
          },
          selectionMode && styles.bubbleRowSelectable,
          selected &&
            layout.selectionHighlight && {
              backgroundColor: chrome.selectionBg || `${colors.primary}14`,
            },
        ]}
      >
        {checkOnLeft ? selectCheck : null}
        {layout.avatarPosition !== 'right' ? avatarNode : null}

        <Animated.View
          style={[
            styles.bubbleGroup,
            {
              alignItems: alignEnd ? 'flex-end' : 'flex-start',
              maxWidth: `${metrics.maxWidthPct}%`,
            },
            swipeStyle,
          ]}
        >
          {/* Swipe-to-reply icon — revealed as the bubble slides right */}
          {layout.swipeReply ? (
            <Animated.View style={[styles.swipeReplyIcon, replyIconStyle]} pointerEvents="none">
              <View style={[styles.swipeReplyCircle, { backgroundColor: colors.surface, borderColor: colors.border }]}>
                <Ionicons name="arrow-undo" size={15} color={colors.primary} />
              </View>
            </Animated.View>
          ) : null}

          <Pressable
            ref={bubbleRef}
            onLongPress={selectionMode ? undefined : handleLongPress}
            onPress={
              selectionMode
                ? () => onToggleSelect(msg.id)
                : // A sticker has no text to select, so a plain tap opens its
                  // actions (save / remove) rather than doing nothing.
                  isSticker
                  ? handleLongPress
                  : undefined
            }
            delayLongPress={260}
            style={[
              styles.bubble,
              {
                backgroundColor: bubbleBg,
                ...radii,
                paddingHorizontal: isSticker ? 0 : metrics.bubblePaddingH,
                paddingTop: isSticker ? 0 : metrics.bubblePaddingV,
                paddingBottom: isSticker ? 0 : metrics.bubblePaddingV - 1,
                opacity: !mine && layout.dimIncoming ? 0.88 : 1,
                ...(layout.bubbleShadow
                  ? {
                      shadowColor: '#000',
                      shadowOpacity: metrics.shadowOpacity,
                      shadowRadius: 5,
                      shadowOffset: { width: 0, height: 1 },
                      elevation: layout.bubbleShadowStrength > 0.3 ? 2 : 0,
                    }
                  : { shadowOpacity: 0, elevation: 0 }),
              },
              isVisualMedia && styles.bubbleWithMedia,
            ]}
          >
            <BubbleBody
              msg={msg}
              mine={mine}
              isGroup={isGroup}
              query={query}
              onVote={(optId) => onVote(msg.id, optId)}
              onPlay={onPlay}
              onViewOnce={onViewOnce}
              revealed={revealed}
              onOpenMedia={onOpenMedia}
              onLongPressMedia={handleLongPress}
            />
          </Pressable>

          {/* Reaction pills */}
          {reactions.length > 0 ? (
            <View style={[styles.reactionPills, alignEnd && styles.reactionPillsMine]}>
              {reactions.map((r) => (
                <Pressable
                  key={r.emoji}
                  onPress={() => onReact(msg.id, r.emoji)}
                  style={[
                    styles.reactionPill,
                    { backgroundColor: colors.surface, borderColor: colors.border },
                    r.mine && { backgroundColor: `${colors.primary}18`, borderColor: `${colors.primary}55` },
                  ]}
                >
                  <Text style={styles.reactionPillEmoji}>{r.emoji}</Text>
                  {r.count > 1 ? (
                    <Text style={[styles.reactionPillCount, { color: r.mine ? colors.primary : colors.textSecondary }]}>
                      {r.count}
                    </Text>
                  ) : null}
                </Pressable>
              ))}
            </View>
          ) : null}
        </Animated.View>

        {layout.avatarPosition === 'right' ? avatarNode : null}
        {!checkOnLeft ? selectCheck : null}
      </Pressable>
    </GestureDetector>
  );
}

// iOS-style focused context menu: blurs the screen, keeps only the tapped
// message crisp, with a reaction bar above and an action menu below.
function ReactionMenu({
  target,
  isGroup,
  reactions,
  onReact,
  onReply,
  onCopy,
  onForward,
  onEdit,
  onDelete,
  onSelect,
  onSaveSticker,
  stickerSaved,
  onInfo,
  onClose,
}: {
  target: MenuTarget;
  isGroup: boolean;
  reactions: ReactionEntry[];
  onReact: (emoji: string) => void;
  onReply: () => void;
  onCopy: () => void;
  onForward: () => void;
  onEdit: () => void;
  onDelete: () => void;
  onSelect: () => void;
  onSaveSticker: () => void;
  stickerSaved: boolean;
  onInfo: () => void;
  onClose: () => void;
}) {
  const { colors, isDark } = useTheme();
  const insets = useSafeAreaInsets();
  const { width: screenW, height: screenH } = Dimensions.get('window');
  const { msg, rect, mine } = target;

  const [visible, setVisible] = useState(true);
  const progress = useSharedValue(0);

  useEffect(() => {
    progress.value = withTiming(1, { duration: 240 });
  }, [progress]);

  const close = () => {
    setVisible(false);
    setTimeout(onClose, 200);
  };

  const hasText = msg.text.trim().length > 0;
  const isVisualMedia = !!msg.media && msg.media.type !== 'audio';
  // Visibility rules — match WhatsApp's conventions.
  const showReply = true;
  const showForward = true;
  const showCopy = hasText;
  // Forwarded messages cannot be edited — even if they're mine, the canonical
  // content lives on the original sender's side.
  const showEdit = mine && hasText && !msg.forwarded;
  const showSelect = true;
  const showDelete = true;
  // Saving works both ways: a sticker someone sent me, and one I sent.
  const showSticker = msg.attachment?.kind === 'sticker';
  // Only the sender can see who read a message, so only offer it there.
  const showInfo = mine && !msg.deletedAt && /^\d+$/.test(msg.id);
  const menuItems =
    Number(showReply) +
    Number(showForward) +
    Number(showCopy) +
    Number(showEdit) +
    Number(showSelect) +
    Number(showSticker) +
    Number(showInfo) +
    Number(showDelete);
  const menuH = menuItems * MENU_ITEM_HEIGHT;
  const menuW = 230;
  const barW = CHAT_REACTIONS.length * 46 + 14;

  // Vertical placement — shift the bubble so the bar and menu stay on-screen.
  const topSafe = insets.top + 8;
  const botSafe = screenH - insets.bottom - 8;
  const minTop = topSafe + REACTION_BAR_HEIGHT + MENU_GAP;
  const maxTop = botSafe - menuH - MENU_GAP - rect.height;
  let bubbleTop = rect.y;
  if (bubbleTop < minTop) bubbleTop = minTop;
  if (bubbleTop > maxTop) bubbleTop = Math.max(minTop, maxTop);
  const shift = bubbleTop - rect.y;

  const clampX = (x: number, w: number) => Math.max(8, Math.min(screenW - w - 8, x));
  const barLeft = clampX(mine ? rect.x + rect.width - barW : rect.x, barW);
  const menuLeft = clampX(mine ? rect.x + rect.width - menuW : rect.x, menuW);
  const barTop = bubbleTop - MENU_GAP - REACTION_BAR_HEIGHT;
  const menuTop = bubbleTop + rect.height + MENU_GAP;

  const bubbleStyle = useAnimatedStyle(() => ({
    transform: [
      { translateY: interpolate(progress.value, [0, 1], [0, shift]) },
      { scale: interpolate(progress.value, [0, 1], [1, 1.03]) },
    ],
  }));
  const barStyle = useAnimatedStyle(() => ({
    opacity: interpolate(progress.value, [0.1, 0.7], [0, 1], Extrapolation.CLAMP),
    transform: [
      { scale: interpolate(progress.value, [0.1, 1], [0.6, 1], Extrapolation.CLAMP) },
      { translateY: interpolate(progress.value, [0, 1], [12, 0]) },
    ],
  }));
  const menuStyle = useAnimatedStyle(() => ({
    opacity: interpolate(progress.value, [0.2, 0.85], [0, 1], Extrapolation.CLAMP),
    transform: [
      { scale: interpolate(progress.value, [0.2, 1], [0.82, 1], Extrapolation.CLAMP) },
      { translateY: interpolate(progress.value, [0, 1], [-10, 0]) },
    ],
  }));

  const myEmoji = reactions.find((r) => r.mine)?.emoji ?? null;

  return (
    <Modal transparent statusBarTranslucent animationType="fade" visible={visible} onRequestClose={close}>
      {/* Frosted backdrop */}
      <Animated.View style={StyleSheet.absoluteFill} entering={FadeIn.duration(160)}>
        <BlurView
          intensity={isDark ? 90 : 80}
          tint={isDark ? 'dark' : 'light'}
          style={StyleSheet.absoluteFill}
        />
        <View
          style={[
            StyleSheet.absoluteFill,
            { backgroundColor: isDark ? 'rgba(0,0,0,0.6)' : 'rgba(0,0,0,0.4)' },
          ]}
        />
      </Animated.View>
      <Pressable style={StyleSheet.absoluteFill} onPress={close} />

      {/* Reaction bar */}
      <Animated.View
        style={[
          styles.menuBar,
          { backgroundColor: colors.surface, top: barTop, left: barLeft, width: barW },
          barStyle,
        ]}
      >
        {CHAT_REACTIONS.map((emoji) => {
          const active = myEmoji === emoji;
          return (
            <Pressable
              key={emoji}
              onPress={() => {
                onReact(emoji);
                close();
              }}
              style={({ pressed }) => [
                styles.menuBarBtn,
                active && { backgroundColor: `${colors.primary}22` },
                pressed && { transform: [{ scale: 1.22 }] },
              ]}
            >
              <Text style={styles.menuBarEmoji}>{emoji}</Text>
            </Pressable>
          );
        })}
      </Animated.View>

      {/* Cloned message bubble — stays crisp above the blur */}
      <Animated.View
        pointerEvents="none"
        style={[
          styles.bubble,
          mine
            ? [styles.bubbleMine, styles.bubbleMineTail, { backgroundColor: colors.primary }]
            : [styles.bubbleTheirs, styles.bubbleTheirsTail, { backgroundColor: colors.surface }],
          isVisualMedia && styles.bubbleWithMedia,
          { position: 'absolute', left: rect.x, top: rect.y, width: rect.width },
          bubbleStyle,
        ]}
      >
        <BubbleBody msg={msg} mine={mine} isGroup={isGroup} query="" />
      </Animated.View>

      {/* Context menu */}
      <Animated.View
        style={[
          styles.menuCard,
          { backgroundColor: colors.surface, top: menuTop, left: menuLeft, width: menuW },
          menuStyle,
        ]}
      >
        {(
          [
            { show: showReply, label: t('chat.reply'), icon: 'arrow-undo-outline', onPress: onReply, destructive: false },
            { show: showForward, label: t('chat.forward'), icon: 'arrow-redo-outline', onPress: onForward, destructive: false },
            { show: showCopy, label: t('chat.copy'), icon: 'copy-outline', onPress: onCopy, destructive: false },
            { show: showEdit, label: t('chat.edit'), icon: 'create-outline', onPress: onEdit, destructive: false },
            { show: showSelect, label: t('chat.select'), icon: 'checkmark-circle-outline', onPress: onSelect, destructive: false },
            {
              show: showSticker,
              label: stickerSaved ? t('stickers.remove_sticker') : t('stickers.save_sticker'),
              icon: stickerSaved ? 'heart-dislike-outline' : 'heart-outline',
              onPress: onSaveSticker,
              destructive: false,
            },
            {
              show: showInfo,
              label: t('chat.message_info'),
              icon: 'information-circle-outline',
              onPress: onInfo,
              destructive: false,
            },
            { show: showDelete, label: t('chat.delete'), icon: 'trash-outline', onPress: onDelete, destructive: true },
          ] as const
        )
          .filter((it) => it.show)
          .map((it, i, arr) => (
            <View key={it.label}>
              <Pressable
                onPress={() => {
                  it.onPress();
                  close();
                }}
                style={({ pressed }) => [styles.menuItem, pressed && { backgroundColor: colors.surfaceMuted }]}
              >
                <Text
                  style={[
                    styles.menuItemText,
                    { color: it.destructive ? colors.danger : colors.text },
                  ]}
                >
                  {it.label}
                </Text>
                <Ionicons
                  name={it.icon as keyof typeof Ionicons.glyphMap}
                  size={18}
                  color={it.destructive ? colors.danger : colors.text}
                />
              </Pressable>
              {i < arr.length - 1 ? (
                <View style={[styles.menuSep, { backgroundColor: colors.divider }]} />
              ) : null}
            </View>
          ))}
      </Animated.View>
    </Modal>
  );
}

// Confirmation modal for deleting one or many messages.
// "Delete for everyone" only shows when ALL targets are own.
function DeleteMessageModal({
  targets,
  onCancel,
  onConfirm,
}: {
  targets: Message[];
  onCancel: () => void;
  onConfirm: (scope: 'me' | 'all') => void;
}) {
  const { colors } = useTheme();
  if (targets.length === 0) return null;
  const allMine = targets.every((t) => t.fromMe);
  const count = targets.length;
  const title =
    count > 1 ? t('chat.delete_count_title', { count }) : t('chat.delete_confirm_title');
  return (
    <Modal transparent animationType="fade" visible={count > 0} onRequestClose={onCancel}>
      <View style={styles.dimOverlay}>
        <Pressable style={StyleSheet.absoluteFill} onPress={onCancel} />
        <View style={[styles.deleteCard, { backgroundColor: colors.surface, borderColor: colors.border }]}>
          <View style={[styles.deleteIcon, { backgroundColor: `${colors.danger}1F` }]}>
            <Ionicons name="trash-outline" size={22} color={colors.danger} />
          </View>
          <Text style={[styles.deleteTitle, { color: colors.text }]}>{title}</Text>
          <View style={styles.deleteActions}>
            {allMine ? (
              <Pressable
                onPress={() => onConfirm('all')}
                style={({ pressed }) => [
                  styles.deleteBtn,
                  { backgroundColor: colors.danger, borderColor: colors.danger },
                  pressed && { opacity: 0.85 },
                ]}
              >
                <Text style={[styles.deleteBtnText, { color: '#FFFFFF' }]}>
                  {t('chat.delete_for_everyone')}
                </Text>
              </Pressable>
            ) : null}
            <Pressable
              onPress={() => onConfirm('me')}
              style={({ pressed }) => [
                styles.deleteBtn,
                { borderColor: colors.border },
                pressed && { backgroundColor: colors.surfaceMuted },
              ]}
            >
              <Text style={[styles.deleteBtnText, { color: colors.text }]}>
                {t('chat.delete_for_me')}
              </Text>
            </Pressable>
            <Pressable
              onPress={onCancel}
              style={({ pressed }) => [
                styles.deleteBtn,
                { borderColor: 'transparent' },
                pressed && { opacity: 0.7 },
              ]}
            >
              <Text style={[styles.deleteBtnText, { color: colors.textSecondary }]}>
                {t('chat.cancel')}
              </Text>
            </Pressable>
          </View>
        </View>
      </View>
    </Modal>
  );
}

// Sheet to pick a destination chat for one or more forwarded messages.

const styles = StyleSheet.create({
  safe: { flex: 1 },
  flex: { flex: 1 },
  fallback: { ...Typography.body, padding: Spacing.xl },

  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: Spacing.sm,
    paddingRight: Spacing.md,
    paddingVertical: Spacing.sm,
    gap: Spacing.xs,
    borderBottomWidth: 1,
  },
  backBtn: {
    width: 36,
    height: 36,
    borderRadius: Radii.pill,
    alignItems: 'center',
    justifyContent: 'center',
  },
  iconBtn: {
    width: 36,
    height: 36,
    borderRadius: Radii.pill,
    alignItems: 'center',
    justifyContent: 'center',
  },
  iconBtnPressed: { opacity: 0.6 },
  peer: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
  },
  peerAvatar: {
    width: 40,
    height: 40,
    borderRadius: Radii.pill,
  },
  peerOnlineDot: {
    position: 'absolute',
    right: 0,
    bottom: 0,
    width: 11,
    height: 11,
    borderRadius: Radii.pill,
    borderWidth: 2,
  },
  peerInfo: { flex: 1 },
  peerName: { ...Typography.bodyStrong, fontSize: 16 },
  peerStatus: { ...Typography.caption },
  peerStatusRow: { flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 1 },
  headerActions: { flexDirection: 'row', gap: 2 },

  searchField: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
    borderRadius: Radii.pill,
    paddingHorizontal: Spacing.md,
    height: 40,
  },
  searchInput: {
    flex: 1,
    ...Typography.body,
    fontSize: 15,
    padding: 0,
  },

  headerFloat: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    // Above the thread, which is declared after it in the tree.
    zIndex: 10,
  },
  thread: { flex: 1 },
  threadContent: {
    paddingHorizontal: Spacing.md,
    paddingTop: Spacing.md,
    paddingBottom: Spacing.lg,
  },
  threadHeader: {
    alignItems: 'center',
    gap: Spacing.sm,
    marginBottom: Spacing.md,
  },
  dayPill: {
    paddingHorizontal: Spacing.md,
    paddingVertical: 4,
    borderRadius: Radii.pill,
  },
  dayPillText: {
    ...Typography.micro,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  e2eNotice: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: Spacing.sm,
    paddingVertical: 3,
    borderRadius: Radii.sm,
    maxWidth: '88%',
  },
  e2eNoticeText: {
    ...Typography.micro,
    fontSize: 10,
  },
  historyBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: Spacing.md,
    paddingVertical: 6,
    borderRadius: Radii.md,
    maxWidth: '92%',
  },
  historyBannerText: {
    ...Typography.micro,
    flex: 1,
  },

  systemRow: {
    alignItems: 'center',
    marginVertical: Spacing.sm,
  },
  systemPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingHorizontal: Spacing.md,
    paddingVertical: 5,
    borderRadius: Radii.pill,
  },
  systemText: {
    ...Typography.micro,
    fontWeight: '600',
  },

  bubbleRow: {
    flexDirection: 'row',
    marginBottom: 6,
    alignItems: 'flex-end',
    gap: 6,
  },
  bubbleRowGrouped: { marginBottom: 2 },
  bubbleRowMine: { justifyContent: 'flex-end' },
  bubbleRowTheirs: { justifyContent: 'flex-start' },
  bubbleGroup: { alignItems: 'flex-start', maxWidth: '82%' },
  bubbleGroupMine: { alignItems: 'flex-end' },

  swipeReplyIcon: {
    position: 'absolute',
    left: -44,
    top: 0,
    bottom: 0,
    width: 36,
    alignItems: 'center',
    justifyContent: 'center',
  },
  swipeReplyCircle: {
    width: 34,
    height: 34,
    borderRadius: Radii.pill,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: StyleSheet.hairlineWidth,
  },

  replyQuote: {
    borderLeftWidth: 3,
    borderRadius: Radii.sm,
    paddingHorizontal: 8,
    paddingVertical: 5,
    marginBottom: 5,
    gap: 2,
  },
  replyQuoteName: { ...Typography.micro, fontWeight: '700' },
  replyQuoteText: { ...Typography.micro, lineHeight: 16, flex: 1 },
  replySnippetRow: { flexDirection: 'row', alignItems: 'center', gap: 4 },

  reactionPills: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 4,
    marginTop: -6,
    paddingBottom: 4,
    paddingLeft: 4,
  },
  reactionPillsMine: { justifyContent: 'flex-end', paddingLeft: 0, paddingRight: 4 },
  reactionPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    paddingHorizontal: 7,
    paddingVertical: 3,
    borderRadius: Radii.pill,
    borderWidth: 1,
    shadowColor: '#000',
    shadowOpacity: 0.06,
    shadowRadius: 3,
    shadowOffset: { width: 0, height: 1 },
    elevation: 1,
  },
  reactionPillEmoji: { fontSize: 13 },
  reactionPillCount: { ...Typography.micro, fontWeight: '600' },

  menuBar: {
    position: 'absolute',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-around',
    height: REACTION_BAR_HEIGHT,
    borderRadius: Radii.pill,
    paddingHorizontal: 6,
    shadowColor: '#000',
    shadowOpacity: 0.18,
    shadowRadius: 16,
    shadowOffset: { width: 0, height: 6 },
    elevation: 10,
  },
  menuBarBtn: {
    width: 44,
    height: 44,
    borderRadius: Radii.pill,
    alignItems: 'center',
    justifyContent: 'center',
  },
  menuBarEmoji: { fontSize: 27 },

  menuCard: {
    position: 'absolute',
    borderRadius: Radii.lg,
    overflow: 'hidden',
    shadowColor: '#000',
    shadowOpacity: 0.18,
    shadowRadius: 16,
    shadowOffset: { width: 0, height: 6 },
    elevation: 10,
  },
  menuItem: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: Spacing.md,
    height: MENU_ITEM_HEIGHT,
  },
  menuItemText: { ...Typography.body, fontSize: 15 },
  menuSep: { height: StyleSheet.hairlineWidth },

  senderAvatar: {
    width: 26,
    height: 26,
    borderRadius: Radii.pill,
  },
  senderAvatarSpacer: { width: 26 },
  bubble: {
    paddingHorizontal: 11,
    paddingTop: 7,
    paddingBottom: 6,
    borderRadius: 16,
  },
  bubbleWithMedia: {
    padding: 4,
    overflow: 'hidden',
  },
  bubbleMine: {},
  bubbleMineTail: {
    borderBottomRightRadius: 4,
  },
  bubbleTheirs: {
    shadowColor: '#000',
    shadowOpacity: 0.04,
    shadowRadius: 4,
    shadowOffset: { width: 0, height: 1 },
    elevation: 1,
  },
  bubbleTheirsTail: {
    borderBottomLeftRadius: 4,
  },
  senderName: {
    ...Typography.caption,
    fontWeight: '700',
  },
  senderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    marginBottom: 1,
  },
  bubbleText: {
    ...Typography.body,
    fontSize: 15,
    lineHeight: 20,
  },
  captionWrap: {
    paddingHorizontal: 7,
    paddingTop: 5,
    paddingBottom: 1,
  },

  metaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-end',
    gap: 3,
    marginTop: 2,
  },
  metaInline: { flexDirection: 'row', alignItems: 'center', gap: 2 },

  // Deleted message placeholder.
  deletedRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 4,
  },
  deletedText: { ...Typography.caption, fontStyle: 'italic', flexShrink: 1 },

  // View-once sealed UI.
  viewOnceRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
    paddingVertical: 4,
    minWidth: 200,
  },
  viewOnceIcon: {
    width: 38,
    height: 38,
    borderRadius: Radii.pill,
    borderWidth: 1.5,
    alignItems: 'center',
    justifyContent: 'center',
  },
  viewOnceText: { flex: 1, gap: 1 },
  // Spent: still legible, visibly no longer a thing you can open.
  viewOnceSpent: { opacity: 0.45 },
  viewOnceTitle: { ...Typography.caption, fontWeight: '700' },
  viewOnceHint: { ...Typography.micro },
  metaOverlay: {
    position: 'absolute',
    right: 10,
    bottom: 10,
    backgroundColor: 'rgba(0,0,0,0.4)',
    paddingHorizontal: 7,
    paddingVertical: 2,
    borderRadius: Radii.pill,
    marginTop: 0,
  },
  metaTime: {
    ...Typography.micro,
    fontSize: 10.5,
  },
  metaTimeMine: { color: 'rgba(255,255,255,0.85)' },
  metaTimeOnMedia: { color: '#FFFFFF' },

  media: {
    width: 232,
    height: 232,
    borderRadius: 13,
    overflow: 'hidden',
  },
  mediaImage: { width: '100%', height: '100%' },
  videoScrim: {
    ...StyleSheet.absoluteFillObject,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(0,0,0,0.18)',
  },
  playButton: {
    width: 54,
    height: 54,
    borderRadius: Radii.pill,
    backgroundColor: 'rgba(255,255,255,0.92)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  videoBadge: {
    position: 'absolute',
    left: 8,
    top: 8,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: 'rgba(0,0,0,0.5)',
    paddingHorizontal: 7,
    paddingVertical: 3,
    borderRadius: Radii.pill,
  },
  videoBadgeText: {
    ...Typography.micro,
    color: '#FFFFFF',
    fontSize: 10.5,
    fontWeight: '600',
  },

  composerWrap: {
    flexDirection: 'column',
  },
  composerRow: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: Spacing.sm,
    paddingHorizontal: Spacing.sm,
    paddingTop: Spacing.sm,
    paddingBottom: Spacing.sm,
  },
  replyBar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  replyBarStripe: {
    width: 3,
    height: 34,
    borderRadius: Radii.pill,
    flexShrink: 0,
  },
  replyBarContent: { flex: 1, gap: 2 },
  replyBarName: { ...Typography.caption, fontWeight: '700' },
  replyBarText: { ...Typography.caption, flex: 1 },
  composer: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    borderRadius: 24,
    paddingHorizontal: 6,
    paddingVertical: 4,
    minHeight: 48,
    shadowColor: '#000',
    shadowOpacity: 0.04,
    shadowRadius: 4,
    shadowOffset: { width: 0, height: 1 },
    elevation: 1,
  },
  composerLeft: {
    width: 38,
    height: 38,
    borderRadius: Radii.pill,
    alignItems: 'center',
    justifyContent: 'center',
  },
  composerRight: {
    width: 36,
    height: 38,
    borderRadius: Radii.pill,
    alignItems: 'center',
    justifyContent: 'center',
  },
  composerInput: {
    flex: 1,
    minHeight: 40,
    maxHeight: 120,
    paddingVertical: 8,
    paddingHorizontal: 4,
    ...Typography.body,
    fontSize: 15,
  },
  sendBtn: {
    width: 48,
    height: 48,
    borderRadius: Radii.pill,
    alignItems: 'center',
    justifyContent: 'center',
    shadowOpacity: 0.3,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 3 },
    elevation: 4,
  },
  sendBtnPressed: {
    transform: [{ scale: 0.94 }],
  },

  // ── Voice message bubble ─────────────────────────────────────────────────────
  voiceMsg: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
    paddingVertical: 2,
    minWidth: 196,
  },
  voicePlay: {
    width: 32,
    height: 32,
    alignItems: 'center',
    justifyContent: 'center',
  },
  voiceWave: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 2,
    height: 22,
  },
  voiceBar: {
    flex: 1,
    borderRadius: Radii.pill,
  },
  speedPill: {
    paddingHorizontal: 7,
    paddingVertical: 2,
    borderRadius: Radii.pill,
    marginLeft: 6,
  },
  speedPillText: { ...Typography.micro, fontWeight: '700' },
  voiceTime: {
    ...Typography.micro,
    fontVariant: ['tabular-nums'],
  },

  // ── Voice recording ──────────────────────────────────────────────────────────
  micWrap: {
    width: 48,
    height: 48,
    alignItems: 'center',
    justifyContent: 'center',
  },
  micHalo: {
    position: 'absolute',
    width: 48,
    height: 48,
    borderRadius: Radii.pill,
  },
  lockIndicator: {
    position: 'absolute',
    bottom: 58,
    width: 38,
    height: 52,
    borderRadius: Radii.pill,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 3,
    paddingVertical: 6,
    borderWidth: StyleSheet.hairlineWidth,
    shadowColor: '#000',
    shadowOpacity: 0.12,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 3 },
    elevation: 4,
  },
  recStrip: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
    borderRadius: 24,
    paddingHorizontal: Spacing.md,
    minHeight: 48,
    shadowColor: '#000',
    shadowOpacity: 0.04,
    shadowRadius: 4,
    shadowOffset: { width: 0, height: 1 },
    elevation: 1,
  },
  recTrash: {
    width: 32,
    height: 32,
    alignItems: 'center',
    justifyContent: 'center',
  },
  recDot: {
    width: 9,
    height: 9,
    borderRadius: Radii.pill,
  },
  recTimer: {
    ...Typography.body,
    fontSize: 15,
    fontVariant: ['tabular-nums'],
    minWidth: 42,
  },
  recHint: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 2,
  },
  recHintText: {
    ...Typography.caption,
  },

  // ── Attachment menu ──────────────────────────────────────────────────────────
  attachOverlay: {
    flex: 1,
    justifyContent: 'flex-end',
    backgroundColor: 'rgba(0,0,0,0.5)',
  },
  attachSheet: {
    borderTopLeftRadius: Radii.xl,
    borderTopRightRadius: Radii.xl,
    paddingHorizontal: Spacing.sm,
  },
  attachHandle: {
    alignItems: 'center',
    paddingTop: Spacing.sm,
    paddingBottom: Spacing.sm,
  },
  attachHandleBar: {
    width: 36,
    height: 4,
    borderRadius: Radii.pill,
  },
  attachGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
  },
  attachItem: {
    width: '25%',
    alignItems: 'center',
    gap: Spacing.sm,
    paddingVertical: Spacing.md,
  },
  attachIcon: {
    width: 60,
    height: 60,
    borderRadius: Radii.lg,
    alignItems: 'center',
    justifyContent: 'center',
  },
  attachLabel: {
    ...Typography.caption,
    textAlign: 'center',
  },

  // ── Dandara AI ───────────────────────────────────────────────────────────────
  typingBubble: {
    paddingVertical: 11,
    paddingHorizontal: 14,
  },
  recordingHint: { flexDirection: 'row', alignItems: 'center', gap: Spacing.xs },
  recordingHintText: { ...Typography.caption },
  typingDots: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
  },
  typingDot: {
    width: 7,
    height: 7,
    borderRadius: Radii.pill,
  },
  suggestRow: {
    flexDirection: 'row',
    gap: Spacing.sm,
    paddingHorizontal: Spacing.md,
    paddingTop: Spacing.sm,
  },
  suggestChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingHorizontal: Spacing.md,
    paddingVertical: 8,
    borderRadius: Radii.pill,
    borderWidth: 1,
  },
  suggestChipText: {
    ...Typography.caption,
    fontWeight: '600',
    maxWidth: 210,
  },

  // ── Delete confirm modal ────────────────────────────────────────────────────
  dimOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.45)',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: Spacing.xl,
  },
  deleteCard: {
    width: '100%',
    borderRadius: Radii.xl,
    borderWidth: 1,
    padding: Spacing.lg,
    alignItems: 'center',
    gap: Spacing.sm,
  },
  deleteIcon: {
    width: 48,
    height: 48,
    borderRadius: Radii.pill,
    alignItems: 'center',
    justifyContent: 'center',
  },
  deleteTitle: { ...Typography.h3, textAlign: 'center', marginBottom: Spacing.xs },
  deleteActions: { width: '100%', gap: Spacing.sm },
  deleteBtn: {
    paddingVertical: Spacing.sm + 2,
    borderRadius: Radii.pill,
    borderWidth: 1.5,
    alignItems: 'center',
  },
  deleteBtnText: { ...Typography.caption, fontWeight: '700' },


  // ── Selection mode ──────────────────────────────────────────────────────────
  bubbleRowSelectable: { paddingLeft: 4, paddingRight: 4, borderRadius: Radii.md },
  selectCheck: {
    width: 28,
    alignItems: 'center',
    justifyContent: 'center',
    alignSelf: 'center',
  },

  // ── Forwarded indicator ─────────────────────────────────────────────────────
  forwardedRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    marginBottom: 2,
  },
  forwardedText: {
    ...Typography.micro,
    fontStyle: 'italic',
  },

  pendingBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
    paddingHorizontal: Spacing.lg,
    paddingVertical: Spacing.sm + 2,
    borderTopWidth: 1,
  },
  pendingText: {
    ...Typography.caption,
    flex: 1,
  },
  pendingActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.xs,
  },
  acceptBtn: {
    paddingHorizontal: Spacing.md + 2,
    paddingVertical: Spacing.xs + 2,
    borderRadius: Radii.pill,
  },
  acceptBtnText: {
    ...Typography.caption,
    fontWeight: '700',
  },
});
