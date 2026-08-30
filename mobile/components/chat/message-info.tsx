import { Ionicons } from '@expo/vector-icons';
import { useEffect, useState } from 'react';
import { ActivityIndicator, Modal, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Text } from '@/components/ui/text';
import { Radii, Spacing, Typography } from '@/constants/theme';
import { messageInfo, type ReceiptDetail } from '@/data/api/messages';
import { useTheme } from '@/hooks/use-theme';
import { t } from '@/i18n';

/**
 * Per-recipient delivery detail for one of your own messages.
 *
 * The server restricts this to the sender: who read your message is yours
 * to see, not the whole chat's.
 */
export function MessageInfoSheet({
  chatId,
  messageId,
  onClose,
}: {
  chatId: string;
  messageId: number | null;
  onClose: () => void;
}) {
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const [rows, setRows] = useState<ReceiptDetail[] | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    if (messageId == null) return;
    let cancelled = false;
    setRows(null);
    setFailed(false);
    messageInfo(chatId, messageId)
      .then((r) => !cancelled && setRows(r))
      .catch(() => !cancelled && setFailed(true));
    return () => {
      cancelled = true;
    };
  }, [chatId, messageId]);

  if (messageId == null) return null;

  const read = rows?.filter((r) => r.status === 'read') ?? [];
  const delivered = rows?.filter((r) => r.status === 'delivered') ?? [];

  return (
    <Modal visible transparent animationType="slide" onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={onClose}>
        <Pressable
          style={[
            styles.sheet,
            { backgroundColor: colors.surfaceElevated, paddingBottom: insets.bottom + Spacing.lg },
          ]}
          onPress={(e) => e.stopPropagation()}
        >
          <View style={[styles.grabber, { backgroundColor: colors.border }]} />
          <Text style={[styles.title, { color: colors.text }]}>{t('chat.message_info')}</Text>

          {rows === null && !failed ? (
            <ActivityIndicator style={{ marginVertical: Spacing.xl }} color={colors.primary} />
          ) : failed ? (
            <Text style={[styles.empty, { color: colors.textSecondary }]}>
              {t('chats.action_failed_body')}
            </Text>
          ) : !rows || rows.length === 0 ? (
            <Text style={[styles.empty, { color: colors.textSecondary }]}>
              {t('chat.info_pending')}
            </Text>
          ) : (
            <ScrollView style={{ maxHeight: 380 }}>
              <Section
                icon="checkmark-done"
                tint={colors.info}
                label={t('chat.info_read')}
                rows={read}
                colors={colors}
              />
              <Section
                icon="checkmark-done-outline"
                tint={colors.textSecondary}
                label={t('chat.info_delivered')}
                rows={delivered}
                colors={colors}
              />
            </ScrollView>
          )}
        </Pressable>
      </Pressable>
    </Modal>
  );
}

function Section({
  icon,
  tint,
  label,
  rows,
  colors,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  tint: string;
  label: string;
  rows: ReceiptDetail[];
  colors: ReturnType<typeof useTheme>['colors'];
}) {
  if (rows.length === 0) return null;
  return (
    <View style={styles.section}>
      <View style={styles.sectionHead}>
        <Ionicons name={icon} size={16} color={tint} />
        <Text style={[styles.sectionLabel, { color: tint }]}>{label}</Text>
      </View>
      {rows.map((r) => (
        <View key={`${r.status}:${r.user_id}`} style={styles.row}>
          <Text style={[styles.name, { color: colors.text }]} numberOfLines={1}>
            {r.display_name || r.username}
          </Text>
          <Text style={[styles.when, { color: colors.textSecondary }]}>{formatWhen(r.updated_at)}</Text>
        </View>
      ))}
    </View>
  );
}

/** Time for today, date and time for anything older. */
function formatWhen(iso: string): string {
  try {
    const d = new Date(iso);
    const today = new Date();
    const sameDay =
      d.getDate() === today.getDate() &&
      d.getMonth() === today.getMonth() &&
      d.getFullYear() === today.getFullYear();
    const time = d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    return sameDay ? time : `${d.toLocaleDateString()} ${time}`;
  } catch {
    return '';
  }
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.45)', justifyContent: 'flex-end' },
  sheet: {
    borderTopLeftRadius: Radii.xl,
    borderTopRightRadius: Radii.xl,
    paddingTop: Spacing.sm,
    paddingHorizontal: Spacing.lg,
  },
  grabber: { width: 38, height: 4, borderRadius: 2, alignSelf: 'center', marginBottom: Spacing.md },
  title: { ...Typography.h3, marginBottom: Spacing.md },
  empty: { ...Typography.body, paddingVertical: Spacing.lg, textAlign: 'center' },
  section: { marginBottom: Spacing.lg },
  sectionHead: { flexDirection: 'row', alignItems: 'center', gap: Spacing.xs, marginBottom: Spacing.sm },
  sectionLabel: { ...Typography.caption, fontWeight: '700', textTransform: 'uppercase' },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: Spacing.sm,
    gap: Spacing.md,
  },
  name: { ...Typography.body, flex: 1 },
  when: { ...Typography.caption },
});
