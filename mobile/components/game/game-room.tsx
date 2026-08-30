import { useEffect, useMemo, useRef, useState } from 'react';
import { Animated, Easing, Modal, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

import { Text, TextInput } from '@/components/ui/text';
import { Palette, Radii, Spacing, Typography } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { t } from '@/i18n';
import {
  MAX_ROUNDS,
  newSeed,
  pickPlayer,
  replayGame,
  sortedMemberIds,
  type GameMessagePayload,
  type TruthOrDareChoice,
} from '@/data/game';

export interface GamePlayer {
  id: string;
  name: string;
  /** Without the leading @ — the room adds it. */
  username?: string;
  avatarUri?: string;
}

/** One message from the room's chat, already decrypted by the chat screen. */
export interface GameChatMessage {
  id: string;
  text: string;
  fromMe: boolean;
  senderName: string;
  senderUsername?: string;
}

/**
 * A display name plus the handle underneath.
 *
 * Two people in a group can share a display name, and in a game that turns
 * on "whose turn is it" that ambiguity is the whole problem. The handle is
 * the part that is unique.
 */
function handle(p?: GamePlayer | null): string {
  if (!p?.username) return '';
  return `@${p.username.replace(/^@/, '')}`;
}

export type GameRoomSend = (payload: GameMessagePayload) => void;

/**
 * Truth or Dare room — a fullscreen modal layered over the chat.
 *
 * The wheel is deterministic: every device derives the same current player
 * from (seed, round, sorted member ids). The chat keeps working underneath
 * between turns; the tiles collapse when the wheel goes fullscreen.
 */
export function GameRoom({
  visible,
  onClose,
  players,
  payloads,
  meId,
  onSend,
  chat,
  onSendText,
}: {
  visible: boolean;
  onClose: () => void;
  players: GamePlayer[];
  payloads: GameMessagePayload[];
  meId: string | null;
  onSend: GameRoomSend;
  /** The group's ordinary messages, oldest first. */
  chat: GameChatMessage[];
  onSendText: (text: string) => void;
}) {
  const { colors } = useTheme();
  const memberIds = useMemo(() => sortedMemberIds(players.map((p) => p.id)), [players]);
  const state = useMemo(
    () => replayGame(payloads, memberIds),
    [payloads, memberIds],
  );
  const me = players.find((p) => p.id === meId);

  const [wheelOpen, setWheelOpen] = useState(false);
  const [spinning, setSpinning] = useState(false);
  const spinAnim = useRef(new Animated.Value(0)).current;
  const [spinIndex, setSpinIndex] = useState<number | null>(null);

  const isMyTurn = !!me && state.active && state.currentPlayerId === me.id;
  const canWriteChallenge =
    state.active && state.choice != null && state.challenge == null && !isMyTurn;
  const challengeOpen = state.active && state.choice != null;

  const [draft, setDraft] = useState('');
  const [choicePending, setChoicePending] = useState<TruthOrDareChoice | null>(null);

  const resetLocal = () => {
    setWheelOpen(false);
    setSpinning(false);
    setSpinIndex(null);
    setDraft('');
    setChoicePending(null);
  };

  // Sync local transient UI with a state reset (new game / end).
  useEffect(() => {
    if (visible && !state.active) {
      setWheelOpen(false);
      setSpinning(false);
      setSpinIndex(null);
      setDraft('');
      setChoicePending(null);
    }
  }, [visible, state.active]);

  const startGame = () => {
    onSend({
      kind: 'game',
      game: 'truth-or-dare',
      action: 'start',
      seed: newSeed(),
      maxRounds: MAX_ROUNDS,
    });
    setWheelOpen(true);
    setSpinIndex(null);
  };

  const spinWheel = () => {
    if (!state.active || memberIds.length === 0) return;
    setSpinning(true);
    setSpinIndex(null);
    // The target is deterministic — animate to it and land on the same
    // player every device derives.
    const target = pickPlayer(state.seed, state.round, memberIds);
    const turns = 6 + target; // arbitrary extra spins for drama
    spinAnim.setValue(0);
    Animated.timing(spinAnim, {
      toValue: turns * memberIds.length + target,
      duration: 2200,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: true,
    }).start(({ finished }) => {
      if (!finished) return;
      setSpinning(false);
      setSpinIndex(target);
    });
  };

  const closeWheel = () => {
    setWheelOpen(false);
    setSpinning(false);
    setSpinIndex(null);
  };

  const choose = (choice: TruthOrDareChoice) => {
    if (!me) return;
    setChoicePending(choice);
    onSend({
      kind: 'game',
      game: 'truth-or-dare',
      action: 'choose',
      playerId: me.id,
      choice,
    });
  };

  const submitChallenge = () => {
    const text = draft.trim();
    if (!text || !me) return;
    onSend({
      kind: 'game',
      game: 'truth-or-dare',
      action: 'challenge',
      playerId: me.id,
      text,
    });
    setDraft('');
  };

  const markDone = () => {
    if (!me) return;
    onSend({ kind: 'game', game: 'truth-or-dare', action: 'done', playerId: me.id });
  };

  const endGame = () => {
    onSend({ kind: 'game', game: 'truth-or-dare', action: 'end' });
    resetLocal();
  };

  // ── Wheel rotation for the fullscreen moment ─────────────────────────
  const wheelRotation = spinAnim.interpolate({
    inputRange: [0, 1],
    outputRange: ['0deg', '360deg'],
  });

  const tile = (p: GamePlayer, highlight: boolean, done: boolean) => (
    <View
      key={p.id}
      style={[
        styles.tile,
        { backgroundColor: colors.surface, borderColor: highlight ? Palette.brand[400] : colors.border },
        highlight && styles.tileActive,
      ]}
    >
      <View
        style={[
          styles.tileAvatar,
          { backgroundColor: highlight ? Palette.brand[400] : colors.surfaceMuted },
        ]}
      >
        {p.avatarUri ? (
          <Text style={styles.tileAvatarText}>{p.name.charAt(0).toUpperCase()}</Text>
        ) : (
          <Text style={[styles.tileAvatarText, { color: colors.onPrimary }]}>
            {p.name.charAt(0).toUpperCase()}
          </Text>
        )}
      </View>
      <Text style={[styles.tileName, { color: colors.text }]} numberOfLines={1}>
        {p.name}
      </Text>
      {handle(p) ? (
        <Text style={[styles.tileHandle, { color: colors.textMuted }]} numberOfLines={1}>
          {handle(p)}
        </Text>
      ) : null}
      {done ? (
        <Ionicons name="checkmark-circle" size={14} color={colors.success} />
      ) : highlight ? (
        <Ionicons name="hourglass" size={13} color={Palette.brand[400]} />
      ) : null}
    </View>
  );

  return (
    <Modal transparent visible={visible} animationType="slide" onRequestClose={onClose}>
      <View style={[styles.overlay, { backgroundColor: colors.background }]}>
        {/* Header */}
        <View style={[styles.header, { borderBottomColor: colors.divider }]}>
          <View style={styles.headerLeft}>
            <Ionicons name="game-controller" size={20} color={Palette.brand[400]} />
            <View>
              <Text style={[styles.headerTitle, { color: colors.text }]}>{t('game.title')}</Text>
              <Text style={[styles.headerSub, { color: colors.textMuted }]}>
                {state.active
                  ? t('game.round_of', { round: state.round, max: state.maxRounds })
                  : t('game.not_started')}
              </Text>
            </View>
          </View>
          <Pressable onPress={onClose} hitSlop={8} accessibilityLabel={t('common.close')}>
            <Ionicons name="chevron-down" size={24} color={colors.textSecondary} />
          </Pressable>
        </View>

        {state.ended ? (
          /* ── Game over ───────────────────────────────────────────── */
          <View style={styles.center}>
            <Ionicons name="trophy" size={48} color={Palette.accent.yellow} />
            <Text style={[styles.winnerName, { color: colors.text }]}>
              {players.find((p) => p.id === state.winnerId)?.name ?? '—'}
            </Text>
            <Text style={[styles.handleLine, { color: colors.textMuted }]}>
              {handle(players.find((p) => p.id === state.winnerId))}
            </Text>
            <Text style={[styles.winnerSub, { color: colors.textSecondary }]}>
              {t('game.winner')}
            </Text>
            <PrimaryButtonInline label={t('game.play_again')} onPress={startGame} />
            <Pressable onPress={onClose} hitSlop={8}>
              <Text style={[styles.linkText, { color: colors.textSecondary }]}>
                {t('common.close')}
              </Text>
            </Pressable>
          </View>
        ) : (
          <ScrollView contentContainerStyle={styles.body}>
            {/* Floating player tiles — Meet/Discord style */}
            {state.active && (
              <View style={styles.tilesRow}>
                {players.map((p) =>
                  tile(
                    p,
                    state.currentPlayerId === p.id,
                    state.doneIds.includes(p.id),
                  ),
                )}
              </View>
            )}

            {!state.active ? (
              /* ── Start screen ─────────────────────────────────────── */
              <View style={styles.center}>
                <Ionicons name="dice" size={56} color={Palette.brand[400]} />
                <Text style={[styles.startTitle, { color: colors.text }]}>
                  {t('game.title')}
                </Text>
                <Text style={[styles.startHint, { color: colors.textSecondary }]}>
                  {t('game.start_hint')}
                </Text>
                <PrimaryButtonInline
                  label={t('game.start')}
                  onPress={startGame}
                  disabled={players.length < 2}
                />
                {players.length < 2 && (
                  <Text style={[styles.startHint, { color: colors.textMuted }]}>
                    {t('game.need_two')}
                  </Text>
                )}
              </View>
            ) : challengeOpen && state.challenge ? (
              /* ── Challenge card (revealed) ───────────────────────── */
              <View style={[styles.challengeCard, { backgroundColor: colors.surfaceElevated }]}>
                <View style={styles.challengeTop}>
                  <View
                    style={[
                      styles.choicePill,
                      {
                        backgroundColor:
                          state.choice === 'dare' ? 'rgba(255,90,95,0.15)' : 'rgba(255,217,61,0.15)',
                      },
                    ]}
                  >
                    <Text
                      style={[
                        styles.choicePillText,
                        { color: state.choice === 'dare' ? '#FF5A5F' : '#FFD93D' },
                      ]}
                    >
                      {state.choice === 'dare' ? t('game.dare') : t('game.truth')}
                    </Text>
                  </View>
                  <View>
                    <Text style={[styles.challengePlayer, { color: colors.text }]}>
                      {players.find((p) => p.id === state.currentPlayerId)?.name}
                    </Text>
                    <Text style={[styles.handleLine, { color: colors.textMuted }]}>
                      {handle(players.find((p) => p.id === state.currentPlayerId))}
                    </Text>
                  </View>
                </View>
                <Text style={[styles.challengeText, { color: colors.text }]}>
                  {state.challenge}
                </Text>
                <Text style={[styles.challengeBy, { color: colors.textMuted }]}>
                  {t('game.written_by', {
                    name: players.find((p) => p.id === state.challengeBy)?.name ?? '—',
                  })}
                </Text>

                {isMyTurn && (
                  <View style={styles.actions}>
                    {state.choice === 'dare' && (
                      <PrimaryButtonInline
                        label={t('game.record_proof')}
                        onPress={() => {
                          /* video recording — Phase 1 shows the flow */
                        }}
                        variant="secondary"
                      />
                    )}
                    <PrimaryButtonInline label={t('game.mark_done')} onPress={markDone} />
                  </View>
                )}
              </View>
            ) : challengeOpen && state.choice ? (
              /* ── Awaiting challenge text ─────────────────────────── */
              <View style={styles.center}>
                <Text style={[styles.challengePlayer, { color: colors.text }]}>
                  {players.find((p) => p.id === state.currentPlayerId)?.name}
                </Text>
                <Text style={[styles.handleLine, { color: colors.textMuted }]}>
                  {handle(players.find((p) => p.id === state.currentPlayerId))}
                </Text>
                <Text style={[styles.startHint, { color: colors.textSecondary }]}>
                  {t('game.awaiting_challenge', {
                    choice: state.choice === 'dare' ? t('game.dare') : t('game.truth'),
                  })}
                </Text>
                {canWriteChallenge && (
                  <View style={styles.draftRow}>
                    <View style={[styles.draftInput, { backgroundColor: colors.surface, borderColor: colors.border }]}>
                      <TextInput
                        style={[styles.draftText, { color: colors.text }]}
                        value={draft}
                        onChangeText={setDraft}
                        placeholder={t('game.write_hint')}
                        placeholderTextColor={colors.textMuted}
                        multiline
                      />
                    </View>
                    <PrimaryButtonInline
                      label={t('common.send')}
                      onPress={submitChallenge}
                      disabled={!draft.trim()}
                    />
                  </View>
                )}
              </View>
            ) : isMyTurn && state.choice == null ? (
              /* ── It's my turn: Truth or Dare ─────────────────────── */
              <View style={styles.center}>
                <View style={[styles.bigAvatar, { borderColor: Palette.brand[400] }]}>
                  <Text style={[styles.bigAvatarText, { color: colors.text }]}>
                    {me?.name.charAt(0).toUpperCase()}
                  </Text>
                </View>
                <Text style={[styles.challengePlayer, { color: colors.text }]}>{me?.name}</Text>
                <Text style={[styles.startHint, { color: colors.textSecondary }]}>
                  {t('game.your_turn')}
                </Text>
                <View style={styles.truthDareRow}>
                  <Pressable
                    onPress={() => choose('truth')}
                    disabled={choicePending != null}
                    style={[styles.truthDareBtn, { borderColor: '#FFD93D' }]}
                  >
                    <Text style={{ color: '#FFD93D', fontWeight: '700' }}>{t('game.truth')}</Text>
                  </Pressable>
                  <Pressable
                    onPress={() => choose('dare')}
                    disabled={choicePending != null}
                    style={[styles.truthDareBtn, { borderColor: '#FF5A5F' }]}
                  >
                    <Text style={{ color: '#FF5A5F', fontWeight: '700' }}>{t('game.dare')}</Text>
                  </Pressable>
                </View>
              </View>
            ) : (
              /* ── Someone else's turn — watch + spin again ────────── */
              <View style={styles.center}>
                <View style={[styles.bigAvatar, { borderColor: colors.border }]}>
                  <Text style={[styles.bigAvatarText, { color: colors.text }]}>
                    {players.find((p) => p.id === state.currentPlayerId)?.name.charAt(0)}
                  </Text>
                </View>
                <Text style={[styles.challengePlayer, { color: colors.text }]}>
                  {players.find((p) => p.id === state.currentPlayerId)?.name}
                </Text>
                <Text style={[styles.handleLine, { color: colors.textMuted }]}>
                  {handle(players.find((p) => p.id === state.currentPlayerId))}
                </Text>
                <Text style={[styles.startHint, { color: colors.textSecondary }]}>
                  {t('game.their_turn')}
                </Text>
                <PrimaryButtonInline
                  label={t('game.spin_again')}
                  onPress={() => setWheelOpen(true)}
                  variant="secondary"
                />
              </View>
            )}

            {state.active && (
              <Pressable onPress={endGame} hitSlop={8} style={styles.endGame}>
                <Text style={[styles.linkText, { color: colors.textMuted }]}>
                  {t('game.end_game')}
                </Text>
              </Pressable>
            )}
          </ScrollView>
        )}

        {/* Fullscreen wheel */}
        <Modal transparent visible={wheelOpen} animationType="fade" onRequestClose={closeWheel}>
          <View style={[styles.wheelOverlay, { backgroundColor: 'rgba(14,15,19,0.96)' }]}>
            <Text style={[styles.wheelTitle, { color: colors.text }]}>
              {spinning ? t('game.spinning') : spinIndex != null ? t('game.spun') : t('game.spin_title')}
            </Text>
            <View style={[styles.wheelFrame, { borderColor: colors.border }]}>
              <Animated.View style={{ transform: [{ rotate: wheelRotation }] }}>
                <Ionicons name="dice" size={120} color={Palette.brand[400]} />
              </Animated.View>
            </View>
            {spinIndex != null && (
              <View style={styles.wheelResult}>
                <Text style={[styles.winnerName, { color: colors.text }]}>
                  {players[spinIndex]?.name}
                </Text>
                <Text style={[styles.handleLine, { color: colors.textMuted }]}>
                  {handle(players[spinIndex])}
                </Text>
                <Text style={[styles.startHint, { color: colors.textSecondary }]}>
                  {t('game.spun_sub')}
                </Text>
                <PrimaryButtonInline label={t('game.continue')} onPress={closeWheel} />
              </View>
            )}
            {!spinning && spinIndex == null && (
              <PrimaryButtonInline label={t('game.spin')} onPress={spinWheel} />
            )}
          </View>
        </Modal>

        {/*
          The room is a room. A game where you cannot react to what just
          happened is a turn-taking machine, and the whole point of Truth or
          Dare is the talking around it — so the group's chat lives here
          rather than behind the modal, where it was unreachable.

          These are ordinary messages on the ordinary send path, which is
          what keeps them end-to-end encrypted: the room composes text and
          hands it to the chat screen, exactly as the composer downstairs
          does. Nothing about the game touches the ciphertext.
        */}
        <RoomChat
          messages={chat}
          onSend={onSendText}
          bare={!state.active}
        />
      </View>
    </Modal>
  );
}

/**
 * The chat strip at the foot of the room.
 *
 * Deliberately compact: it is company for the game, not a replacement for
 * the full thread. It grows when there is no game running, because then
 * talking is the only thing to do here.
 */
function RoomChat({
  messages,
  onSend,
  bare,
}: {
  messages: GameChatMessage[];
  onSend: (text: string) => void;
  bare: boolean;
}) {
  const { colors } = useTheme();
  const [draft, setDraft] = useState('');
  const listRef = useRef<ScrollView>(null);

  // Follow the conversation. Without this the newest message lands below the
  // fold and the room looks like nobody is talking.
  useEffect(() => {
    if (messages.length === 0) return;
    const id = setTimeout(() => listRef.current?.scrollToEnd({ animated: true }), 60);
    return () => clearTimeout(id);
  }, [messages.length]);

  const send = () => {
    const text = draft.trim();
    if (!text) return;
    onSend(text);
    setDraft('');
  };

  return (
    <View style={[styles.chatWrap, { borderTopColor: colors.divider }, bare && styles.chatWrapTall]}>
      <ScrollView
        ref={listRef}
        style={styles.chatList}
        contentContainerStyle={styles.chatListContent}
        keyboardShouldPersistTaps="handled"
      >
        {messages.length === 0 ? (
          <Text style={[styles.chatEmpty, { color: colors.textMuted }]}>
            {t('game.chat_empty')}
          </Text>
        ) : (
          messages.map((m) => (
            <View key={m.id} style={styles.chatRow}>
              <Text
                style={[
                  styles.chatSender,
                  { color: m.fromMe ? Palette.brand[400] : colors.textSecondary },
                ]}
                numberOfLines={1}
              >
                {m.senderUsername ? `@${m.senderUsername.replace(/^@/, '')}` : m.senderName}
              </Text>
              <Text style={[styles.chatText, { color: colors.text }]}>{m.text}</Text>
            </View>
          ))
        )}
      </ScrollView>

      <View style={[styles.chatComposer, { backgroundColor: colors.surfaceMuted }]}>
        <TextInput
          value={draft}
          onChangeText={setDraft}
          placeholder={t('game.chat_placeholder')}
          placeholderTextColor={colors.textMuted}
          style={[styles.chatInput, { color: colors.text }]}
          onSubmitEditing={send}
          returnKeyType="send"
          multiline
          maxLength={2000}
        />
        <Pressable
          onPress={send}
          disabled={!draft.trim()}
          hitSlop={8}
          accessibilityRole="button"
          accessibilityLabel={t('game.chat_send')}
        >
          <Ionicons
            name="arrow-up-circle"
            size={30}
            color={draft.trim() ? Palette.brand[400] : colors.textMuted}
          />
        </Pressable>
      </View>
    </View>
  );
}

/** Inline primary button without importing PrimaryButton (keeps this file self-contained). */
function PrimaryButtonInline({
  label,
  onPress,
  disabled,
  variant = 'primary',
}: {
  label: string;
  onPress: () => void;
  disabled?: boolean;
  variant?: 'primary' | 'secondary';
}) {
  const { colors } = useTheme();
  const isPrimary = variant === 'primary';
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      style={({ pressed }) => [
        styles.inlineBtn,
        isPrimary
          ? { backgroundColor: colors.primary }
          : { backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border },
        pressed && { opacity: 0.8 },
        disabled && { opacity: 0.4 },
      ]}
    >
      <Text
        style={[
          styles.inlineBtnText,
          { color: isPrimary ? colors.onPrimary : colors.text },
        ]}
      >
        {label}
      </Text>
    </Pressable>
  );
}

