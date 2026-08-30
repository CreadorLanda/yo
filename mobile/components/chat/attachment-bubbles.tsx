import { Ionicons } from '@expo/vector-icons';
import { Image } from 'expo-image';
import { ActivityIndicator, Pressable, StyleSheet, View } from 'react-native';

import { Text } from '@/components/ui/text';
import { Radii, Spacing, Typography } from '@/constants/theme';
import { STICKER_BUBBLE_SIZE } from '@/data/message-map';
import type { MessageAttachment } from '@/data/mock';
import * as Sharing from 'expo-sharing';

import { CachedImage } from '@/components/ui/cached-image';
import { ensureLocal, mediaIdFromURL, useCacheState } from '@/data/media-cache';
import { useTheme } from '@/hooks/use-theme';
import { t } from '@/i18n';

function extColor(ext: string): string {
  const e = ext.toLowerCase();
  if (e === 'pdf') return '#EF4444';
  if (['doc', 'docx', 'txt'].includes(e)) return '#3B82F6';
  if (['xls', 'xlsx', 'csv'].includes(e)) return '#22C55E';
  if (['ppt', 'pptx'].includes(e)) return '#F97316';
  if (['zip', 'rar', '7z'].includes(e)) return '#A855F7';
  if (['mp3', 'wav', 'm4a'].includes(e)) return '#EC4899';
  if (['png', 'jpg', 'jpeg', 'gif'].includes(e)) return '#0EA5E9';
  return '#64748B';
}

