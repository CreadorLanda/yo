import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';

import { PeoplePicker, type PickablePerson } from '@/components/ui/people-picker';
import { Text, TextInput } from '@/components/ui/text';
import { CameraColors, Radii, Spacing, Typography } from '@/constants/theme';
import type { LiveAudience } from '@/data/api/lives';
import { useChats } from '@/data/chat-store';
import { t } from '@/i18n';

/**
 * Before going live: a title and who may watch.
 *
 * One form for every way in, so the choice reads the same everywhere. It is
 * the LIVE mode of the camera, drawn over the lens, and it is the whole of
 * `/live/setup` when a live starts from a chat, a group or a channel. What
 * differs is the first option: a live from somewhere has "the people there";
 * a live from the camera has no place.
 *
 * `compact` is the camera's version: the audience is a row of chips rather
 * than a list, so the picture behind it stays visible.
 */
type Option = { key: LiveAudience; icon: keyof typeof Ionicons.glyphMap; label: string; hint: string };

export function LiveSetupForm({
  chat: chatId,
  channel,
  initialTitle,
  compact,
}: {
  chat?: string;
  channel?: string;
  initialTitle?: string;
  compact?: boolean;
}) {
  const { chats } = useChats();
  const chat = chatId ? chats.find((c) => c.id === chatId) : undefined;
  const joint = chat?.type === 'direct';
  const partner = chat?.title || chat?.peer_username || t('call.someone');

  const [title, setTitle] = useState(initialTitle ?? '');
  const hasPlace = !!chatId || !!channel;
  const [audience, setAudience] = useState<LiveAudience>(hasPlace ? 'place' : 'contacts');
  const [picked, setPicked] = useState<PickablePerson[]>([]);
  const [picking, setPicking] = useState(false);

  const options: Option[] = [
    ...(hasPlace
      ? [
          {
            key: 'place' as const,
            icon: (joint ? 'people' : channel ? 'megaphone' : 'people-circle') as Option['icon'],
            label: joint
              ? t('live.aud_place_direct')
              : channel
                ? t('live.aud_place_channel')
                : t('live.aud_place_group'),
            hint: joint ? t('live.aud_place_direct_hint', { name: partner }) : t('live.aud_place_hint'),
          },
        ]
      : []),
    {
      key: 'contacts',
      icon: 'person-circle',
      label: joint ? t('live.aud_contacts_joint') : t('live.aud_contacts'),
      hint: t('live.aud_contacts_hint'),
    },
    {
      key: 'selected',
      icon: 'list-circle',
      label: t('live.aud_selected'),
      hint: picked.length ? t('live.aud_selected_count', { count: picked.length }) : t('live.aud_selected_hint'),
    },
    { key: 'public', icon: 'globe', label: t('live.aud_public'), hint: t('live.aud_public_hint') },
  ];

  const choose = (key: LiveAudience) => {
    setAudience(key);
    if (key === 'selected' && (picked.length === 0 || (compact && audience === 'selected'))) setPicking(true);
  };

  const canStart = audience !== 'selected' || picked.length > 0;

  const start = () => {
    if (!canStart) return;
    const q = new URLSearchParams();
    if (chatId) q.set('chat', chatId);
    if (channel) q.set('channel', channel);
    if (title.trim()) q.set('title', title.trim());
    q.set('audience', audience);
    if (audience === 'selected') q.set('viewers', picked.map((p) => p.id).join(','));
    router.replace(`/live/new?${q.toString()}`);
  };

  const fallbackAudience = hasPlace ? 'place' : 'contacts';
  const current = options.find((o) => o.key === audience);

  const titleInput = (
    <TextInput
      value={title}
      onChangeText={setTitle}
      placeholder={t('live.title_placeholder')}
      placeholderTextColor={CameraColors.onStageFaint}
      maxLength={100}
      style={compact ? styles.titleCompact : styles.title}
    />
  );

  const goLive = (
    <Pressable
      onPress={start}
      disabled={!canStart}
      style={({ pressed }) => [styles.go, !canStart && styles.goDisabled, pressed && styles.goPressed]}
      accessibilityRole="button"
      accessibilityState={{ disabled: !canStart }}
    >
      <Ionicons name="radio" size={20} color={CameraColors.onStage} />
      <Text style={styles.goText}>{t('live.go_live')}</Text>
    </Pressable>
  );

  const picker = (
    <PeoplePicker
      visible={picking}
      title={t('live.aud_selected')}
      confirmLabel={t('common.done')}
      onClose={() => {
        setPicking(false);
        if (picked.length === 0) setAudience(fallbackAudience);
      }}
      onConfirm={(people) => {
        setPicked(people);
        setPicking(false);
        if (people.length === 0) setAudience(fallbackAudience);
      }}
    />
  );

  if (compact) {
    return (
      <View style={styles.compact}>
        {titleInput}
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.chips}
          keyboardShouldPersistTaps="handled"
        >
          {options.map((o) => {
            const on = audience === o.key;
            return (
              <Pressable
                key={o.key}
                onPress={() => choose(o.key)}
                style={[styles.chip, on && styles.chipOn]}
                accessibilityRole="radio"
                accessibilityState={{ selected: on }}
              >
                <Ionicons name={o.icon} size={16} color={on ? CameraColors.stage : CameraColors.onStage} />
                <Text style={[styles.chipText, on && styles.chipTextOn]}>{o.label}</Text>
              </Pressable>
            );
          })}
        </ScrollView>
        <Text style={styles.compactHint} numberOfLines={2}>
          {current?.hint} {t('live.not_e2ee')}
        </Text>
        {goLive}
        {picker}
      </View>
    );
  }

  return (
    <>
      <ScrollView contentContainerStyle={styles.body} keyboardShouldPersistTaps="handled">
        {titleInput}

        {joint ? (
          <View style={styles.joint}>
            <Ionicons name="sparkles" size={16} color={CameraColors.live} />
            <Text style={styles.jointText}>{t('live.joint_note', { name: partner })}</Text>
          </View>
        ) : null}

        <Text style={styles.section}>{t('live.who_can_watch')}</Text>
        <View style={styles.options}>
          {options.map((o) => {
            const on = audience === o.key;
            return (
              <Pressable
                key={o.key}
                onPress={() => choose(o.key)}
                style={[styles.option, on && styles.optionOn]}
                accessibilityRole="radio"
                accessibilityState={{ selected: on }}
              >
                <Ionicons name={o.icon} size={26} color={on ? CameraColors.live : CameraColors.onStageMuted} />
                <View style={styles.optionBody}>
                  <Text style={styles.optionLabel}>{o.label}</Text>
                  <Text style={styles.optionHint} numberOfLines={2}>
                    {o.hint}
                  </Text>
                </View>
                {o.key === 'selected' && on ? (
                  <Pressable onPress={() => setPicking(true)} hitSlop={8}>
                    <Text style={styles.edit}>{t('live.edit_people')}</Text>
                  </Pressable>
                ) : (
                  <Ionicons
                    name={on ? 'radio-button-on' : 'radio-button-off'}
                    size={22}
                    color={on ? CameraColors.live : CameraColors.onStageFaint}
                  />
                )}
              </Pressable>
            );
          })}
        </View>

        <View style={styles.note}>
          <Ionicons name="information-circle-outline" size={15} color={CameraColors.onStageMuted} />
          <Text style={styles.noteText}>{t('live.not_e2ee')}</Text>
        </View>
      </ScrollView>

      <View style={styles.footer}>{goLive}</View>
      {picker}
    </>
  );
}

