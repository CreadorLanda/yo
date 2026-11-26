import { Ionicons } from '@expo/vector-icons';
import { Image } from 'expo-image';
import { useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, View } from 'react-native';

import { Avatar } from '@/components/ui/avatar';
import { Text } from '@/components/ui/text';
import { TextField } from '@/components/ui/text-field';
import { Radii, Spacing, Typography } from '@/constants/theme';
import {
  isExpired,
  type BotButton,
  type BotCard,
  type BotForm,
  type BotInteractive,
  type BotSelect,
  type BotUserSelect,
  type CardColor,
} from '@/data/bot-message';
import { useTheme } from '@/hooks/use-theme';
import { t } from '@/i18n';

export type InteractMember = { id: string; name: string; username: string; avatarUri?: string };

/** Values a component reports: picked options, or a form's fields. */
export type InteractValues = string[] | Record<string, string>;

/**
 * A bot's card, buttons, menus and form (#325), drawn from what
 * `sanitizeInteractive` let through — plain text, token colours, nothing
 * fetched. A click waits for the bot (spinner, then done or failed); the bot
 * answers by editing the message or replying.
 */
export function InteractiveMessage({
  interactive,
  members,
  onInteract,
  onOpenLink,
}: {
  interactive: BotInteractive;
  members: InteractMember[];
  onInteract?: (componentId: string, values?: InteractValues) => Promise<void>;
  onOpenLink: (url: string) => void;
}) {
  const [busy, setBusy] = useState<string | null>(null);
  const [failed, setFailed] = useState<string | null>(null);
  const expired = isExpired(interactive, new Date());

  const fire = async (componentId: string, values?: InteractValues) => {
    if (!onInteract || busy) return;
    setBusy(componentId);
    setFailed(null);
    try {
      await onInteract(componentId, values);
    } catch {
      setFailed(componentId);
    } finally {
      setBusy(null);
    }
  };

  return (
    <View style={styles.wrap}>
      {interactive.card ? <Card card={interactive.card} /> : null}
      {interactive.rows.map((row, i) => (
        <View key={i} style={styles.row}>
          {row.map((c) => {
            const disabled = expired || !!c.disabled || !onInteract;
            if (c.type === 'button')
              return (
                <Button
                  key={c.id}
                  button={c}
                  disabled={c.style === 'link' ? false : disabled}
                  busy={busy === c.id}
                  failed={failed === c.id}
                  onPress={() => (c.style === 'link' && c.url ? onOpenLink(c.url) : void fire(c.id))}
                />
              );
            if (c.type === 'select')
              return <Select key={c.id} select={c} disabled={disabled} busy={busy === c.id} onSubmit={(v) => void fire(c.id, v)} />;
            if (c.type === 'user_select')
              return (
                <UserSelect key={c.id} select={c} members={members} disabled={disabled} busy={busy === c.id} onSubmit={(v) => void fire(c.id, v)} />
              );
            return <Form key={c.id} form={c} disabled={disabled} busy={busy === c.id} onSubmit={(v) => void fire(c.id, v)} />;
          })}
        </View>
      ))}
      {expired ? <Text style={styles.note}>{t('bots.ui_expired')}</Text> : null}
      {failed ? <Failed /> : null}
    </View>
  );
}

function Failed() {
  const { colors } = useTheme();
  return <Text style={[styles.note, { color: colors.danger }]}>{t('bots.ui_failed')}</Text>;
}

function useCardColor(color?: CardColor) {
  const { colors } = useTheme();
  const map: Record<CardColor, string> = {
    primary: colors.primary,
    success: colors.success,
    warning: colors.warning,
    danger: colors.danger,
    info: colors.textSecondary,
  };
  return color ? map[color] : colors.border;
}

function Card({ card }: { card: BotCard }) {
  const { colors } = useTheme();
  const stripe = useCardColor(card.color);
  const inline = (card.fields ?? []).filter((f) => f.inline);
  const block = (card.fields ?? []).filter((f) => !f.inline);
  return (
    <View style={[styles.card, { backgroundColor: colors.surfaceMuted, borderLeftColor: stripe }]}>
      <View style={styles.cardTop}>
        <View style={{ flex: 1, gap: Spacing.xs }}>
          {card.title ? <Text style={[styles.cardTitle, { color: colors.text }]}>{card.title}</Text> : null}
          {card.description ? <Text style={[styles.body, { color: colors.text }]}>{card.description}</Text> : null}
        </View>
        {card.thumbnail ? <Image source={{ uri: card.thumbnail }} style={styles.thumb} contentFit="cover" /> : null}
      </View>
      {inline.length > 0 ? (
        <View style={styles.inlineFields}>
          {inline.map((f) => (
            <View key={f.name} style={styles.inlineField}>
              <Text style={[styles.fieldName, { color: colors.textSecondary }]}>{f.name}</Text>
              <Text style={[styles.body, { color: colors.text }]}>{f.value}</Text>
            </View>
          ))}
        </View>
      ) : null}
      {block.map((f) => (
        <View key={f.name} style={{ gap: 2 }}>
          <Text style={[styles.fieldName, { color: colors.textSecondary }]}>{f.name}</Text>
          <Text style={[styles.body, { color: colors.text }]}>{f.value}</Text>
        </View>
      ))}
      {card.footer ? <Text style={[styles.note, { color: colors.textMuted }]}>{card.footer}</Text> : null}
    </View>
  );
}

