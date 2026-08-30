import { Ionicons } from '@expo/vector-icons';
import { useEffect, useRef, useState } from 'react';
import {
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  StyleSheet,
  View,
} from 'react-native';

import { Text, TextInput } from '@/components/ui/text';
import { Radii, Spacing, Typography } from '@/constants/theme';
import { getNote, setNote } from '@/data/db/notes';
import { useTheme } from '@/hooks/use-theme';
import { t } from '@/i18n';

/**
 * A private note about a conversation.
 *
 * Autosaves — a note is a scrap of thought, and losing it to a stray back
 * gesture is the whole failure mode. The save is debounced so typing does
 * not hit the database on every keystroke.
 */
export function NoteEditor({
  visible,
  chatId,
  onClose,
}: {
  visible: boolean;
  chatId: string;
  onClose: (saved: string) => void;
}) {
  const { colors } = useTheme();
  const [body, setBody] = useState('');
  const [loaded, setLoaded] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (!visible) return;
    setLoaded(false);
    getNote(chatId)
      .then((n) => {
        setBody(n?.body ?? '');
        setLoaded(true);
      })
      .catch(() => setLoaded(true));
  }, [visible, chatId]);

  // Debounced autosave. Only after the initial load, or an empty editor
  // would immediately overwrite the note it has not read yet.
  useEffect(() => {
    if (!visible || !loaded) return;
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      void setNote(chatId, body);
    }, 600);
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
  }, [body, visible, loaded, chatId]);

  const close = () => {
    if (timer.current) clearTimeout(timer.current);
    // Flush immediately: the debounce must not lose the last keystrokes.
    void setNote(chatId, body).finally(() => onClose(body.trim()));
  };

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={close}>
      <Pressable style={styles.scrim} onPress={close}>
        <KeyboardAvoidingView
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
          style={styles.bottom}
        >
          <Pressable style={[styles.sheet, { backgroundColor: colors.surface }]} onPress={() => {}}>
            <View style={[styles.grabber, { backgroundColor: colors.border }]} />

            <View style={styles.header}>
              <Text style={[styles.title, { color: colors.text }]}>
                {t('chat_info.add_notes')}
              </Text>
              <Pressable onPress={close} hitSlop={10} accessibilityRole="button">
                <Text style={[styles.done, { color: colors.primary }]}>{t('common.done')}</Text>
              </Pressable>
            </View>

            <View style={styles.privacy}>
              <Ionicons name="phone-portrait-outline" size={14} color={colors.textMuted} />
              <Text style={[styles.privacyText, { color: colors.textMuted }]}>
                {t('notes.private')}
              </Text>
            </View>

            <TextInput
              value={body}
              onChangeText={setBody}
              multiline
              autoFocus
              textAlignVertical="top"
              placeholder={t('notes.placeholder')}
              placeholderTextColor={colors.textMuted}
              style={[
                styles.input,
                { backgroundColor: colors.surfaceMuted, color: colors.text, borderColor: colors.border },
              ]}
              accessibilityLabel={t('chat_info.add_notes')}
            />
          </Pressable>
        </KeyboardAvoidingView>
      </Pressable>
    </Modal>
  );
}

const styles = StyleSheet.create({
  scrim: { flex: 1, backgroundColor: 'rgba(0,0,0,0.45)' },
  bottom: { flex: 1, justifyContent: 'flex-end' },
  sheet: {
    borderTopLeftRadius: Radii.xl,
    borderTopRightRadius: Radii.xl,
    padding: Spacing.lg,
    paddingBottom: Spacing.xl,
    gap: Spacing.sm,
  },
  grabber: { width: 40, height: 4, borderRadius: 2, alignSelf: 'center' },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  title: { ...Typography.h3 },
  done: { ...Typography.bodyStrong },
  privacy: { flexDirection: 'row', alignItems: 'center', gap: Spacing.xs },
  privacyText: { ...Typography.caption },
  input: {
    minHeight: 160,
    borderRadius: Radii.md,
    borderWidth: StyleSheet.hairlineWidth,
    padding: Spacing.md,
    ...Typography.body,
  },
});
