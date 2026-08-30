import { Ionicons } from '@expo/vector-icons';
import { router, useLocalSearchParams } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useEffect, useMemo, useState } from 'react';
import { FlatList, Linking, Pressable, StyleSheet, View, useWindowDimensions } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { MediaViewer, type ViewerItem } from '@/components/chat/media-viewer';
import { CachedImage } from '@/components/ui/cached-image';
import { Text } from '@/components/ui/text';
import { Radii, Spacing, Typography } from '@/constants/theme';
import { listMessages } from '@/data/api/messages';
import { getCurrentUser } from '@/data/auth-store';
import { mapApiMessage } from '@/data/message-map';
import { type Message } from '@/data/mock';
import { useTheme } from '@/hooks/use-theme';
import { t } from '@/i18n';

type Tab = 'media' | 'docs' | 'links';

/** Matches bare and schemed URLs in message text. */
const URL_RE = /\b(?:https?:\/\/|www\.)[^\s<>()]+/gi;

/**
 * Everything shared in a conversation, split the way people look for it.
 *
 * The details screen showed six thumbnails under a "files, links and
 * documents" heading and stopped there — the heading promised three
 * categories, only one of which existed, and none of it was reachable past
 * the sixth item.
 */
export default function ChatMediaScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { colors, isDark } = useTheme();
  const { width } = useWindowDimensions();
  const [messages, setMessages] = useState<Message[]>([]);
  const [tab, setTab] = useState<Tab>('media');

  useEffect(() => {
    if (!id) return;
    let cancelled = false;
    const me = getCurrentUser()?.id;
    // A larger page than the details screen: this is the archive, so it is
    // worth paying for depth the preview strip did not need.
    listMessages(id, 200)
      .then((list) => {
        if (cancelled || !list) return;
        setMessages([...list].reverse().map((m) => mapApiMessage(m, me)));
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [id]);

  const media = useMemo(
    () =>
      messages
        .filter((m) => !m.deletedAt && m.media && m.media.type !== 'audio')
        .reverse(),
    [messages],
  );

  const docs = useMemo(
    () =>
      messages
        .filter((m) => !m.deletedAt && (m.attachment?.kind === 'document' || m.media?.type === 'audio'))
        .reverse(),
    [messages],
  );

  const links = useMemo(() => {
    const out: { key: string; url: string; msg: Message }[] = [];
    for (const m of messages) {
      if (m.deletedAt || !m.text) continue;
      for (const raw of m.text.match(URL_RE) ?? []) {
        out.push({ key: `${m.id}-${raw}`, url: raw, msg: m });
      }
    }
    return out.reverse();
  }, [messages]);

  const counts: Record<Tab, number> = {
    media: media.length,
    docs: docs.length,
    links: links.length,
  };

  const cell = Math.floor((width - Spacing.lg * 2 - Spacing.xs * 2) / 3);

  // The viewer swipes across the whole archive, not just the tapped item —
  // opening one photo and being stuck on it is the thing that makes a
  // gallery feel broken.
  const viewerItems = useMemo<ViewerItem[]>(
    () =>
      media.map((m) => ({
        id: m.id,
        uri: m.media!.uri,
        type: m.media!.type === 'video' ? 'video' : 'image',
        senderName: m.fromMe ? t('chat.you') : m.senderName,
        timestamp: m.timestamp,
        mediaKey: m.media!.key,
        mime: m.media!.mime,
      })),
    [media],
  );
  const [viewerAt, setViewerAt] = useState<number | null>(null);

  /**
   * Jump to the message this attachment came from.
   *
   * Reply and forward both belong in the conversation, where the composer
   * and the recipient picker live. Rebuilding either here would be a second
   * implementation of the same thing.
   */
  const openInChat = (messageId: string) => {
    setViewerAt(null);
    router.push(`/chat/${id}?focus=${messageId}`);
  };

  const open = (url: string) => {
    const href = url.startsWith('http') ? url : `https://${url}`;
    Linking.openURL(href).catch(() => {});
  };

  return (
    <SafeAreaView style={[styles.safe, { backgroundColor: colors.background }]} edges={['top']}>
      <StatusBar style={isDark ? 'light' : 'dark'} />

      <View style={[styles.header, { borderBottomColor: colors.border }]}>
        <Pressable onPress={() => router.back()} hitSlop={12} accessibilityRole="button">
          <Ionicons name="chevron-back" size={26} color={colors.text} />
        </Pressable>
        <Text style={[styles.title, { color: colors.text }]}>
          {t('chat_info.files_links_documents')}
        </Text>
        <View style={{ width: 26 }} />
      </View>

      <View style={[styles.tabs, { borderBottomColor: colors.border }]}>
        {(['media', 'docs', 'links'] as Tab[]).map((k) => (
          <Pressable
            key={k}
            onPress={() => setTab(k)}
            style={[styles.tab, tab === k && { borderBottomColor: colors.primary }]}
            accessibilityRole="tab"
            accessibilityState={{ selected: tab === k }}
          >
            <Text
              style={[
                styles.tabText,
                { color: tab === k ? colors.primary : colors.textSecondary },
              ]}
            >
              {t(`chat_media.${k}`)} {counts[k] > 0 ? counts[k] : ''}
            </Text>
          </Pressable>
        ))}
      </View>

      {tab === 'media' ? (
        <FlatList
          key="media"
          data={media}
          numColumns={3}
          keyExtractor={(m) => m.id}
          contentContainerStyle={media.length === 0 ? styles.emptyWrap : styles.grid}
          columnWrapperStyle={media.length > 0 ? { gap: Spacing.xs } : undefined}
          ListEmptyComponent={<Empty icon="images-outline" label={t('chat_media.no_media')} />}
          renderItem={({ item, index }) => (
            <Pressable
              onPress={() => setViewerAt(index)}
              style={{ width: cell, height: cell, borderRadius: Radii.md, overflow: 'hidden' }}
              accessibilityRole="imagebutton"
              accessibilityLabel={t('chat_media.open_item')}
            >
              <CachedImage
                url={item.media!.uri}
                mediaKey={item.media!.key}
                mime={item.media!.mime}
                sizeBytes={item.media!.sizeBytes}
                style={{ width: '100%', height: '100%' }}
                contentFit="cover"
              />
              {item.media!.type === 'video' ? (
                <View style={styles.playBadge}>
                  <Ionicons name="play" size={12} color="#fff" />
                </View>
              ) : null}
            </Pressable>
          )}
        />
      ) : tab === 'docs' ? (
        <FlatList
          key="docs"
          data={docs}
          keyExtractor={(m) => m.id}
          contentContainerStyle={docs.length === 0 ? styles.emptyWrap : undefined}
          ListEmptyComponent={<Empty icon="document-outline" label={t('chat_media.no_docs')} />}
          ItemSeparatorComponent={() => (
            <View style={[styles.sep, { backgroundColor: colors.divider }]} />
          )}
          renderItem={({ item }) => {
            const isAudio = item.media?.type === 'audio';
            const name = isAudio
              ? t('chat.voice_message')
              : item.attachment?.kind === 'document'
                ? item.attachment.name
                : t('chat_media.file');
            return (
              <Pressable
                onPress={() => openInChat(item.id)}
                style={({ pressed }) => [styles.row, pressed && { backgroundColor: colors.surfaceMuted }]}
                accessibilityRole="button"
                accessibilityLabel={t('chat_media.open_in_chat')}
              >
                <View style={[styles.fileIcon, { backgroundColor: colors.surfaceMuted }]}>
                  <Ionicons
                    name={isAudio ? 'musical-notes' : 'document-text'}
                    size={20}
                    color={colors.primary}
                  />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={[styles.rowLabel, { color: colors.text }]} numberOfLines={1}>
                    {name}
                  </Text>
                  <Text style={[styles.rowSub, { color: colors.textSecondary }]}>
                    {item.timestamp}
                  </Text>
                </View>
                <Ionicons name="chevron-forward" size={16} color={colors.textMuted} />
              </Pressable>
            );
          }}
        />
      ) : (
        <FlatList
          key="links"
          data={links}
          keyExtractor={(l) => l.key}
          contentContainerStyle={links.length === 0 ? styles.emptyWrap : undefined}
          ListEmptyComponent={<Empty icon="link-outline" label={t('chat_media.no_links')} />}
          ItemSeparatorComponent={() => (
            <View style={[styles.sep, { backgroundColor: colors.divider }]} />
          )}
          renderItem={({ item }) => (
            <Pressable
              onPress={() => open(item.url)}
              style={({ pressed }) => [styles.row, pressed && { backgroundColor: colors.surfaceMuted }]}
              accessibilityRole="link"
            >
              <View style={[styles.fileIcon, { backgroundColor: colors.surfaceMuted }]}>
                <Ionicons name="link" size={20} color={colors.primary} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={[styles.rowLabel, { color: colors.primary }]} numberOfLines={1}>
                  {item.url}
                </Text>
                <Text style={[styles.rowSub, { color: colors.textSecondary }]} numberOfLines={1}>
                  {item.msg.timestamp}
                </Text>
              </View>
            </Pressable>
          )}
        />
      )}
      {viewerAt != null ? (
        <MediaViewer
          items={viewerItems}
          startIndex={viewerAt}
          onClose={() => setViewerAt(null)}
          onReply={openInChat}
          onForward={openInChat}
        />
      ) : null}
    </SafeAreaView>
  );
}

function Empty({ icon, label }: { icon: keyof typeof Ionicons.glyphMap; label: string }) {
  const { colors } = useTheme();
  return (
    <View style={styles.empty}>
      <Ionicons name={icon} size={40} color={colors.textMuted} />
      <Text style={[styles.emptyText, { color: colors.textSecondary }]}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1 },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: Spacing.lg,
    paddingVertical: Spacing.md,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  title: { ...Typography.h3 },
  tabs: { flexDirection: 'row', borderBottomWidth: StyleSheet.hairlineWidth },
  tab: {
    flex: 1,
    alignItems: 'center',
    paddingVertical: Spacing.md,
    borderBottomWidth: 2,
    borderBottomColor: 'transparent',
  },
  tabText: { ...Typography.bodyStrong },
  grid: { padding: Spacing.lg, gap: Spacing.xs },
  playBadge: {
    position: 'absolute',
    right: 6,
    bottom: 6,
    width: 22,
    height: 22,
    borderRadius: Radii.pill,
    backgroundColor: 'rgba(0,0,0,0.55)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.md,
    paddingHorizontal: Spacing.lg,
    paddingVertical: Spacing.md,
  },
  fileIcon: { width: 40, height: 40, borderRadius: Radii.md, alignItems: 'center', justifyContent: 'center' },
  rowLabel: { ...Typography.body },
  rowSub: { ...Typography.caption, marginTop: 2 },
  sep: { height: StyleSheet.hairlineWidth, marginLeft: 72 },
  emptyWrap: { flexGrow: 1, justifyContent: 'center' },
  empty: { alignItems: 'center', gap: Spacing.sm },
  emptyText: { ...Typography.body },
});
