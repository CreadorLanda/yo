import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
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

import { CachedImage } from '@/components/ui/cached-image';
import { Text, TextInput } from '@/components/ui/text';
import { Radii, Spacing, Typography } from '@/constants/theme';
import { mediaFileURL } from '@/data/api/media';
import {
  anonInbox,
  anonMessages,
  blockAnon,
  replyAnon,
  revealAnon,
  type AnonMessage,
  type AnonThread,
} from '@/data/api/stories';
import { t } from '@/i18n';

/**
 * The author's side of the blind channel.
 *
 * There is nothing to identify a thread by — no name, no avatar, by design —
 * so threads are distinguished by their first line and their time. That is
 * the cost of the guarantee, and dressing it up with a fake identity would
 * only imply one exists.
 *
 * Dark and self-contained like the viewer it opens over.
 */
export function AnonInbox({
  visible,
  onClose,
}: {
  visible: boolean;
  onClose: () => void;
}) {
  const [threads, setThreads] = useState<AnonThread[] | null>(null);
  const [open, setOpen] = useState<AnonThread | null>(null);

  const load = useCallback(() => {
    anonInbox()
      .then((list) => setThreads(list ?? []))
      .catch(() => setThreads([]));
  }, []);

  useEffect(() => {
    if (!visible) return;
    setThreads(null);
    setOpen(null);
    load();
  }, [visible, load]);

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <Pressable style={styles.scrim} onPress={onClose}>
        <Pressable style={styles.sheet} onPress={() => {}}>
          <View style={styles.grabber} />

          {open ? (
            <AnonThreadView
              thread={open}
              asAuthor={open.role === 'author'}
              onBack={() => {
                setOpen(null);
                load();
              }}
              onBlocked={() => {
                setOpen(null);
                load();
              }}
              onGraduated={(chatId) => {
                setOpen(null);
                onClose();
                router.push(`/chat/${chatId}`);
              }}
            />
          ) : (
            <>
              <View style={styles.header}>
                <Ionicons name="eye-off-outline" size={18} color="#FFFFFF" />
                <Text style={styles.title}>{t('anon.inbox_title')}</Text>
              </View>
              <Text style={styles.subtitle}>{t('anon.inbox_hint')}</Text>

              {threads === null ? (
                <View style={styles.center}>
                  <ActivityIndicator color="#FFFFFF" />
                </View>
              ) : threads.length === 0 ? (
                <View style={styles.center}>
                  <Ionicons name="mail-outline" size={32} color="rgba(255,255,255,0.35)" />
                  <Text style={styles.muted}>{t('anon.inbox_empty')}</Text>
                </View>
              ) : (
                <FlatList
                  data={threads}
                  keyExtractor={(x) => x.id}
                  contentContainerStyle={styles.list}
                  renderItem={({ item }) => (
                    <Pressable
                      onPress={() => setOpen(item)}
                      style={({ pressed }) => [
                        styles.threadRow,
                        pressed && { backgroundColor: 'rgba(255,255,255,0.06)' },
                      ]}
                    >
                      {/* The story, not the person. There is no person to
                          show — the thumbnail is the only thing that can
                          tell one thread from another. */}
                      {item.story_media_url ? (
                        <CachedImage
                          url={mediaFileURL(item.story_media_url)}
                          style={styles.storyThumb}
                          contentFit="cover"
                        />
                      ) : (
                        <View style={styles.mask}>
                          <Ionicons name="chatbubble-outline" size={18} color="rgba(255,255,255,0.6)" />
                        </View>
                      )}
                      <View style={{ flex: 1 }}>
                        <Text style={styles.threadName} numberOfLines={1}>
                          {storyLabel(item)}
                        </Text>
                        <Text style={styles.threadPreview} numberOfLines={1}>
                          {item.preview || t('anon.no_messages')}
                        </Text>
                      </View>
                      <Ionicons name="chevron-forward" size={16} color="rgba(255,255,255,0.4)" />
                    </Pressable>
                  )}
                />
              )}
            </>
          )}
        </Pressable>
      </Pressable>
    </Modal>
  );
}