/** Renders the rich body for a message attachment, inside the chat bubble. */
export function AttachmentBubble({
  attachment,
  mine,
  onVote,
  onPlay,
  onLongPress,
}: {
  attachment: MessageAttachment;
  mine: boolean;
  onVote?: (optionId: string) => void;
  /** Game invite — open the game room. */
  onPlay?: () => void;
  /** Forwarded so a child Pressable does not swallow the bubble's menu. */
  onLongPress?: () => void;
}) {
  const { colors } = useTheme();

  const tint = mine ? colors.onPrimary : colors.text;
  const subtle = mine ? 'rgba(255,255,255,0.72)' : colors.textSecondary;
  const track = mine ? 'rgba(255,255,255,0.2)' : colors.surfaceMuted;
  const line = mine ? 'rgba(255,255,255,0.26)' : colors.divider;
  const fieldBg = mine ? 'rgba(255,255,255,0.16)' : colors.surfaceMuted;

  if (attachment.kind === 'document') {
    return (
      <DocumentRow
        attachment={attachment}
        tint={tint}
        subtle={subtle}
        onLongPress={onLongPress}
      />
    );
  }

  if (attachment.kind === 'location') {
    const isLive = !!attachment.live;
    return (
      <View style={styles.card}>
        <View style={[styles.map, { backgroundColor: mine ? 'rgba(255,255,255,0.14)' : colors.surfaceMuted }]}>
          <View style={[styles.road, styles.roadA, { backgroundColor: line }]} />
          <View style={[styles.road, styles.roadB, { backgroundColor: line }]} />
          <View style={[styles.block, styles.blockA, { backgroundColor: line }]} />
          <View style={[styles.block, styles.blockB, { backgroundColor: line }]} />
          <View style={styles.pinWrap}>
            <Ionicons name="location" size={34} color="#EF4444" />
          </View>
          {isLive ? (
            <View style={styles.liveBadge}>
              <View style={styles.liveDot} />
              <Text style={styles.liveBadgeText}>AO VIVO</Text>
            </View>
          ) : null}
        </View>
        <View style={styles.locText}>
          <Text style={[styles.locPlace, { color: tint }]} numberOfLines={1}>
            {attachment.place}
          </Text>
          <Text style={[styles.locAddress, { color: subtle }]} numberOfLines={2}>
            {attachment.address}
          </Text>
        </View>
      </View>
    );
  }

  if (attachment.kind === 'sticker') {
    // Falls back to the shared size so old messages match new ones.
    const w = attachment.width ?? STICKER_BUBBLE_SIZE;
    const h = attachment.height ?? STICKER_BUBBLE_SIZE;
    return (
      <View style={styles.stickerWrap}>
        <CachedImage
          url={attachment.uri}
          style={[styles.sticker, { width: w, height: h }]}
          contentFit="contain"
          mime="image/webp"
          transition={120}
          onLongPress={onLongPress}
        />
      </View>
    );
  }

  if (attachment.kind === 'contact') {
    const initial = attachment.name.charAt(0).toUpperCase();
    return (
      <View style={styles.card}>
        <View style={styles.contactRow}>
          {attachment.avatarUri ? (
            <Image
              source={{ uri: attachment.avatarUri }}
              style={[styles.contactAvatar, { backgroundColor: track }]}
              contentFit="cover"
            />
          ) : (
            <View style={[styles.contactAvatar, styles.contactInitial, { backgroundColor: track }]}>
              <Text style={[styles.contactInitialText, { color: tint }]}>{initial}</Text>
            </View>
          )}
          <View style={styles.contactText}>
            <Text style={[styles.contactName, { color: tint }]} numberOfLines={1}>
              {attachment.name}
            </Text>
            <Text style={[styles.contactDetail, { color: subtle }]} numberOfLines={1}>
              {attachment.detail}
            </Text>
          </View>
        </View>
        <View style={[styles.contactDivider, { backgroundColor: line }]} />
        <View style={styles.contactAction}>
          <Ionicons name="person-circle-outline" size={17} color={mine ? colors.onPrimary : colors.primary} />
          <Text style={[styles.contactActionText, { color: mine ? colors.onPrimary : colors.primary }]}>
            {t('chat.contact_view')}
          </Text>
        </View>
      </View>
    );
  }

  if (attachment.kind === 'poll') {
    const total = attachment.options.reduce((s, o) => s + o.votes, 0);
    return (
      <View style={styles.card}>
        <View style={styles.pollLabelRow}>
          <Ionicons name="stats-chart" size={12} color={subtle} />
          <Text style={[styles.pollLabel, { color: subtle }]}>{t('chat.poll_label')}</Text>
        </View>
        <Text style={[styles.pollQuestion, { color: tint }]}>{attachment.question}</Text>
        <View style={styles.pollOptions}>
          {attachment.options.map((opt) => {
            const pct = total > 0 ? opt.votes / total : 0;
            return (
              <Pressable
                key={opt.id}
                onPress={onVote ? () => onVote(opt.id) : undefined}
                style={styles.pollOption}
              >
                <View style={[styles.pollFill, { backgroundColor: track }]} />
                <View
                  style={[
                    styles.pollFill,
                    {
                      width: `${Math.round(pct * 100)}%`,
                      backgroundColor: mine ? 'rgba(255,255,255,0.3)' : `${colors.primary}2E`,
                    },
                  ]}
                />
                <View style={styles.pollOptionRow}>
                  <View
                    style={[
                      styles.pollRadio,
                      opt.voted
                        ? { backgroundColor: mine ? colors.onPrimary : colors.primary, borderColor: mine ? colors.onPrimary : colors.primary }
                        : { borderColor: line },
                    ]}
                  >
                    {opt.voted ? (
                      <Ionicons name="checkmark" size={11} color={mine ? colors.primary : colors.onPrimary} />
                    ) : null}
                  </View>
                  <Text style={[styles.pollOptionText, { color: tint }]} numberOfLines={2}>
                    {opt.text}
                  </Text>
                  <Text style={[styles.pollOptionPct, { color: subtle }]}>
                    {Math.round(pct * 100)}%
                  </Text>
                </View>
              </Pressable>
            );
          })}
        </View>
        <Text style={[styles.pollTotal, { color: subtle }]}>
          {total > 0 ? t('chat.poll_votes', { count: total }) : t('chat.poll_no_votes')}
        </Text>
      </View>
    );
  }

  if (attachment.kind === 'event') {
    return (
      <View style={styles.card}>
        <View style={styles.eventRow}>
          <View style={[styles.calBlock, { backgroundColor: fieldBg }]}>
            <View style={[styles.calTop, { backgroundColor: colors.primary }]}>
              <Text style={styles.calMonth}>{attachment.month.toUpperCase()}</Text>
            </View>
            <Text style={[styles.calDay, { color: tint }]}>{attachment.day}</Text>
          </View>
          <View style={styles.eventText}>
            <Text style={[styles.eventLabel, { color: subtle }]}>{t('chat.event_label')}</Text>
            <Text style={[styles.eventTitle, { color: tint }]} numberOfLines={2}>
              {attachment.title}
            </Text>
            <View style={styles.eventMetaRow}>
              <Ionicons name="time-outline" size={13} color={subtle} />
              <Text style={[styles.eventMeta, { color: subtle }]} numberOfLines={1}>
                {attachment.weekday} · {attachment.time}
              </Text>
            </View>
            {attachment.location ? (
              <View style={styles.eventMetaRow}>
                <Ionicons name="location-outline" size={13} color={subtle} />
                <Text style={[styles.eventMeta, { color: subtle }]} numberOfLines={1}>
                  {attachment.location}
                </Text>
              </View>
            ) : null}
          </View>
        </View>
      </View>
    );
  }

  // game
  return (
    <View style={styles.card}>
      <View style={styles.gameRow}>
        <View style={[styles.gameTile, { backgroundColor: attachment.color }]}>
          <Ionicons name={attachment.icon as keyof typeof Ionicons.glyphMap} size={28} color="#FFFFFF" />
        </View>
        <View style={styles.gameText}>
          <Text style={[styles.gameLabel, { color: subtle }]}>{t('chat.game_invite')}</Text>
          <Text style={[styles.gameName, { color: tint }]} numberOfLines={1}>
            {attachment.name}
          </Text>
          <Text style={[styles.gameTagline, { color: subtle }]} numberOfLines={1}>
            {attachment.tagline}
          </Text>
        </View>
      </View>
      <Pressable
        style={[
          styles.gamePlay,
          { backgroundColor: mine ? 'rgba(255,255,255,0.18)' : colors.primary },
        ]}
        onPress={onPlay}
        disabled={!onPlay}
        accessibilityRole="button"
        accessibilityLabel={t('chat.game_play')}
      >
        <Ionicons name="play" size={14} color={colors.onPrimary} />
        <Text style={[styles.gamePlayText, { color: colors.onPrimary }]}>{t('chat.game_play')}</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  card: { minWidth: 234, gap: Spacing.xs },

  // Document
  docRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
    minWidth: 230,
    paddingVertical: 2,
  },
  docIcon: {
    width: 44,
    height: 44,
    borderRadius: Radii.md,
    alignItems: 'center',
    justifyContent: 'center',
  },
  docText: { flex: 1, gap: 2 },
  docName: { ...Typography.caption, fontWeight: '700' },
  docMeta: { ...Typography.micro },

  // Location
  map: {
    height: 116,
    borderRadius: Radii.md,
    overflow: 'hidden',
    alignItems: 'center',
    justifyContent: 'center',
  },
  road: { position: 'absolute', borderRadius: 2 },
  roadA: { width: '160%', height: 9, transform: [{ rotate: '-24deg' }], top: 34 },
  roadB: { width: 9, height: '160%', left: '62%', transform: [{ rotate: '-24deg' }] },
  block: { position: 'absolute', width: 30, height: 22, borderRadius: 4, opacity: 0.7 },
  blockA: { top: 16, left: 22 },
  blockB: { bottom: 18, right: 30 },
  pinWrap: {
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#000',
    shadowOpacity: 0.3,
    shadowRadius: 4,
    shadowOffset: { width: 0, height: 2 },
  },
  locText: { gap: 2, paddingHorizontal: 2 },
  locPlace: { ...Typography.caption, fontWeight: '700' },
  locAddress: { ...Typography.micro, lineHeight: 15 },
  liveBadge: {
    position: 'absolute',
    top: 8,
    right: 8,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: '#EF4444',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: Radii.pill,
  },
  liveDot: { width: 6, height: 6, borderRadius: Radii.pill, backgroundColor: '#FFFFFF' },
  liveBadgeText: { ...Typography.micro, color: '#FFFFFF', fontWeight: '700', letterSpacing: 0.5 },

  // Sticker — sits inside the bubble with transparent background; the bubble
  // wrapping is invisible because we strip its padding/bg in Bubble itself.
  stickerWrap: { alignItems: 'flex-start' },
  sticker: { backgroundColor: 'transparent' },

  // Contact
  contactRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, paddingVertical: 2 },
  contactAvatar: { width: 46, height: 46, borderRadius: Radii.pill },
  contactInitial: { alignItems: 'center', justifyContent: 'center' },
  contactInitialText: { ...Typography.body, fontWeight: '700' },
  contactText: { flex: 1, gap: 2 },
  contactName: { ...Typography.caption, fontWeight: '700' },
  contactDetail: { ...Typography.micro },
  contactDivider: { height: StyleSheet.hairlineWidth, marginVertical: 2 },
  contactAction: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 5,
    paddingVertical: 4,
  },
  contactActionText: { ...Typography.caption, fontWeight: '700' },

  // Poll
  pollLabelRow: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  pollLabel: {
    ...Typography.micro,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  pollQuestion: { ...Typography.caption, fontWeight: '700', lineHeight: 19 },
  pollOptions: { gap: 6, marginTop: 2 },
  pollOption: {
    minHeight: 38,
    borderRadius: Radii.sm,
    overflow: 'hidden',
    justifyContent: 'center',
  },
  pollFill: { ...StyleSheet.absoluteFillObject, borderRadius: Radii.sm },
  pollOptionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
    paddingHorizontal: Spacing.sm,
    paddingVertical: 7,
  },
  pollRadio: {
    width: 18,
    height: 18,
    borderRadius: Radii.pill,
    borderWidth: 1.5,
    alignItems: 'center',
    justifyContent: 'center',
  },
  pollOptionText: { ...Typography.caption, flex: 1 },
  pollOptionPct: { ...Typography.micro, fontWeight: '700' },
  pollTotal: { ...Typography.micro, marginTop: 2 },

  // Event
  eventRow: { flexDirection: 'row', gap: Spacing.sm, paddingVertical: 2 },
  calBlock: {
    width: 48,
    borderRadius: Radii.md,
    overflow: 'hidden',
    alignItems: 'center',
  },
  calTop: { width: '100%', alignItems: 'center', paddingVertical: 3 },
  calMonth: { ...Typography.micro, color: '#FFFFFF', fontWeight: '800', fontSize: 9, letterSpacing: 0.5 },
  calDay: { ...Typography.h3, fontWeight: '800', paddingVertical: 4 },
  eventText: { flex: 1, gap: 2 },
  eventLabel: {
    ...Typography.micro,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  eventTitle: { ...Typography.caption, fontWeight: '700', lineHeight: 19 },
  eventMetaRow: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  eventMeta: { ...Typography.micro },

  // Game
  gameRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm },
  gameTile: {
    width: 52,
    height: 52,
    borderRadius: Radii.md,
    alignItems: 'center',
    justifyContent: 'center',
  },
  gameText: { flex: 1, gap: 1 },
  gameLabel: {
    ...Typography.micro,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  gameName: { ...Typography.caption, fontWeight: '700' },
  gameTagline: { ...Typography.micro },
  gamePlay: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 5,
    paddingVertical: 7,
    borderRadius: Radii.pill,
    marginTop: 2,
  },
  gamePlayText: { ...Typography.caption, fontWeight: '700' },
});

