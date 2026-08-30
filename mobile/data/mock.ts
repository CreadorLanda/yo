import type { StoryReactionCount } from '@/data/story-reactions';

const dicebear = (style: string, seed: string, bg: string) =>
  `https://api.dicebear.com/9.x/${style}/png?seed=${encodeURIComponent(seed)}&backgroundColor=${bg.replace('#', '')}&size=200`;

const robohash = (seed: string, set: 'set1' | 'set2' | 'set3' | 'set4' | 'set5') =>
  `https://robohash.org/${encodeURIComponent(seed)}.png?set=${set}&size=200x200`;

export type ChatPreview = {
  id: string;
  name: string;
  username: string;
  avatarUri: string;
  lastMessage: string;
  timestamp: string;
  unreadCount: number;
  online: boolean;
  /**
   * The peer's user id, for a direct chat.
   *
   * Carried so a generated avatar is seeded on the *person* rather than the
   * conversation: the same face in the chat list, in search and in a group
   * member list. Seeding on the chat id would give somebody a different face
   * in every place you met them.
   */
  peerUserId?: string;
  pinned?: boolean;
  /** Per-user mute — notifications suppressed for this chat. */
  muted?: boolean;
  isGroup?: boolean;
  memberCount?: number;
  /** True for the Dandara AI assistant chat. */
  isAI?: boolean;
  /** Pending friend request chat */
  isPending?: boolean;
};

/** The Dandara AI assistant — her own chat plus an in-chat helper. */
export const DANDARA = {
  id: 'dandara',
  name: 'Dandara',
  avatarUri: robohash('Dandara Assistant', 'set1'),
} as const;

export const CHATS: ChatPreview[] = [
  {
    id: 'dandara',
    name: 'Dandara',
    username: '@dandara',
    avatarUri: DANDARA.avatarUri,
    lastMessage: 'Pergunta-me o que quiseres — estou aqui para ajudar.',
    timestamp: '09:50',
    unreadCount: 0,
    online: true,
    pinned: true,
    isAI: true,
  },
  {
    id: 'c1',
    name: 'ninani.eth',
    username: '@ninani',
    avatarUri: dicebear('avataaars', 'ninani', 'FFD93D'),
    lastMessage: 'Just sent the contract address — let me know if you can sign it tonight.',
    timestamp: '09:42',
    unreadCount: 2,
    online: true,
    pinned: true,
  },
  {
    id: 'c2',
    name: 'Samuel Garu',
    username: '@samgaru',
    avatarUri: dicebear('big-smile', 'Samuel Garu', '4ADE80'),
    lastMessage: 'Yeah let’s do Sat afternoon, I’ll book the studio.',
    timestamp: '09:31',
    unreadCount: 0,
    online: true,
  },
  {
    id: 'c3',
    name: 'Dr7e7t8696c7bb4...',
    username: '@dr7e7t',
    avatarUri: robohash('Dr7e7t8696c7bb4', 'set1'),
    lastMessage: 'Mango_Apes #4839 just sold for 12.4 ETH 🚀',
    timestamp: '09:14',
    unreadCount: 5,
    online: false,
  },
  {
    id: 'c4',
    name: 'Anthony (Web3.io)',
    username: '@anthony',
    avatarUri: dicebear('adventurer', 'Anthony', '818CF8'),
    lastMessage: 'voice message · 0:24',
    timestamp: 'Yesterday',
    unreadCount: 0,
    online: false,
  },
  {
    id: 'c5',
    name: 'k&8.eth',
    username: '@k8eth',
    avatarUri: dicebear('lorelei', 'k8eth', 'FF6FB5'),
    lastMessage: 'Pulled up to your studio, buzz me',
    timestamp: 'Yesterday',
    unreadCount: 0,
    online: false,
  },
  {
    id: 'c6',
    name: 'Margareth Joanne C.',
    username: '@margcaramel',
    avatarUri: dicebear('micah', 'Margareth Joanne', '22D3EE'),
    lastMessage: 'MARG_CARAMEL_ART #2839 — minted 💎',
    timestamp: 'Yesterday',
    unreadCount: 0,
    online: false,
  },
  {
    id: 'c7',
    name: 'Joe Felix',
    username: '@joefelix',
    avatarUri: dicebear('pixel-art', 'Joe Felix', '818CF8'),
    lastMessage: 'Aloha y’all',
    timestamp: 'Mon',
    unreadCount: 0,
    online: false,
  },
  {
    id: 'g1',
    name: 'Web3 Builders',
    username: '@web3builders',
    avatarUri: dicebear('shapes', 'Web3 Builders', '818CF8'),
    lastMessage: 'Welcome aboard — scroll up to catch the thread.',
    timestamp: '08:55',
    unreadCount: 3,
    online: false,
    isGroup: true,
    memberCount: 6,
  },
];

