import { Ionicons } from '@expo/vector-icons';
import { useEffect, useMemo, useRef, useState } from 'react';
import { KeyboardAvoidingView, Modal, Platform, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { BotBadge } from '@/components/bots/bot-badge';
import { Avatar } from '@/components/ui/avatar';
import { PrimaryButton } from '@/components/ui/primary-button';
import { Text } from '@/components/ui/text';
import { TextField } from '@/components/ui/text-field';
import { Radii, Spacing, Typography } from '@/constants/theme';
import { requestAutocomplete } from '@/data/api/bots';
import {
  atTime,
  datePresets,
  describe,
  missingOptions,
  type ChatCommand,
  type CommandChoice,
  type CommandOption,
  type CommandValues,
} from '@/data/bot-commands';
import { encryptForPeerOrFail } from '@/data/crypto';
import { useTheme } from '@/hooks/use-theme';
import { getLocale, t } from '@/i18n';

export type CommandMember = { id: string; name: string; username: string; avatarUri?: string };

/**
 * Fill in a command's options before it is sent (#324): text and numbers,
 * a member, a date and time, or one of the bot's choices. Options the bot
 * completes ask it as the person types, with what they typed sealed for the
 * bot alone.
 */
export function CommandSheet({
  command,
  chatId,
  members,
  onCancel,
  onSubmit,
}: {
  command: ChatCommand | null;
  chatId: string;
  members: CommandMember[];
  onCancel: () => void;
  onSubmit: (values: CommandValues) => void;
}) {
  const { colors } = useTheme();
  const [values, setValues] = useState<CommandValues>({});
  const lang = getLocale();

  useEffect(() => {
    setValues({});
  }, [command]);

  if (!command) return null;
  const missing = missingOptions(command, values);
  const set = (name: string, v: string | number | undefined) => setValues((cur) => ({ ...cur, [name]: v }));

  return (
    <Modal visible animationType="slide" transparent onRequestClose={onCancel}>
      <Pressable style={styles.backdrop} onPress={onCancel} />
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={styles.sheetWrap}>
        <SafeAreaView edges={['bottom']} style={[styles.sheet, { backgroundColor: colors.background }]}>
          <View style={styles.header}>
            <Avatar uri={command.bot.avatar_url} id={command.bot.id} username={command.bot.username} size={36} />
            <View style={{ flex: 1 }}>
              <Text style={[styles.title, { color: colors.text }]}>/{command.name}</Text>
              <View style={styles.inline}>
                <Text style={[styles.sub, { color: colors.textSecondary }]} numberOfLines={1}>
                  {command.bot.display_name}
                </Text>
                <BotBadge />
              </View>
            </View>
            <Pressable onPress={onCancel} hitSlop={10} accessibilityRole="button" accessibilityLabel={t('common.cancel')}>
              <Ionicons name="close" size={22} color={colors.textSecondary} />
            </Pressable>
          </View>
          <Text style={[styles.sub, { color: colors.textSecondary }]}>{describe(command, lang)}</Text>
          <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={styles.fields}>
            {command.options.map((o) => (
              <OptionField
                key={o.name}
                option={o}
                value={values[o.name]}
                onChange={(v) => set(o.name, v)}
                command={command}
                chatId={chatId}
                members={members}
              />
            ))}
          </ScrollView>
          <PrimaryButton
            label={t('bots.command_send')}
            disabled={missing.length > 0}
            onPress={() => onSubmit(values)}
          />
        </SafeAreaView>
      </KeyboardAvoidingView>
    </Modal>
  );
}

function OptionField({
  option,
  value,
  onChange,
  command,
  chatId,
  members,
}: {
  option: CommandOption;
  value: string | number | undefined;
  onChange: (v: string | number | undefined) => void;
  command: ChatCommand;
  chatId: string;
  members: CommandMember[];
}) {
  const { colors } = useTheme();
  const lang = getLocale();
  const label = `${option.name}${option.required ? ' *' : ''} — ${describe(option, lang)}`;

  if (option.type === 'choice') {
    return (
      <View style={styles.field}>
        <Text style={[styles.label, { color: colors.textSecondary }]}>{label}</Text>
        <Chips
          items={(option.choices ?? []).map((c) => ({ key: String(c.value), label: c.name }))}
          selected={value === undefined ? undefined : String(value)}
          onSelect={(k) => onChange(k === String(value) ? undefined : k)}
        />
      </View>
    );
  }

  if (option.type === 'user') {
    return (
      <View style={styles.field}>
        <Text style={[styles.label, { color: colors.textSecondary }]}>{label}</Text>
        <View style={styles.wrapRow}>
          {members.map((m) => {
            const on = value === m.username;
            return (
              <Pressable
                key={m.id}
                onPress={() => onChange(on ? undefined : m.username)}
                accessibilityRole="radio"
                accessibilityState={{ selected: on }}
                style={[styles.member, { borderColor: on ? colors.primary : colors.border, backgroundColor: on ? colors.surfaceMuted : colors.surface }]}
              >
                <Avatar uri={m.avatarUri} id={m.id} username={m.username} size={24} />
                <Text style={[styles.chipText, { color: on ? colors.primary : colors.text }]} numberOfLines={1}>
                  {m.name}
                </Text>
              </Pressable>
            );
          })}
        </View>
      </View>
    );
  }

  if (option.type === 'datetime') {
    return <DateTimeField label={label} value={value === undefined ? undefined : String(value)} onChange={onChange} />;
  }

  return (
    <AutocompleteField
      label={label}
      option={option}
      value={value === undefined ? '' : String(value)}
      onChange={(v) => onChange(v === '' ? undefined : v)}
      command={command}
      chatId={chatId}
    />
  );
}

function AutocompleteField({
  label,
  option,
  value,
  onChange,
  command,
  chatId,
}: {
  label: string;
  option: CommandOption;
  value: string;
  onChange: (v: string) => void;
  command: ChatCommand;
  chatId: string;
}) {
  const [choices, setChoices] = useState<CommandChoice[]>([]);
  const [loading, setLoading] = useState(false);
  const picked = useRef<string | null>(null);
  const numberInvalid = option.type === 'number' && value !== '' && Number.isNaN(Number(value));

  useEffect(() => {
    if (!option.autocomplete || picked.current === value) return;
    let live = true;
    const timer = setTimeout(() => {
      setLoading(true);
      void (async () => {
        try {
          // The typed value is sealed for the bot: the server sees which
          // option is being completed, never what was typed.
          const content = await encryptForPeerOrFail(command.bot.id, JSON.stringify({ v: 1, value }), {
            peerUsername: command.bot.username,
          });
          const res = await requestAutocomplete(chatId, command.bot.id, {
            command: command.name,
            option: option.name,
            content,
          });
          if (live) setChoices(res.choices ?? []);
        } catch {
          if (live) setChoices([]);
        } finally {
          if (live) setLoading(false);
        }
      })();
    }, 400);
    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, [value, option.autocomplete, option.name, command, chatId]);

  return (
    <View style={styles.field}>
      <TextField
        label={label}
        value={value}
        onChangeText={(v) => {
          picked.current = null;
          onChange(v);
        }}
        keyboardType={option.type === 'number' ? 'numeric' : 'default'}
        error={numberInvalid ? t('bots.command_number') : undefined}
        hint={loading ? t('bots.command_suggesting') : undefined}
      />
      {choices.length > 0 ? (
        <Chips
          items={choices.map((c) => ({ key: String(c.value), label: c.name }))}
          selected={value}
          onSelect={(k) => {
            picked.current = k;
            setChoices([]);
            onChange(k);
          }}
        />
      ) : null}
    </View>
  );
}

function DateTimeField({ label, value, onChange }: { label: string; value?: string; onChange: (v?: string) => void }) {
  const { colors } = useTheme();
  const presets = useMemo(() => datePresets(new Date()), []);
  const days = useMemo(() => {
    const out: Date[] = [];
    const d = new Date();
    d.setHours(0, 0, 0, 0);
    for (let i = 0; i < 7; i++) {
      out.push(new Date(d.getTime() + i * 86_400_000));
    }
    return out;
  }, []);
  const [day, setDay] = useState<Date>(days[0]);
  const [time, setTime] = useState('');
  const chosen = value ? new Date(value) : null;
  const fmt = (d: Date) =>
    d.toLocaleString(getLocale(), { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });

  return (
    <View style={styles.field}>
      <Text style={[styles.label, { color: colors.textSecondary }]}>{label}</Text>
      <Chips
        items={presets.map((p) => ({ key: p.at.toISOString(), label: t(`bots.when_${p.key}`) }))}
        selected={value}
        onSelect={(k) => onChange(k)}
      />
      <Chips
        items={days.map((d) => ({ key: String(d.getTime()), label: d.toLocaleDateString(getLocale(), { weekday: 'short', day: 'numeric' }) }))}
        selected={String(day.getTime())}
        onSelect={(k) => {
          const d = new Date(Number(k));
          setDay(d);
          const at = atTime(d, time);
          if (at) onChange(at.toISOString());
        }}
      />
      <TextField
        label={t('bots.when_time')}
        value={time}
        placeholder="09:30"
        keyboardType="numbers-and-punctuation"
        onChangeText={(v) => {
          setTime(v);
          const at = atTime(day, v);
          if (at) onChange(at.toISOString());
        }}
        error={time && !atTime(day, time) ? t('bots.when_time_invalid') : undefined}
      />
      {chosen && !Number.isNaN(chosen.getTime()) ? (
        <Text style={[styles.sub, { color: colors.primary }]}>{fmt(chosen)}</Text>
      ) : null}
    </View>
  );
}

function Chips({
  items,
  selected,
  onSelect,
}: {
  items: { key: string; label: string }[];
  selected?: string;
  onSelect: (key: string) => void;
}) {
  const { colors } = useTheme();
  return (
    <View style={styles.wrapRow}>
      {items.map((it) => {
        const on = it.key === selected;
        return (
          <Pressable
            key={it.key}
            onPress={() => onSelect(it.key)}
            accessibilityRole="radio"
            accessibilityState={{ selected: on }}
            style={[styles.chip, { borderColor: on ? colors.primary : colors.border, backgroundColor: on ? colors.surfaceMuted : colors.surface }]}
          >
            <Text style={[styles.chipText, { color: on ? colors.primary : colors.text }]}>{it.label}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  // Same scrim as the app's dialogs (components/ui/dialog-host.tsx).
  backdrop: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(0,0,0,0.45)' },
  sheetWrap: { flex: 1, justifyContent: 'flex-end' },
  sheet: {
    borderTopLeftRadius: Radii.xxl,
    borderTopRightRadius: Radii.xxl,
    padding: Spacing.lg,
    gap: Spacing.md,
    maxHeight: '85%',
  },
  header: { flexDirection: 'row', alignItems: 'center', gap: Spacing.md },
  title: { ...Typography.h3, fontFamily: 'monospace' },
  sub: { ...Typography.caption },
  inline: { flexDirection: 'row', alignItems: 'center', gap: Spacing.xs },
  fields: { gap: Spacing.lg, paddingBottom: Spacing.md },
  field: { gap: Spacing.sm },
  label: { ...Typography.label },
  wrapRow: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.xs },
  chip: { borderWidth: 1, borderRadius: Radii.pill, paddingHorizontal: Spacing.md, paddingVertical: Spacing.xs },
  chipText: { ...Typography.label },
  member: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.xs,
    borderWidth: 1,
    borderRadius: Radii.pill,
    paddingLeft: Spacing.xs,
    paddingRight: Spacing.md,
    paddingVertical: Spacing.xs,
    maxWidth: 180,
  },
});