function AnonThreadView({
  thread,
  asAuthor,
  onBack,
  onBlocked,
  onGraduated,
}: {
  thread: AnonThread;
  /** Blocking belongs to the story's author; the other side cannot. */
  asAuthor: boolean;
  onBack: () => void;
  onBlocked: () => void;
  /** Both sides agreed; the thread is gone and a chat exists. */
  onGraduated: (chatId: string) => void;
}) {
  const [messages, setMessages] = useState<AnonMessage[] | null>(null);
  const [draft, setDraft] = useState('');
  const [sending, setSending] = useState(false);
  const [revealed, setRevealed] = useState(
    asAuthor ? thread.author_revealed : thread.sender_revealed,
  );

  useEffect(() => {
    anonMessages(thread.id)
      .then((m) => setMessages(m ?? []))
      .catch(() => setMessages([]));
  }, [thread.id]);

  const send = () => {
    const body = draft.trim();
    if (!body || sending) return;
    setSending(true);
    replyAnon(thread.id, body)
      .then((m) => {
        setMessages((prev) => [...(prev ?? []), m]);
        setDraft('');
      })
      .catch(() => {})
      .finally(() => setSending(false));
  };

  const bothKnown =
    revealed && (asAuthor ? thread.sender_revealed : thread.author_revealed);

  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      style={{ flex: 1 }}
    >
      <View style={styles.header}>
        <Pressable onPress={onBack} hitSlop={10}>
          <Ionicons name="chevron-back" size={22} color="#FFFFFF" />
        </Pressable>
        <View style={{ flex: 1 }}>
          <Text style={styles.title} numberOfLines={1}>
            {storyLabel(thread)}
          </Text>
          <Text style={styles.threadPreview}>
            {thread.story_expired ? t('anon.story_expired') : t('anon.someone')}
          </Text>
        </View>
        {asAuthor ? (
          <Pressable onPress={() => blockAnon(thread.id).then(onBlocked).catch(() => {})} hitSlop={10}>
            <Ionicons name="ban-outline" size={20} color="#F87171" />
          </Pressable>
        ) : null}
      </View>

      {messages === null ? (
        <View style={styles.center}>
          <ActivityIndicator color="#FFFFFF" />
        </View>
      ) : (
        <FlatList
          data={messages}
          keyExtractor={(m) => String(m.id)}
          contentContainerStyle={styles.list}
          renderItem={({ item }) => (
            <View
              style={[
                styles.bubble,
                item.from_author === asAuthor ? styles.bubbleMine : styles.bubbleTheirs,
              ]}
            >
              <Text style={styles.bubbleText}>{item.body}</Text>
            </View>
          )}
        />
      )}

      {/* Reveal is mutual: offering costs nothing until the other side
          offers too, which is why it says "offer" and not "reveal". */}
      <Pressable
        onPress={() => {
          if (revealed) return;
          setRevealed(true);
          revealAnon(thread.id)
            .then((res) => {
              const chatId = res && 'chat_id' in res ? res.chat_id : undefined;
              // Both agreed: this thread no longer exists. Close the sheet
              // and land in the real conversation rather than leaving an
              // empty blind thread on screen.
              if (chatId) onGraduated(chatId);
            })
            .catch(() => setRevealed(false));
        }}
        style={styles.revealRow}
      >
        <Ionicons
          name={bothKnown ? 'people' : revealed ? 'hourglass-outline' : 'eye-outline'}
          size={15}
          color="rgba(255,255,255,0.7)"
        />
        <Text style={styles.revealText}>
          {bothKnown
            ? t('anon.both_revealed')
            : revealed
              ? t('anon.waiting_other')
              : t('anon.offer_reveal')}
        </Text>
      </Pressable>

      <View style={styles.composer}>
        <TextInput
          value={draft}
          onChangeText={setDraft}
          placeholder={t('anon.reply_placeholder')}
          placeholderTextColor="rgba(255,255,255,0.4)"
          style={styles.input}
          multiline
        />
        <Pressable
          onPress={send}
          disabled={!draft.trim() || sending}
          style={[styles.send, { opacity: draft.trim() && !sending ? 1 : 0.4 }]}
        >
          <Ionicons name="arrow-up" size={18} color="#0B0C10" />
        </Pressable>
      </View>
    </KeyboardAvoidingView>
  );
}

