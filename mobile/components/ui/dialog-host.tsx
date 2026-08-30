import { useEffect, useState } from 'react';
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
import { dismissDialog, useDialog, type DialogButton } from '@/data/dialog-store';
import { useTheme } from '@/hooks/use-theme';

/**
 * Renders whatever dialog is currently open. Mounted once, at the root.
 *
 * Replaces the native Alert, which ignored the app's theme entirely, could
 * not take a text field on Android, and rendered a different shape on each
 * platform for what is the same question.
 */
export function DialogHost() {
  const { colors } = useTheme();
  const dialog = useDialog();
  const [value, setValue] = useState('');
  const [busy, setBusy] = useState(false);

  // Each dialog starts from its own initial value; carrying the last one
  // over would put someone else's text in the field.
  useEffect(() => {
    setValue(dialog?.input?.initialValue ?? '');
    setBusy(false);
  }, [dialog?.id, dialog?.input?.initialValue]);

  if (!dialog) return null;

  const press = (b: DialogButton) => {
    dismissDialog();
    // After dismissal, so a handler that opens another dialog is not
    // immediately closed by this one's cleanup.
    b.onPress?.();
  };

  const submit = async () => {
    if (!dialog.input || busy) return;
    setBusy(true);
    try {
      const ok = await dialog.input.onSubmit(value);
      if (ok !== false) dismissDialog();
    } finally {
      setBusy(false);
    }
  };

  const colorFor = (b: DialogButton) =>
    b.style === 'destructive' ? colors.danger : b.style === 'cancel' ? colors.textSecondary : colors.primary;

  return (
    <Modal visible transparent animationType="fade" onRequestClose={dismissDialog}>
      {/* The scrim dismisses only when there is a way out that costs nothing:
          a dialog whose sole action is destructive should not be dismissable
          by a stray tap that reads as agreement either way. */}
      <Pressable
        style={styles.scrim}
        onPress={() => {
          const cancel = dialog.buttons.find((b) => b.style === 'cancel');
          if (cancel) press(cancel);
        }}
      >
        <KeyboardAvoidingView
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
          style={styles.center}
        >
          <Pressable
            style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.border }]}
            onPress={() => {}}
          >
            <Text style={[styles.title, { color: colors.text }]}>{dialog.title}</Text>
            {dialog.message ? (
              <Text style={[styles.message, { color: colors.textSecondary }]}>
                {dialog.message}
              </Text>
            ) : null}

            {dialog.input ? (
              <TextInput
                value={value}
                onChangeText={setValue}
                autoFocus
                secureTextEntry={dialog.input.secure}
                multiline={dialog.input.multiline}
                keyboardType={dialog.input.keyboard === 'number-pad' ? 'number-pad' : 'default'}
                textAlignVertical={dialog.input.multiline ? 'top' : 'center'}
                placeholder={dialog.input.placeholder}
                placeholderTextColor={colors.textMuted}
                onSubmitEditing={dialog.input.multiline ? undefined : () => void submit()}
                style={[
                  styles.input,
                  dialog.input.multiline && { minHeight: 88 },
                  dialog.input.secure && styles.secure,
                  {
                    backgroundColor: colors.surfaceMuted,
                    color: colors.text,
                    borderColor: colors.border,
                  },
                ]}
                accessibilityLabel={dialog.title}
              />
            ) : null}

            {/* Stacked rather than in a row once there are more than two, or
                three choices squeeze into unreadable slivers. */}
            <View style={dialog.buttons.length + (dialog.input ? 1 : 0) > 2 ? styles.stack : styles.row}>
              {dialog.buttons.map((b) => (
                <Pressable
                  key={b.text}
                  onPress={() => press(b)}
                  style={({ pressed }) => [styles.btn, pressed && { opacity: 0.6 }]}
                  accessibilityRole="button"
                >
                  <Text style={[styles.btnText, { color: colorFor(b) }]}>{b.text}</Text>
                </Pressable>
              ))}
              {dialog.input ? (
                <Pressable
                  onPress={() => void submit()}
                  disabled={busy}
                  style={({ pressed }) => [styles.btn, pressed && { opacity: 0.6 }]}
                  accessibilityRole="button"
                >
                  <Text style={[styles.btnText, { color: colors.primary, fontWeight: '700' }]}>
                    {dialog.input.submitLabel ?? 'OK'}
                  </Text>
                </Pressable>
              ) : null}
            </View>
          </Pressable>
        </KeyboardAvoidingView>
      </Pressable>
    </Modal>
  );
}

const styles = StyleSheet.create({
  scrim: { flex: 1, backgroundColor: 'rgba(0,0,0,0.45)' },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: Spacing.xl },
  card: {
    width: '100%',
    maxWidth: 340,
    borderRadius: Radii.xl,
    borderWidth: StyleSheet.hairlineWidth,
    padding: Spacing.lg,
    gap: Spacing.sm,
  },
  title: { ...Typography.h3, textAlign: 'center' },
  message: { ...Typography.body, textAlign: 'center' },
  input: {
    borderRadius: Radii.md,
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm,
    ...Typography.body,
    marginTop: Spacing.xs,
  },
  secure: { textAlign: 'center', letterSpacing: 6 },
  row: { flexDirection: 'row', justifyContent: 'flex-end', gap: Spacing.xs, marginTop: Spacing.xs },
  stack: { gap: 2, marginTop: Spacing.xs },
  btn: { paddingVertical: Spacing.sm, paddingHorizontal: Spacing.md, borderRadius: Radii.md, alignItems: 'center' },
  btnText: { ...Typography.bodyStrong },
});