function Button({
  button,
  disabled,
  busy,
  failed,
  onPress,
}: {
  button: BotButton;
  disabled: boolean;
  busy: boolean;
  failed: boolean;
  onPress: () => void;
}) {
  const { colors } = useTheme();
  const filled = button.style === 'primary' || button.style === 'danger';
  const bg = button.style === 'primary' ? colors.primary : button.style === 'danger' ? colors.danger : colors.surface;
  const fg = filled ? colors.onPrimary : button.style === 'link' ? colors.primary : colors.text;
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled || busy}
      accessibilityRole={button.style === 'link' ? 'link' : 'button'}
      accessibilityState={{ disabled: disabled || busy, busy }}
      accessibilityLabel={button.label}
      style={({ pressed }) => [
        styles.button,
        { backgroundColor: bg, borderColor: filled ? bg : failed ? colors.danger : colors.border, opacity: disabled ? 0.45 : pressed ? 0.8 : 1 },
      ]}
    >
      {busy ? <ActivityIndicator size="small" color={fg} /> : null}
      <Text style={[styles.buttonText, { color: fg }]} numberOfLines={1}>
        {button.label}
      </Text>
      {button.style === 'link' ? <Ionicons name="open-outline" size={14} color={fg} /> : null}
    </Pressable>
  );
}

function Chip({ label, on, onPress, disabled, avatar }: { label: string; on: boolean; onPress: () => void; disabled: boolean; avatar?: InteractMember }) {
  const { colors } = useTheme();
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="checkbox"
      accessibilityState={{ checked: on, disabled }}
      style={[styles.chip, { borderColor: on ? colors.primary : colors.border, backgroundColor: on ? colors.surfaceMuted : colors.surface, opacity: disabled ? 0.45 : 1 }]}
    >
      {avatar ? <Avatar uri={avatar.avatarUri} id={avatar.id} username={avatar.username} size={20} /> : null}
      <Text style={[styles.chipText, { color: on ? colors.primary : colors.text }]} numberOfLines={1}>
        {label}
      </Text>
    </Pressable>
  );
}

function Submit({ label, busy, disabled, onPress }: { label: string; busy: boolean; disabled: boolean; onPress: () => void }) {
  const { colors } = useTheme();
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled || busy}
      accessibilityRole="button"
      style={[styles.button, { backgroundColor: colors.primary, borderColor: colors.primary, alignSelf: 'flex-start', opacity: disabled ? 0.45 : 1 }]}
    >
      {busy ? <ActivityIndicator size="small" color={colors.onPrimary} /> : null}
      <Text style={[styles.buttonText, { color: colors.onPrimary }]}>{label}</Text>
    </Pressable>
  );
}

function Select({ select, disabled, busy, onSubmit }: { select: BotSelect; disabled: boolean; busy: boolean; onSubmit: (v: string[]) => void }) {
  const { colors } = useTheme();
  const [picked, setPicked] = useState<string[]>([]);
  const multi = select.max > 1;
  const toggle = (v: string) => {
    if (!multi) {
      setPicked([v]);
      onSubmit([v]);
      return;
    }
    setPicked((cur) => (cur.includes(v) ? cur.filter((x) => x !== v) : cur.length < select.max ? [...cur, v] : cur));
  };
  return (
    <View style={styles.block}>
      {select.placeholder ? <Text style={[styles.fieldName, { color: colors.textSecondary }]}>{select.placeholder}</Text> : null}
      <View style={styles.chips}>
        {select.options.map((o) => (
          <Chip key={o.value} label={o.label} on={picked.includes(o.value)} disabled={disabled || busy} onPress={() => toggle(o.value)} />
        ))}
      </View>
      {multi ? (
        <Submit
          label={t('bots.ui_confirm')}
          busy={busy}
          disabled={disabled || picked.length < select.min || picked.length === 0}
          onPress={() => onSubmit(picked)}
        />
      ) : null}
    </View>
  );
}