export type MediaAttachment = {
  type: 'image' | 'video' | 'audio';
  uri: string;
  durationSec?: number;
  /** Per-file key when the blob is end-to-end encrypted. */
  key?: { key: string; nonce: string } | null;
  /** True media type; the wire type is opaque for encrypted blobs. */
  mime?: string;
  /** Shown on the placeholder so the user knows before downloading. */
  sizeBytes?: number;
};

/** Rich attachments composed from the chat attachment menu. */
export type MessageAttachment =
  | {
      kind: 'document';
      name: string;
      ext: string;
      sizeLabel: string;
      /** Server path, so the row can fetch it on demand. */
      url?: string;
      key?: { key: string; nonce: string } | null;
      mime?: string;
    }
  | {
      kind: 'location';
      place: string;
      address: string;
      /** Live (continuously updated) location — shows a pulsing dot and expiry countdown. */
      live?: boolean;
      /** ISO timestamp when the live share expires (only meaningful when live=true). */
      expiresAt?: string;
    }
  | { kind: 'contact'; name: string; detail: string; avatarUri?: string }
  | {
      kind: 'sticker';
      uri: string;
      animated?: boolean;
      width?: number;
      height?: number;
    }
  | {
      kind: 'poll';
      question: string;
      multi: boolean;
      options: { id: string; text: string; votes: number; voted?: boolean }[];
    }
  | {
      kind: 'event';
      title: string;
      day: number;
      month: string;
      weekday: string;
      time: string;
      location?: string;
    }
  | {
      kind: 'game';
      name: string;
      tagline: string;
      color: string;
      icon: string;
      /** Truth or Dare engine payload — present on real game messages. */
      game?: 'truth-or-dare';
      action?: 'start' | 'choose' | 'challenge' | 'done' | 'end';
      seed?: string;
      maxRounds?: number;
      playerId?: string;
      choice?: 'truth' | 'dare';
      text?: string;
      winnerId?: string;
    };

export type Message = {
  /** 0 when written here; 1+ once passed along. Drives the forwarded label. */
  forwardCount?: number;
  /** A forwarded channel post keeps a way back to where it came from. */
  sourceChannelId?: string;
  sourcePostId?: string;
  id: string;
  text: string;
  fromMe: boolean;
  timestamp: string;
  status?: 'sending' | 'sent' | 'delivered' | 'read' | 'failed';
  media?: MediaAttachment;
  /** Display name of the sender — shown in group threads for incoming messages. */
  senderName?: string;
  /**
   * Who sent it. Display names are not unique inside a group, so anything
   * that has to match a message to a member — the game room's chat, for one —
   * needs the id rather than the name.
   */
  senderId?: string;
  senderAvatarUri?: string;
  /** True for messages sent before the current user joined the group. */
  historical?: boolean;
  /** Renders as a centered system notice instead of a bubble. */
  system?: boolean;
  /**
   * What the notice is about.
   *
   * The divider used to render one hardcoded string no matter what the
   * message said, so every system event in every chat read "you joined".
   */
  systemEvent?:
    | { kind: 'joined' }
    | { kind: 'disappearing'; seconds: number; actorId: string };
  replyTo?: { id: string; text: string; fromMe: boolean; senderName?: string; icon?: string };
  /**
   * The message this one answers, as the server knows it.
   *
   * `replyTo` above is the rendered quote and can only be built once the
   * quoted message is in hand. This is the pointer that survives the round
   * trip — without it a reply loaded from history had nothing to link to.
   */
  replyToId?: number;
  /**
   * A call that happened in this conversation.
   *
   * Only the id and mode: the outcome changes after the row is written, so it
   * is resolved from the call log at render time rather than baked into text
   * that would then be wrong.
   */
  call?: { callId: string; mode: 'voice' | 'video' };
  attachment?: MessageAttachment;
  /** True for messages authored by the Dandara AI assistant. */
  isAI?: boolean;
  /** True if the message text has been edited after sending. */
  edited?: boolean;
  /** When set, the message is rendered as a "this message was deleted" placeholder. */
  deletedAt?: string;
  /** When true, the message content is consumed on first view. */
  viewOnce?: boolean;
  /** Opens the reader has left. Undefined when there is no limit. */
  viewsLeft?: number;
  /** True once a view-once message has been opened locally. */
  viewed?: boolean;
  /** Disappearing message — ISO timestamp when it should self-delete. */
  expiresAt?: string;
  /** Usernames mentioned in the text (without @). Used for inline highlighting. */
  mentions?: string[];
  /** True for messages that were forwarded from somewhere else. */
  forwarded?: boolean;
};