/**
 * Document row: shows size before anything is fetched, downloads on tap,
 * then hands the file to whatever app can open it.
 *
 * Rendering documents in-app would need a viewer per format; handing off to
 * the system covers every type the phone already knows, which is what other
 * messengers do for anything that is not a PDF.
 */
function DocumentRow({
  attachment,
  tint,
  subtle,
  onLongPress,
}: {
  attachment: Extract<MessageAttachment, { kind: 'document' }>;
  tint: string;
  subtle: string;
  onLongPress?: () => void;
}) {
  const { colors } = useTheme();
  const color = extColor(attachment.ext);
  const id = attachment.url ? mediaIdFromURL(attachment.url) : null;
  const state = useCacheState(id ?? undefined);

  const open = async () => {
    if (!id) return;
    const uri =
      state.status === 'ready'
        ? state.uri
        : await ensureLocal(id, { key: attachment.key, mime: attachment.mime });
    if (!uri) return;
    try {
      if (await Sharing.isAvailableAsync()) {
        await Sharing.shareAsync(uri, { mimeType: attachment.mime, UTI: attachment.mime });
      }
    } catch {
      /* user dismissed the sheet */
    }
  };

  const icon =
    state.status === 'downloading'
      ? 'ellipsis-horizontal'
      : state.status === 'ready'
        ? 'open-outline'
        : 'arrow-down-circle';

  return (
    <Pressable
      onPress={open}
      onLongPress={onLongPress}
      delayLongPress={260}
      style={styles.docRow}
    >
      <View style={[styles.docIcon, { backgroundColor: `${color}26` }]}>
        <Ionicons name="document-text" size={24} color={color} />
      </View>
      <View style={styles.docText}>
        <Text style={[styles.docName, { color: tint }]} numberOfLines={2}>
          {attachment.name}
        </Text>
        <Text style={[styles.docMeta, { color: subtle }]} numberOfLines={1}>
          {attachment.sizeLabel}
          {attachment.ext ? ` · ${attachment.ext.toUpperCase()}` : ''}
          {state.status === 'ready' ? ` · ${t('media.open')}` : ''}
        </Text>
      </View>
      {state.status === 'downloading' ? (
        <ActivityIndicator size="small" color={colors.primary} />
      ) : (
        <Ionicons name={icon} size={22} color={subtle} />
      )}
    </Pressable>
  );
}
