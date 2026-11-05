import { Ionicons } from '@expo/vector-icons';
import { router, useLocalSearchParams } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { PrimaryButton } from '@/components/ui/primary-button';
import { Text, TextInput } from '@/components/ui/text';
import { Radii, Shadows, Sizes, Spacing, Typography } from '@/constants/theme';
import { listMessages, reportChat, type ReportReason, type ReportResult } from '@/data/api/messages';
import { getCurrentUser } from '@/data/auth-store';
import { refreshBlocks } from '@/data/block-store';
import { getCachedChat, refreshChats } from '@/data/chat-store';
import { displayChatName } from '@/data/chat-identity';
import { appAlert } from '@/data/dialog-store';
import { decryptMessageContent, formatMsgTime } from '@/data/message-map';
import {
  MAX_EVIDENCE,
  MAX_NOTE,
  REPORT_REASONS,
  buildEvidence,
  evidenceCandidates,
  noContactRemaining,
  type EvidenceCandidate,
} from '@/data/report-evidence';
import { useTheme } from '@/hooks/use-theme';
import { t } from '@/i18n';

/**
 * Report a conversation.
 *
 * One screen, top to bottom in the order a person decides things: what
 * happened, anything to add, which messages (if any) to send as proof, and what
 * will follow. Proof is opt-in and explicit: nothing readable leaves the phone
 * until the person has seen what, to whom, for how long, and agreed.
 *
 * Reached from Chat info: /report/<chatId>
 */