export type GroupMember = {
  id: string;
  name: string;
  username: string;
  avatarUri: string;
  role: 'admin' | 'member';
};

/** Number of past messages a new member can see. `Infinity` means all. */
export const HISTORY_LIMITS = [25, 50, 100, Infinity] as const;

export type GroupInfo = {
  id: string;
  name: string;
  avatarUri: string;
  description: string;
  members: GroupMember[];
  /** Admin toggle — when off, new members only see messages sent after they joined. */
  historyEnabled: boolean;
  /** Whether new members can reply to historical messages or only read them. */
  historyMode: 'view-only' | 'full';
  /** How many past messages new members can see (see HISTORY_LIMITS). */
  historyLimit: number;
};

export const MESSAGES: Record<string, Message[]> = {
  dandara: [
    {
      id: 'm1',
      text: 'Olá! Sou a Dandara, a tua assistente. Posso escrever, resumir, dar ideias ou responder a perguntas — aqui ou em qualquer conversa, é só mencionares @Dandara. O que precisas?',
      fromMe: false,
      timestamp: '09:50',
      isAI: true,
      senderName: 'Dandara',
      senderAvatarUri: DANDARA.avatarUri,
    },
  ],
  c1: [
    { id: 'm1', text: 'Yo, just got your DM', fromMe: false, timestamp: '09:38' },
    { id: 'm2', text: 'Hey! Yeah, you free to sign tonight?', fromMe: true, timestamp: '09:39', status: 'read' },
    { id: 'm3', text: 'I think so, depends what time', fromMe: false, timestamp: '09:40' },
    { id: 'm4', text: 'Around 9pm UTC works for me', fromMe: true, timestamp: '09:41', status: 'read' },
    {
      id: 'm5',
      text: 'Just sent the contract address — let me know if you can sign it tonight.',
      fromMe: false,
      timestamp: '09:42',
    },
    {
      id: 'm6',
      text: 'btw, this thread is gold — read it before tonight 👇\nhttps://example.com/web3-onboarding',
      fromMe: false,
      timestamp: '09:44',
      forwarded: true,
    },
  ],
  c2: [
    { id: 'm1', text: 'Studio Sat afternoon?', fromMe: true, timestamp: '09:28', status: 'read' },
    { id: 'm2', text: 'Yeah let’s do Sat afternoon, I’ll book the studio.', fromMe: false, timestamp: '09:31' },
  ],
  c3: [
    { id: 'm1', text: 'gm', fromMe: true, timestamp: '09:10', status: 'delivered' },
    { id: 'm2', text: 'Mango_Apes #4839 just sold for 12.4 ETH 🚀', fromMe: false, timestamp: '09:14' },
  ],
  g1: [
    { id: 'm1', text: 'gm builders ☀️', fromMe: false, timestamp: 'Mon 08:01', historical: true, senderName: 'ninani.eth', senderAvatarUri: dicebear('avataaars', 'ninani', 'FFD93D') },
    { id: 'm2', text: 'Agenda for today: testnet deploy + grant review', fromMe: false, timestamp: 'Mon 08:03', historical: true, senderName: 'ninani.eth', senderAvatarUri: dicebear('avataaars', 'ninani', 'FFD93D') },
    { id: 'm3', text: 'I can take the deploy if nobody else wants it', fromMe: false, timestamp: 'Mon 08:07', historical: true, senderName: 'Samuel Garu', senderAvatarUri: dicebear('big-smile', 'Samuel Garu', '4ADE80') },
    { id: 'm4', text: 'go for it Sam 🙌', fromMe: false, timestamp: 'Mon 08:08', historical: true, senderName: 'ninani.eth', senderAvatarUri: dicebear('avataaars', 'ninani', 'FFD93D') },
    { id: 'm5', text: 'gas is wild this morning btw', fromMe: false, timestamp: 'Mon 08:15', historical: true, senderName: 'Dr7e7t', senderAvatarUri: robohash('Dr7e7t8696c7bb4', 'set1') },
    { id: 'm6', text: 'yeah saw 80 gwei earlier', fromMe: false, timestamp: 'Mon 08:16', historical: true, senderName: 'Anthony', senderAvatarUri: dicebear('adventurer', 'Anthony', '818CF8') },
    { id: 'm7', text: 'lets wait till it cools down before deploying', fromMe: false, timestamp: 'Mon 08:17', historical: true, senderName: 'Samuel Garu', senderAvatarUri: dicebear('big-smile', 'Samuel Garu', '4ADE80') },
    { id: 'm8', text: 'grant review doc is ready for eyes 👀', fromMe: false, timestamp: 'Yesterday 19:40', historical: true, senderName: 'k&8.eth', senderAvatarUri: dicebear('lorelei', 'k8eth', 'FF6FB5') },
    { id: 'm9', text: 'looks solid, left two comments', fromMe: false, timestamp: 'Yesterday 21:02', historical: true, senderName: 'ninani.eth', senderAvatarUri: dicebear('avataaars', 'ninani', 'FFD93D') },
    { id: 'm10', text: 'deploy went through ✅ 0x9f3a…c7', fromMe: false, timestamp: 'Yesterday 22:18', historical: true, senderName: 'Samuel Garu', senderAvatarUri: dicebear('big-smile', 'Samuel Garu', '4ADE80') },
    { id: 'm11', text: 'huge, nice work', fromMe: false, timestamp: 'Yesterday 22:20', historical: true, senderName: 'Anthony', senderAvatarUri: dicebear('adventurer', 'Anthony', '818CF8') },
    { id: 'm12', text: 'adding a couple of new builders to the group today', fromMe: false, timestamp: '08:50', historical: true, senderName: 'ninani.eth', senderAvatarUri: dicebear('avataaars', 'ninani', 'FFD93D') },
    { id: 'm13', text: 'You joined the group', fromMe: false, timestamp: '08:54', system: true },
    { id: 'm14', text: 'Welcome aboard — scroll up to catch the thread.', fromMe: false, timestamp: '08:55', senderName: 'ninani.eth', senderAvatarUri: dicebear('avataaars', 'ninani', 'FFD93D') },
  ],
};