/**
 * What a thread is about, in one line.
 *
 * Falls back to the kind when there is no caption — a photo story with no
 * words still has to be distinguishable from the three others beside it.
 */
function storyLabel(thread: AnonThread): string {
  const caption = thread.story_caption?.trim();
  if (caption) return caption;
  if (thread.story_kind) return t(`anon.kind_${thread.story_kind}` as never);
  return t('anon.story_gone');
}

const styles = StyleSheet.create({
  scrim: { flex: 1, backgroundColor: 'rgba(0,0,0,0.55)', justifyContent: 'flex-end' },
  sheet: {
    backgroundColor: '#14161C',
    borderTopLeftRadius: Radii.xl,
    borderTopRightRadius: Radii.xl,
    paddingTop: Spacing.sm,
    paddingBottom: Spacing.lg,
    height: '75%',
  },
  grabber: {
    width: 40,
    height: 4,
    borderRadius: 2,
    backgroundColor: 'rgba(255,255,255,0.25)',
    alignSelf: 'center',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
    paddingHorizontal: Spacing.lg,
    paddingVertical: Spacing.md,
  },
  title: { ...Typography.bodyStrong, color: '#FFFFFF' },
  subtitle: {
    ...Typography.caption,
    color: 'rgba(255,255,255,0.5)',
    paddingHorizontal: Spacing.lg,
    paddingBottom: Spacing.sm,
  },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: Spacing.sm },
  muted: { ...Typography.body, color: 'rgba(255,255,255,0.55)' },
  list: { paddingHorizontal: Spacing.lg, paddingBottom: Spacing.md, gap: Spacing.xs },
  threadRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.md, paddingVertical: Spacing.sm },
  mask: {
    width: 42,
    height: 42,
    borderRadius: Radii.pill,
    backgroundColor: 'rgba(255,255,255,0.08)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  threadName: { ...Typography.body, color: '#FFFFFF' },
  storyThumb: { width: 42, height: 42, borderRadius: Radii.md, backgroundColor: 'rgba(255,255,255,0.08)' },
  threadPreview: { ...Typography.caption, color: 'rgba(255,255,255,0.5)', marginTop: 2 },
  bubble: { maxWidth: '82%', borderRadius: Radii.lg, paddingHorizontal: 12, paddingVertical: 8 },
  bubbleMine: { alignSelf: 'flex-end', backgroundColor: '#3B82F6' },
  bubbleTheirs: { alignSelf: 'flex-start', backgroundColor: 'rgba(255,255,255,0.1)' },
  bubbleText: { ...Typography.body, color: '#FFFFFF' },
  revealRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.xs,
    paddingHorizontal: Spacing.lg,
    paddingVertical: Spacing.sm,
  },
  revealText: { ...Typography.caption, color: 'rgba(255,255,255,0.7)' },
  composer: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: Spacing.sm,
    paddingHorizontal: Spacing.lg,
  },
  input: {
    flex: 1,
    maxHeight: 100,
    backgroundColor: 'rgba(255,255,255,0.08)',
    borderRadius: Radii.lg,
    paddingHorizontal: 14,
    paddingVertical: 10,
    ...Typography.body,
    color: '#FFFFFF',
  },
  send: {
    width: 38,
    height: 38,
    borderRadius: Radii.pill,
    backgroundColor: '#FFFFFF',
    alignItems: 'center',
    justifyContent: 'center',
  },
});