// TextInput imported at top.

const styles = StyleSheet.create({
  overlay: { flex: 1 },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: Spacing.lg,
    paddingVertical: Spacing.md,
    borderBottomWidth: 1,
  },
  headerLeft: { flexDirection: 'row', alignItems: 'center', gap: Spacing.md },
  headerTitle: { ...Typography.h3 },
  headerSub: { ...Typography.micro, marginTop: 2 },
  body: { padding: Spacing.lg, gap: Spacing.lg },
  center: { alignItems: 'center', justifyContent: 'center', gap: Spacing.md, paddingVertical: Spacing.xxxl },
  tilesRow: { flexDirection: 'row', gap: Spacing.sm, flexWrap: 'wrap' },
  tile: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.xs,
    borderRadius: Radii.md,
    borderWidth: 1,
    paddingHorizontal: Spacing.sm,
    paddingVertical: Spacing.xs,
  },
  tileActive: { transform: [{ scale: 1.04 }] },
  tileAvatar: {
    width: 24,
    height: 24,
    borderRadius: Radii.pill,
    alignItems: 'center',
    justifyContent: 'center',
  },
  tileAvatarText: { fontSize: 12, fontWeight: '700', color: '#FFFFFF' },
  tileName: { ...Typography.micro, fontWeight: '600', maxWidth: 64 },
  tileHandle: { ...Typography.micro, fontSize: 10, maxWidth: 64 },
  handleLine: { ...Typography.caption, marginTop: 2 },
  chatWrap: { maxHeight: 210, borderTopWidth: StyleSheet.hairlineWidth },
  // With no game running there is nothing else on screen worth the space.
  chatWrapTall: { maxHeight: 340 },
  chatList: { maxHeight: 150 },
  chatListContent: { paddingHorizontal: Spacing.lg, paddingTop: Spacing.sm, gap: Spacing.xs },
  chatEmpty: { ...Typography.caption, textAlign: 'center', paddingVertical: Spacing.lg },
  chatRow: { flexDirection: 'row', gap: Spacing.sm, alignItems: 'baseline' },
  chatSender: { ...Typography.micro, fontWeight: '700', maxWidth: 110 },
  chatText: { ...Typography.caption, flex: 1 },
  chatComposer: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: Spacing.sm,
    margin: Spacing.md,
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm,
    borderRadius: Radii.xl,
  },
  chatInput: { flex: 1, ...Typography.body, maxHeight: 90, padding: 0 },
  startTitle: { ...Typography.h1 },
  startHint: { ...Typography.body, textAlign: 'center', maxWidth: 300 },
  bigAvatar: {
    width: 96,
    height: 96,
    borderRadius: Radii.pill,
    borderWidth: 3,
    alignItems: 'center',
    justifyContent: 'center',
  },
  bigAvatarText: { fontSize: 40, fontWeight: '800' },
  truthDareRow: { flexDirection: 'row', gap: Spacing.md, marginTop: Spacing.md },
  truthDareBtn: {
    borderWidth: 2,
    borderRadius: Radii.pill,
    paddingHorizontal: Spacing.xl,
    paddingVertical: Spacing.md,
    minWidth: 130,
    alignItems: 'center',
  },
  challengeCard: {
    borderRadius: Radii.xl,
    padding: Spacing.xl,
    gap: Spacing.md,
    alignItems: 'center',
  },
  challengeTop: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm },
  choicePill: { borderRadius: Radii.pill, paddingHorizontal: Spacing.md, paddingVertical: 4 },
  choicePillText: { fontWeight: '700', textTransform: 'uppercase', letterSpacing: 0.5 },
  challengePlayer: { ...Typography.h2 },
  challengeText: { ...Typography.h3, textAlign: 'center' },
  challengeBy: { ...Typography.caption },
  actions: { gap: Spacing.sm, width: '100%', marginTop: Spacing.md },
  draftRow: { flexDirection: 'row', gap: Spacing.sm, alignItems: 'flex-end', width: '100%', maxWidth: 340 },
  draftInput: {
    flex: 1,
    borderWidth: 1,
    borderRadius: Radii.lg,
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm,
  },
  draftText: { ...Typography.body, minHeight: 40 },
  endGame: { alignItems: 'center', marginTop: Spacing.lg },
  linkText: { ...Typography.bodyStrong },
  winnerName: { ...Typography.h1 },
  winnerSub: { ...Typography.body, color: '#9A9CA8' },
  inlineBtn: {
    borderRadius: Radii.pill,
    paddingHorizontal: Spacing.xl,
    paddingVertical: Spacing.md,
    alignItems: 'center',
    minWidth: 140,
  },
  inlineBtnText: { fontWeight: '700', fontSize: 15 },
  wheelOverlay: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: Spacing.xl },
  wheelTitle: { ...Typography.h2 },
  wheelFrame: {
    width: 220,
    height: 220,
    borderRadius: 110,
    borderWidth: 2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  wheelResult: { alignItems: 'center', gap: Spacing.sm },
});