export const GROUPS: Record<string, GroupInfo> = {
  g1: {
    id: 'g1',
    name: 'Web3 Builders',
    avatarUri: dicebear('shapes', 'Web3 Builders', '818CF8'),
    description: 'Shipping open protocols together.',
    historyEnabled: true,
    historyMode: 'view-only',
    historyLimit: 10,
    members: [
      { id: 'u1', name: 'ninani.eth', username: '@ninani', avatarUri: dicebear('avataaars', 'ninani', 'FFD93D'), role: 'admin' },
      { id: 'u2', name: 'Samuel Garu', username: '@samgaru', avatarUri: dicebear('big-smile', 'Samuel Garu', '4ADE80'), role: 'admin' },
      { id: 'u3', name: 'Dr7e7t', username: '@dr7e7t', avatarUri: robohash('Dr7e7t8696c7bb4', 'set1'), role: 'member' },
      { id: 'u4', name: 'Anthony', username: '@anthony', avatarUri: dicebear('adventurer', 'Anthony', '818CF8'), role: 'member' },
      { id: 'u5', name: 'k&8.eth', username: '@k8eth', avatarUri: dicebear('lorelei', 'k8eth', 'FF6FB5'), role: 'member' },
      { id: 'u6', name: 'You', username: '@you', avatarUri: dicebear('avataaars', 'you', 'EEF2FF'), role: 'member' },
    ],
  },
};

