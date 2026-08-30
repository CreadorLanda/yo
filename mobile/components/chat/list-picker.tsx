import { Ionicons } from '@expo/vector-icons';
import { useState } from 'react';
import {
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  View,
} from 'react-native';

import { Text, TextInput } from '@/components/ui/text';
import { Radii, Spacing, Typography } from '@/constants/theme';
import {
  addCustomFilter,
  setFilterMembership,
  useCustomFilters,
} from '@/data/filter-store';
import { useTheme } from '@/hooks/use-theme';
import { t } from '@/i18n';

/**
 * Put a conversation into named lists.
 *
 * Toggles apply immediately rather than on a Save button. There is nothing
 * to lose by tapping — a wrong tap is undone by tapping again — and a
 * confirm step on a reversible toggle only adds a decision.
 */
export function ListPicker({
  visible,
  chatId,
  onClose,
}: {
  visible: boolean;
  chatId: string;
  onClose: () => void;
}) {
  const { colors } = useTheme();
  const lists = useCustomFilters();
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState('');

  const create = async () => {
    const trimmed = name.trim();
    if (!trimmed) return;
    await addCustomFilter(trimmed, [chatId]);
    setName('');
    setCreating(false);
  };

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <Pressable style={styles.scrim} onPress={onClose}>
        <KeyboardAvoidingView
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
          style={styles.bottom}
        >
          <Pressable
            style={[styles.sheet, { backgroundColor: colors.surface }]}
            onPress={() => {}}
          >
            <View style={[styles.grabber, { backgroundColor: colors.border }]} />
            <Text style={[styles.title, { color: colors.text }]}>
              {t('chat_info.add_to_lists')}
            </Text>
            <Text style={[styles.hint, { color: colors.textSecondary }]}>
              {t('lists.hint')}
            </Text>

            <ScrollView style={styles.scroll} keyboardShouldPersistTaps="handled">
              {lists.length === 0 && !creating ? (
                <Text style={[styles.empty, { color: colors.textMuted }]}>
                  {t('lists.empty')}
                </Text>
              ) : null}

              {lists.map((l) => {
                const member = l.chatIds.includes(chatId);
                return (
                  <Pressable
                    key={l.id}
                    onPress={() => void setFilterMembership(l.id, chatId, !member)}
                    style={({ pressed }) => [
                      styles.row,
                      pressed && { backgroundColor: colors.surfaceMuted },
                    ]}
                    accessibilityRole="checkbox"
                    accessibilityState={{ checked: member }}
                  >
                    <View
                      style={[
                        styles.check,
                        {
                          borderColor: member ? colors.primary : colors.border,
                          backgroundColor: member ? colors.primary : 'transparent',
                        },
                      ]}
                    >
                      {member ? <Ionicons name="checkmark" size={14} color={colors.onPrimary} /> : null}
                    </View>
                    <Text style={[styles.rowLabel, { color: colors.text }]} numberOfLines={1}>
                      {l.name}
                    </Text>
                    <Text style={[styles.count, { color: colors.textMuted }]}>
                      {l.chatIds.length}
                    </Text>
                  </Pressable>
                );
              })}

              {creating ? (
                <View style={styles.createRow}>
                  <TextInput
                    value={name}
                    onChangeText={setName}
                    autoFocus
                    placeholder={t('lists.name_placeholder')}
                    placeholderTextColor={colors.textMuted}
                    onSubmitEditing={() => void create()}
                    style={[
                      styles.input,
                      { backgroundColor: colors.surfaceMuted, color: colors.text, borderColor: colors.border },
                    ]}
                  />
                  <Pressable
                    onPress={() => void create()}
                    style={[styles.createBtn, { backgroundColor: colors.primary }]}
                    accessibilityRole="button"
                  >
                    <Ionicons name="checkmark" size={18} color={colors.onPrimary} />
                  </Pressable>
                </View>
              ) : (
                <Pressable
                  onPress={() => setCreating(true)}
                  style={({ pressed }) => [styles.row, pressed && { backgroundColor: colors.surfaceMuted }]}
                  accessibilityRole="button"
                >
                  <View style={[styles.check, { borderColor: colors.primary }]}>
                    <Ionicons name="add" size={14} color={colors.primary} />
                  </View>
                  <Text style={[styles.rowLabel, { color: colors.primary }]}>
                    {t('lists.create')}
                  </Text>
                </Pressable>
              )}
            </ScrollView>

            <Pressable
              onPress={onClose}
              style={[styles.done, { backgroundColor: colors.primary }]}
              accessibilityRole="button"
            >
              <Text style={[styles.doneText, { color: colors.onPrimary }]}>
                {t('common.done')}
              </Text>
            </Pressable>
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
    gap: Spacing.xs,
    maxHeight: '75%',
  },
  grabber: { width: 40, height: 4, borderRadius: 2, alignSelf: 'center', marginBottom: Spacing.sm },
  title: { ...Typography.h3 },
  hint: { ...Typography.caption, marginBottom: Spacing.xs },
  scroll: { flexGrow: 0 },
  empty: { ...Typography.body, textAlign: 'center', paddingVertical: Spacing.lg },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.md,
    paddingVertical: Spacing.md,
    paddingHorizontal: Spacing.xs,
  },
  check: {
    width: 22,
    height: 22,
    borderRadius: Radii.sm,
    borderWidth: 1.5,
    alignItems: 'center',
    justifyContent: 'center',
  },
  rowLabel: { ...Typography.body, flex: 1 },
  count: { ...Typography.caption },
  createRow: { flexDirection: 'row', gap: Spacing.sm, alignItems: 'center', paddingVertical: Spacing.sm },
  input: {
    flex: 1,
    borderRadius: Radii.md,
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm,
    ...Typography.body,
  },
  createBtn: { width: 40, height: 40, borderRadius: Radii.md, alignItems: 'center', justifyContent: 'center' },
  done: { paddingVertical: Spacing.md, borderRadius: Radii.md, alignItems: 'center', marginTop: Spacing.sm },
  doneText: { ...Typography.bodyStrong },
});