export default function ReportScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { colors, isDark } = useTheme();
  const me = getCurrentUser()?.id;
  const chat = id ? getCachedChat(id) : undefined;
  const isGroup = chat?.type === 'group';
  const name = chat ? displayChatName(chat, t('chats.saved_messages'), t('call.someone')) : t('call.someone');

  const [reason, setReason] = useState<ReportReason | null>(null);
  const [note, setNote] = useState('');
  const [candidates, setCandidates] = useState<EvidenceCandidate[] | null>(null);
  const [chosen, setChosen] = useState<Set<number>>(new Set());
  const [consent, setConsent] = useState(false);
  const [alsoBlock, setAlsoBlock] = useState(!isGroup);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<ReportResult | null>(null);

  // The recent messages, decrypted here. Nothing is sent from this effect.
  useEffect(() => {
    if (!id) return;
    let cancelled = false;
    (async () => {
      try {
        const dtos = await listMessages(id, 40);
        const text = new Map<string, string>();
        for (const m of dtos) {
          if (m.message_type && m.message_type !== 'text' && m.message_type !== 'reply') continue;
          text.set(String(m.id), await decryptMessageContent(m, me, chat?.peer_user_id));
        }
        if (!cancelled) setCandidates(evidenceCandidates(dtos, text, me));
      } catch {
        if (!cancelled) setCandidates([]);
      }
    })();
    return () => {
      cancelled = true;
    };
    // The chat row is read once; the messages do not depend on it changing.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, me]);

  const evidence = useMemo(() => buildEvidence(candidates ?? [], chosen), [candidates, chosen]);
  const needsConsent = evidence.length > 0;
  const canSend = !!reason && (!needsConsent || consent) && !busy;

  const toggle = (messageId: number) =>
    setChosen((prev) => {
      const next = new Set(prev);
      if (next.has(messageId)) next.delete(messageId);
      else if (next.size < MAX_EVIDENCE) next.add(messageId);
      return next;
    });

  const submit = async () => {
    if (!id || !reason || !canSend) return;
    setBusy(true);
    try {
      const res = await reportChat(id, reason, {
        note: note.trim(),
        block: alsoBlock && !isGroup,
        consent: needsConsent && consent,
        evidence,
      });
      void refreshChats();
      if (res.blocked) void refreshBlocks();
      setResult(res);
    } catch {
      appAlert(t('report.failed_title'), t('report.failed_body'));
    } finally {
      setBusy(false);
    }
  };

  if (result) {
    return <Sent result={result} name={name} isGroup={isGroup} />;
  }

  return (
    <SafeAreaView style={[styles.screen, { backgroundColor: colors.background }]} edges={['top', 'bottom']}>
      <StatusBar style={isDark ? 'light' : 'dark'} />

      <View style={styles.topBar}>
        <Pressable
          onPress={() => router.back()}
          hitSlop={10}
          style={[styles.iconBtn, { backgroundColor: colors.surfaceMuted }]}
          accessibilityRole="button"
          accessibilityLabel={t('common.close')}
        >
          <Ionicons name="close" size={22} color={colors.text} />
        </Pressable>
        <Text style={[styles.topTitle, { color: colors.text }]}>{t('report.title')}</Text>
        <View style={styles.iconBtn} />
      </View>

      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView
          contentContainerStyle={styles.body}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          {/* Who, and what a report is */}
          <View style={styles.intro}>
            <View style={[styles.introIcon, { backgroundColor: `${colors.danger}1A` }]}>
              <Ionicons name="flag" size={26} color={colors.danger} />
            </View>
            <Text style={[styles.introTitle, { color: colors.text }]} numberOfLines={2}>
              {t('report.heading', { name })}
            </Text>
            <Text style={[styles.introBody, { color: colors.textSecondary }]}>{t('report.intro')}</Text>
          </View>

          {/* What happened */}
          <Text style={[styles.section, { color: colors.textMuted }]}>{t('report.what_happened')}</Text>
          <View style={styles.reasons}>
            {REPORT_REASONS.map((r) => {
              const on = reason === r.id;
              return (
                <Pressable
                  key={r.id}
                  onPress={() => setReason(r.id)}
                  accessibilityRole="radio"
                  accessibilityState={{ selected: on }}
                  style={[
                    styles.reason,
                    {
                      backgroundColor: colors.surface,
                      borderColor: on ? colors.primary : colors.divider,
                    },
                    on && { backgroundColor: `${colors.primary}0F` },
                  ]}
                >
                  <View
                    style={[
                      styles.reasonIcon,
                      { backgroundColor: on ? colors.primary : colors.surfaceMuted },
                    ]}
                  >
                    <Ionicons name={r.icon} size={18} color={on ? colors.onPrimary : colors.textSecondary} />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={[styles.reasonLabel, { color: colors.text }]}>{t(`report.reason_${r.id}`)}</Text>
                    <Text style={[styles.reasonHint, { color: colors.textSecondary }]}>
                      {t(`report.reason_${r.id}_hint`)}
                    </Text>
                  </View>
                  <Ionicons
                    name={on ? 'radio-button-on' : 'radio-button-off'}
                    size={22}
                    color={on ? colors.primary : colors.border}
                  />
                </Pressable>
              );
            })}
          </View>

          {/* Anything to add */}
          <Text style={[styles.section, { color: colors.textMuted }]}>{t('report.add_context')}</Text>
          <View style={[styles.noteBox, { backgroundColor: colors.surface, borderColor: colors.divider }]}>
            <TextInput
              value={note}
              onChangeText={setNote}
              placeholder={t('report.note_placeholder')}
              placeholderTextColor={colors.textMuted}
              multiline
              maxLength={MAX_NOTE}
              style={[styles.noteInput, { color: colors.text }]}
            />
            <Text style={[styles.counter, { color: colors.textMuted }]}>
              {note.length}/{MAX_NOTE}
            </Text>
          </View>

          {/* Messages as proof */}
          <View style={styles.sectionRow}>
            <Text style={[styles.section, { color: colors.textMuted, marginTop: 0 }]}>
              {t('report.messages_title')}
            </Text>
            {candidates && candidates.length > 0 ? (
              <Pressable
                onPress={() =>
                  setChosen(
                    chosen.size > 0 ? new Set() : new Set(candidates.slice(-MAX_EVIDENCE).map((c) => c.id)),
                  )
                }
                hitSlop={8}
              >
                <Text style={[styles.link, { color: colors.primary }]}>
                  {chosen.size > 0 ? t('report.clear') : t('report.select_recent')}
                </Text>
              </Pressable>
            ) : null}
          </View>
          <Text style={[styles.sectionHint, { color: colors.textSecondary }]}>{t('report.messages_hint')}</Text>

          {candidates === null ? (
            <View style={styles.loading}>
              <ActivityIndicator color={colors.primary} />
            </View>
          ) : candidates.length === 0 ? (
            <View style={[styles.empty, { backgroundColor: colors.surface, borderColor: colors.divider }]}>
              <Ionicons name="chatbubble-outline" size={20} color={colors.textMuted} />
              <Text style={[styles.emptyText, { color: colors.textSecondary }]}>{t('report.no_messages')}</Text>
            </View>
          ) : (
            <View style={[styles.messages, { backgroundColor: colors.surface, borderColor: colors.divider }]}>
              {candidates.map((c, i) => {
                const on = chosen.has(c.id);
                return (
                  <Pressable
                    key={c.id}
                    onPress={() => toggle(c.id)}
                    accessibilityRole="checkbox"
                    accessibilityState={{ checked: on }}
                    style={[
                      styles.messageRow,
                      i > 0 && { borderTopColor: colors.divider, borderTopWidth: StyleSheet.hairlineWidth },
                      on && { backgroundColor: `${colors.primary}0F` },
                    ]}
                  >
                    <Ionicons
                      name={on ? 'checkmark-circle' : 'ellipse-outline'}
                      size={22}
                      color={on ? colors.primary : colors.border}
                    />
                    <View style={{ flex: 1, gap: 2 }}>
                      <View style={styles.messageMeta}>
                        <Text style={[styles.messageWho, { color: c.fromMe ? colors.primary : colors.textSecondary }]}>
                          {c.fromMe ? t('report.you') : name}
                        </Text>
                        <Text style={[styles.messageTime, { color: colors.textMuted }]}>{formatMsgTime(c.sentAt)}</Text>
                      </View>
                      <Text style={[styles.messageText, { color: colors.text }]} numberOfLines={3}>
                        {c.text}
                      </Text>
                    </View>
                  </Pressable>
                );
              })}
            </View>
          )}

          {/* Consent: only when something readable would be sent */}
          {needsConsent ? (
            <View style={[styles.consent, { backgroundColor: colors.surface, borderColor: colors.primary }]}>
              <View style={styles.consentHead}>
                <Ionicons name="lock-open-outline" size={18} color={colors.primary} />
                <Text style={[styles.consentTitle, { color: colors.text }]}>
                  {t('report.consent_title', { count: evidence.length })}
                </Text>
              </View>
              <Text style={[styles.consentBody, { color: colors.textSecondary }]}>{t('report.consent_body')}</Text>
              <View style={styles.consentRow}>
                <Text style={[styles.consentLabel, { color: colors.text }]}>{t('report.consent_label')}</Text>
                <Switch
                  value={consent}
                  onValueChange={setConsent}
                  trackColor={{ false: colors.border, true: colors.primary }}
                  thumbColor="#FFFFFF"
                  accessibilityLabel={t('report.consent_label')}
                />
              </View>
            </View>
          ) : null}

          {/* What follows */}
          <Text style={[styles.section, { color: colors.textMuted }]}>{t('report.what_next')}</Text>
          <View style={[styles.next, { backgroundColor: colors.surface, borderColor: colors.divider }]}>
            {!isGroup ? (
              <>
                <NextRow icon="shield-checkmark" text={t('report.next_pause')} />
                <NextRow icon="eye-off-outline" text={t('report.next_neutral')} border />
              </>
            ) : null}
            <NextRow icon="people-outline" text={t('report.next_review')} border={!isGroup} />
          </View>

          {!isGroup ? (
            <View style={[styles.blockRow, { backgroundColor: colors.surface, borderColor: colors.divider }]}>
              <View style={{ flex: 1 }}>
                <Text style={[styles.reasonLabel, { color: colors.text }]}>{t('report.also_block', { name })}</Text>
                <Text style={[styles.reasonHint, { color: colors.textSecondary }]}>{t('report.also_block_hint')}</Text>
              </View>
              <Switch
                value={alsoBlock}
                onValueChange={setAlsoBlock}
                trackColor={{ false: colors.border, true: colors.primary }}
                thumbColor="#FFFFFF"
                accessibilityLabel={t('report.also_block', { name })}
              />
            </View>
          ) : null}
        </ScrollView>

        <View style={[styles.footer, { backgroundColor: colors.background, borderTopColor: colors.divider }]}>
          {needsConsent && !consent ? (
            <Text style={[styles.footerHint, { color: colors.textSecondary }]}>{t('report.need_consent')}</Text>
          ) : null}
          <PrimaryButton
            label={t('report.send')}
            onPress={() => void submit()}
            disabled={!canSend}
            loading={busy}
          />
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

function NextRow({
  icon,
  text,
  border,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  text: string;
  border?: boolean;
}) {
  const { colors } = useTheme();
  return (
    <View
      style={[
        styles.nextRow,
        border && { borderTopColor: colors.divider, borderTopWidth: StyleSheet.hairlineWidth },
      ]}
    >
      <Ionicons name={icon} size={20} color={colors.primary} />
      <Text style={[styles.nextText, { color: colors.text }]}>{text}</Text>
    </View>
  );
}

/** The confirmation: what was sent and what happens now, in plain terms. */
function Sent({ result, name, isGroup }: { result: ReportResult; name: string; isGroup: boolean }) {
  const { colors, isDark } = useTheme();
  const left = noContactRemaining(result.no_contact_until);
  return (
    <SafeAreaView style={[styles.screen, { backgroundColor: colors.background }]} edges={['top', 'bottom']}>
      <StatusBar style={isDark ? 'light' : 'dark'} />
      <View style={styles.sentBody}>
        <View style={[styles.sentIcon, { backgroundColor: `${colors.success}1F` }]}>
          <Ionicons name="checkmark-circle" size={56} color={colors.success} />
        </View>
        <Text style={[styles.sentTitle, { color: colors.text }]}>{t('report.sent_title')}</Text>
        <Text style={[styles.sentText, { color: colors.textSecondary }]}>
          {t('report.sent_body', { name })}
        </Text>

        <View style={[styles.summary, { backgroundColor: colors.surface, borderColor: colors.divider }]}>
          <SummaryRow
            icon="document-text-outline"
            text={
              result.evidence_count > 0
                ? t('report.sent_evidence', { count: result.evidence_count })
                : t('report.sent_no_evidence')
            }
          />
          {!isGroup && left ? (
            <SummaryRow
              icon="shield-checkmark"
              border
              text={t('report.sent_pause', {
                time: left.hours > 0 ? t('report.time_left_hours', { hours: left.hours, minutes: left.minutes }) : t('report.time_left_minutes', { minutes: left.minutes }),
              })}
            />
          ) : null}
          {result.blocked ? <SummaryRow icon="ban-outline" border text={t('report.sent_blocked', { name })} /> : null}
        </View>
      </View>
      <View style={styles.footer}>
        <PrimaryButton label={t('common.done')} onPress={() => router.replace('/(tabs)')} />
      </View>
    </SafeAreaView>
  );
}

function SummaryRow({
  icon,
  text,
  border,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  text: string;
  border?: boolean;
}) {
  const { colors } = useTheme();
  return (
    <View
      style={[
        styles.nextRow,
        border && { borderTopColor: colors.divider, borderTopWidth: StyleSheet.hairlineWidth },
      ]}
    >
      <Ionicons name={icon} size={20} color={colors.textSecondary} />
      <Text style={[styles.nextText, { color: colors.text }]}>{text}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  topBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: Spacing.lg,
    height: 56,
  },
  iconBtn: {
    width: Sizes.iconButton,
    height: Sizes.iconButton,
    borderRadius: Sizes.iconButton / 2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  topTitle: { ...Typography.h3 },
  body: { paddingHorizontal: Spacing.lg, paddingBottom: Spacing.xl, gap: Spacing.sm },

  intro: { alignItems: 'center', gap: Spacing.sm, paddingVertical: Spacing.lg },
  introIcon: { width: 60, height: 60, borderRadius: 30, alignItems: 'center', justifyContent: 'center' },
  introTitle: { ...Typography.h2, textAlign: 'center' },
  introBody: { ...Typography.callout, textAlign: 'center', maxWidth: 320 },

  section: {
    ...Typography.label,
    textTransform: 'uppercase',
    marginTop: Spacing.lg,
    marginBottom: Spacing.xs,
    letterSpacing: 0.4,
  },
  sectionRow: {
    flexDirection: 'row',
    alignItems: 'baseline',
    justifyContent: 'space-between',
    marginTop: Spacing.lg,
  },
  sectionHint: { ...Typography.caption, marginBottom: Spacing.sm },
  link: { ...Typography.label },

  reasons: { gap: Spacing.sm },
  reason: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.md,
    padding: Spacing.md,
    borderRadius: Radii.lg,
    borderWidth: 1.5,
  },
  reasonIcon: { width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center' },
  reasonLabel: { ...Typography.bodyStrong },
  reasonHint: { ...Typography.caption },

  noteBox: { borderRadius: Radii.lg, borderWidth: 1, padding: Spacing.md },
  noteInput: { ...Typography.body, minHeight: 72, textAlignVertical: 'top', padding: 0 },
  counter: { ...Typography.micro, alignSelf: 'flex-end', marginTop: Spacing.xs, fontVariant: ['tabular-nums'] },

  loading: { paddingVertical: Spacing.xl, alignItems: 'center' },
  empty: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
    padding: Spacing.lg,
    borderRadius: Radii.lg,
    borderWidth: 1,
  },
  emptyText: { ...Typography.callout, flex: 1 },
  messages: { borderRadius: Radii.lg, borderWidth: 1, overflow: 'hidden' },
  messageRow: { flexDirection: 'row', gap: Spacing.md, padding: Spacing.md, alignItems: 'flex-start' },
  messageMeta: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline' },
  messageWho: { ...Typography.label },
  messageTime: { ...Typography.micro },
  messageText: { ...Typography.callout },

  consent: {
    marginTop: Spacing.lg,
    borderRadius: Radii.lg,
    borderWidth: 1.5,
    padding: Spacing.md,
    gap: Spacing.sm,
    ...Shadows.sm,
  },
  consentHead: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm },
  consentTitle: { ...Typography.bodyStrong, flex: 1 },
  consentBody: { ...Typography.caption },
  consentRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.md, marginTop: Spacing.xs },
  consentLabel: { ...Typography.label, flex: 1 },

  next: { borderRadius: Radii.lg, borderWidth: 1, overflow: 'hidden' },
  nextRow: { flexDirection: 'row', gap: Spacing.md, padding: Spacing.md, alignItems: 'center' },
  nextText: { ...Typography.callout, flex: 1 },
  blockRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.md,
    marginTop: Spacing.sm,
    padding: Spacing.md,
    borderRadius: Radii.lg,
    borderWidth: 1,
  },

  footer: {
    paddingHorizontal: Spacing.lg,
    paddingTop: Spacing.md,
    paddingBottom: Spacing.sm,
    gap: Spacing.sm,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  footerHint: { ...Typography.caption, textAlign: 'center' },

  sentBody: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: Spacing.xl, gap: Spacing.md },
  sentIcon: { width: 96, height: 96, borderRadius: 48, alignItems: 'center', justifyContent: 'center' },
  sentTitle: { ...Typography.h1, textAlign: 'center' },
  sentText: { ...Typography.callout, textAlign: 'center' },
  summary: { alignSelf: 'stretch', borderRadius: Radii.lg, borderWidth: 1, overflow: 'hidden', marginTop: Spacing.md },
});