/** Who can see this story. */
export type StoryVisibility = 'public' | 'contacts' | 'close';

export type StoryKind = 'image' | 'video' | 'text' | 'audio' | 'poll' | 'question';

export type StoryComment = {
  id: string;
  author: string;
  avatarUri: string;
  text: string;
  postedAt: string;
  isAnonymous?: boolean;
  /** Yours, including your own anonymous ones — decided by the server. */
  isMine?: boolean;
  /** Nested replies on the public comment thread. */
  replies?: StoryComment[];
};

export type Story = {
  id: string;
  user: string;
  username: string;
  avatarUri: string;
  coverUri: string;
  kind: StoryKind;
  caption: string;
  postedAt: string;
  expiresIn: string;
  durationSec: number;
  accent: string;
  viewers: number;
  replies: number;
  /** Every emoji on the story with how many people left it. */
  reactions?: StoryReactionCount[];
  /** What you yourself left, in the order you picked it. */
  myReactions?: string[];
  isViewed: boolean;
  isOwn?: boolean;
  /** Audience: everyone, contacts only, or close friends. */
  visibility?: StoryVisibility;
  /** Author posted without revealing identity. */
  isAnonymous?: boolean;
  allowComments?: boolean;
  /** Viewers may reply as anonymous on the public thread. */
  allowAnonymousReplies?: boolean;
  comments?: StoryComment[];
  /** Optional audio duration for voice stories (seconds). */
  audioSec?: number;
  /** Live broadcast story — no auto-advance, live chat. */
  /**
   * Live state comes from the lives store, not from the post.
   *
   * These were `isLive` and `liveViewers`: written onto the optimistic post,
   * never sent to the server, and wiped by the server's own reply one round
   * trip later. A card asks the store what is actually on air.
   */
  /**
   * Client-only upload lifecycle for background publish.
   * Absent / undefined once the server has accepted the story.
   */
  uploadStatus?: 'uploading' | 'failed';
};

/** Placeholder covers for channel mock seed only (stories use the API). */
const cover = (seed: string) =>
  `https://picsum.photos/seed/${encodeURIComponent(seed)}/900/1400`;

export type UserProfile = {
  name: string;
  username: string;
  avatarUri: string;
  bio: string;
  location: string;
  link: string;
  stats: { chats: number; stories: number; contacts: number };
};

export const CURRENT_USER: UserProfile = {
  name: 'Alex Landa',
  username: '@alexlanda',
  avatarUri: dicebear('avataaars', 'you', 'EEF2FF'),
  bio: 'Building communication tools for everyone. Open-source advocate, coffee-driven, shipping in public.',
  location: 'Luanda, Angola',
  link: 'yo.alexandrelanda.com/@alexlanda',
  stats: { chats: 48, stories: 6, contacts: 213 },
};

/** Thumbnails for the profile "Media" tab. */
export const PROFILE_MEDIA: string[] = Array.from({ length: 9 }, (_, i) =>
  dicebear('shapes', `media-${i}`, ['EEF2FF', 'FFD93D', '818CF8', '4ADE80', 'FF6FB5', '22D3EE'][i % 6]),
);

export type ProfileNote = { id: string; text: string; timestamp: string };

export const PROFILE_NOTES: ProfileNote[] = [
  { id: 'n1', text: 'Shipped the group history feature today 🚀', timestamp: '2h' },
  { id: 'n2', text: 'Looking for testnet feedback — DMs open.', timestamp: 'Yesterday' },
  { id: 'n3', text: 'gm to everyone building in public ☀️', timestamp: 'Mon' },
];