function UserSelect({
  select,
  members,
  disabled,
  busy,
  onSubmit,
}: {
  select: BotUserSelect;
  members: InteractMember[];
  disabled: boolean;
  busy: boolean;
  onSubmit: (v: string[]) => void;
}) {
  const { colors } = useTheme();
  const [picked, setPicked] = useState<string[]>([]);
  const toggle = (id: string) => {
    if (select.max === 1) {
      setPicked([id]);
      onSubmit([id]);
      return;
    }
    setPicked((cur) => (cur.includes(id) ? cur.filter((x) => x !== id) : cur.length < select.max ? [...cur, id] : cur));
  };
  return (
    <View style={styles.block}>
      {select.placeholder ? <Text style={[styles.fieldName, { color: colors.textSecondary }]}>{select.placeholder}</Text> : null}
      <View style={styles.chips}>
        {members.map((m) => (
          <Chip key={m.id} label={m.name} avatar={m} on={picked.includes(m.id)} disabled={disabled || busy} onPress={() => toggle(m.id)} />
        ))}
      </View>
      {select.max > 1 ? (
        <Submit label={t('bots.ui_confirm')} busy={busy} disabled={disabled || picked.length === 0} onPress={() => onSubmit(picked)} />
      ) : null}
    </View>
  );
}

function Form({ form, disabled, busy, onSubmit }: { form: BotForm; disabled: boolean; busy: boolean; onSubmit: (v: Record<string, string>) => void }) {
  const { colors } = useTheme();
  const [values, setValues] = useState<Record<string, string>>({});
  const missing = form.fields.some((f) => f.required && !values[f.id]?.trim());
  const badNumber = form.fields.some((f) => f.type === 'number' && values[f.id] && Number.isNaN(Number(values[f.id])));
  const set = (k: string, v: string) => setValues((cur) => ({ ...cur, [k]: v }));
  return (
    <View style={[styles.block, styles.form, { borderColor: colors.border }]}>
      {form.title ? <Text style={[styles.cardTitle, { color: colors.text }]}>{form.title}</Text> : null}
      {form.fields.map((f) =>
        f.type === 'choice' ? (
          <View key={f.id} style={{ gap: Spacing.xs }}>
            <Text style={[styles.fieldName, { color: colors.textSecondary }]}>
              {f.label}
              {f.required ? ' *' : ''}
            </Text>
            <View style={styles.chips}>
              {(f.choices ?? []).map((c) => (
                <Chip key={c.value} label={c.label} on={values[f.id] === c.value} disabled={disabled || busy} onPress={() => set(f.id, c.value)} />
              ))}
            </View>
          </View>
        ) : (
          <TextField
            key={f.id}
            label={`${f.label}${f.required ? ' *' : ''}`}
            value={values[f.id] ?? ''}
            onChangeText={(v) => set(f.id, v)}
            placeholder={f.placeholder ?? (f.type === 'date' ? 'YYYY-MM-DD' : undefined)}
            keyboardType={f.type === 'number' ? 'numeric' : f.type === 'date' ? 'numbers-and-punctuation' : 'default'}
            editable={!disabled && !busy}
          />
        ),
      )}
      <Submit
        label={form.submitLabel ?? t('bots.ui_submit')}
        busy={busy}
        disabled={disabled || missing || badNumber}
        onPress={() => onSubmit(values)}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: Spacing.sm, marginTop: Spacing.xs, minWidth: 220 },
  row: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.xs },
  card: { borderLeftWidth: 4, borderRadius: Radii.md, padding: Spacing.md, gap: Spacing.sm },
  cardTop: { flexDirection: 'row', gap: Spacing.md },
  cardTitle: { ...Typography.bodyStrong },
  body: { ...Typography.callout },
  thumb: { width: 56, height: 56, borderRadius: Radii.sm },
  inlineFields: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.md },
  inlineField: { minWidth: 90, gap: 2 },
  fieldName: { ...Typography.label },
  note: { ...Typography.caption },
  button: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.xs,
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm,
    borderRadius: Radii.md,
    borderWidth: 1,
    minHeight: 36,
  },
  buttonText: { ...Typography.label },
  block: { gap: Spacing.sm, flex: 1 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.xs },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.xs,
    borderWidth: 1,
    borderRadius: Radii.pill,
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.xs,
    maxWidth: 200,
  },
  chipText: { ...Typography.label },
  form: { borderWidth: StyleSheet.hairlineWidth, borderRadius: Radii.md, padding: Spacing.md },
});