const styles = StyleSheet.create({
  body: { padding: Spacing.lg, gap: Spacing.lg },
  title: {
    ...Typography.h2,
    color: CameraColors.onStage,
    paddingVertical: Spacing.md,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: CameraColors.hairline,
  },
  joint: {
    flexDirection: 'row',
    gap: Spacing.sm,
    alignItems: 'flex-start',
    padding: Spacing.md,
    borderRadius: Radii.lg,
    backgroundColor: 'rgba(254,44,85,0.12)',
  },
  jointText: { ...Typography.callout, color: CameraColors.onStage, flex: 1 },
  section: { ...Typography.label, color: CameraColors.onStageMuted, textTransform: 'uppercase' },
  options: { gap: Spacing.sm, marginTop: -Spacing.sm },
  option: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.md,
    padding: Spacing.md,
    borderRadius: Radii.lg,
    backgroundColor: 'rgba(255,255,255,0.06)',
    borderWidth: 1,
    borderColor: 'transparent',
  },
  optionOn: { borderColor: CameraColors.live, backgroundColor: 'rgba(254,44,85,0.08)' },
  optionBody: { flex: 1 },
  optionLabel: { ...Typography.bodyStrong, color: CameraColors.onStage },
  optionHint: { ...Typography.caption, color: CameraColors.onStageMuted },
  edit: { ...Typography.label, color: CameraColors.live },
  note: { flexDirection: 'row', gap: 6, alignItems: 'center' },
  noteText: { ...Typography.micro, color: CameraColors.onStageMuted, flex: 1 },
  footer: { padding: Spacing.lg },
  go: {
    height: 52,
    borderRadius: Radii.pill,
    backgroundColor: CameraColors.live,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing.sm,
  },
  goDisabled: { opacity: 0.4 },
  goPressed: { opacity: 0.85 },
  goText: { ...Typography.bodyStrong, color: CameraColors.onStage },

  compact: { gap: Spacing.md, paddingHorizontal: Spacing.lg },
  titleCompact: {
    ...Typography.h3,
    color: CameraColors.onStage,
    paddingVertical: Spacing.sm,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: CameraColors.onStageFaint,
  },
  chips: { gap: Spacing.sm, paddingRight: Spacing.lg },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    height: 36,
    paddingHorizontal: Spacing.md,
    borderRadius: Radii.pill,
    backgroundColor: CameraColors.control,
    borderWidth: 1,
    borderColor: CameraColors.hairline,
  },
  chipOn: { backgroundColor: CameraColors.onStage, borderColor: CameraColors.onStage },
  chipText: { ...Typography.label, color: CameraColors.onStage },
  chipTextOn: { color: CameraColors.stage },
  compactHint: { ...Typography.micro, color: CameraColors.onStageMuted },
});