export type CallRecord = {
  id: string;
  chatId: string;
  name: string;
  avatarUri: string;
  type: 'voice' | 'video';
  direction: 'incoming' | 'outgoing' | 'missed';
  timestamp: string;
};

export const CALLS: CallRecord[] = [
  { id: 'call1', chatId: 'c1', name: 'ninani.eth', avatarUri: dicebear('avataaars', 'ninani', 'FFD93D'), type: 'video', direction: 'incoming', timestamp: 'Today, 09:42' },
  { id: 'call2', chatId: 'c2', name: 'Samuel Garu', avatarUri: dicebear('big-smile', 'Samuel Garu', '4ADE80'), type: 'voice', direction: 'outgoing', timestamp: 'Today, 08:15' },
  { id: 'call3', chatId: 'c4', name: 'Anthony', avatarUri: dicebear('adventurer', 'Anthony', '818CF8'), type: 'voice', direction: 'missed', timestamp: 'Today, 07:50' },
  { id: 'call4', chatId: 'c5', name: 'k&8.eth', avatarUri: dicebear('lorelei', 'k8eth', 'FF6FB5'), type: 'video', direction: 'missed', timestamp: 'Yesterday, 22:03' },
  { id: 'call5', chatId: 'c6', name: 'Margareth Joanne C.', avatarUri: dicebear('micah', 'Margareth Joanne', '22D3EE'), type: 'voice', direction: 'incoming', timestamp: 'Yesterday, 18:30' },
  { id: 'call6', chatId: 'c7', name: 'Joe Felix', avatarUri: dicebear('pixel-art', 'Joe Felix', '818CF8'), type: 'video', direction: 'outgoing', timestamp: 'Yesterday, 14:11' },
  { id: 'call7', chatId: 'c3', name: 'Dr7e7t', avatarUri: robohash('Dr7e7t8696c7bb4', 'set1'), type: 'voice', direction: 'missed', timestamp: 'Mon, 20:47' },
  { id: 'call8', chatId: 'c2', name: 'Samuel Garu', avatarUri: dicebear('big-smile', 'Samuel Garu', '4ADE80'), type: 'voice', direction: 'incoming', timestamp: 'Mon, 11:25' },
];

/** Discover — broadcast channels. Categories drive the filter chips. */
export const CHANNEL_CATEGORIES = ['all', 'crypto', 'nft', 'tech', 'gaming', 'news'] as const;
export type ChannelCategory = (typeof CHANNEL_CATEGORIES)[number];

export type ChannelPostType = 'text' | 'image' | 'video' | 'game' | 'live' | 'voice';

/**
 * The one game a channel can post.
 *
 * There were five. Four of them drew their state from local random calls, so
 * every phone showed a different question — see data/games.ts.
 */
export type ChannelGameKind = 'truth_or_dare';

export type ChannelPost = {
  id: string;
  /** Who wrote it — drives the edit/delete affordance. */
  authorId?: string;
  text: string;
  mediaUri?: string;
  timestamp: string;
  views: number;
  reactions?: ChannelReaction[];
  myReaction?: string | null;
  comments?: ChannelComment[];
  /** Post kind — defaults to text/image based on mediaUri when omitted. */
  type?: ChannelPostType;
  gameKind?: ChannelGameKind;
  /** Live / voice hangout is currently active. */
};

export type ChannelReaction = {
  emoji: string;
  count: number;
};

export type ChannelComment = {
  id: string;
  text: string;
  timestamp: string;
  anonymous: boolean;
  authorName?: string;
  pending?: boolean;
  likes?: number;
  liked?: boolean;
  replies?: ChannelComment[];
};

export type Channel = {
  id: string;
  name: string;
  handle: string;
  avatarUri: string;
  coverUri: string;
  description: string;
  category: Exclude<ChannelCategory, 'all'>;
  members: number;
  verified: boolean;
  rules?: string[];
  posts: ChannelPost[];
};

