import { Ionicons } from '@expo/vector-icons';
import { router, useLocalSearchParams } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { PeoplePicker, type PickablePerson } from '@/components/ui/people-picker';
import { Text, TextInput } from '@/components/ui/text';
import { Radii, Spacing, Typography } from '@/constants/theme';
import type { LiveAudience } from '@/data/api/lives';
import { useChats } from '@/data/chat-store';
import { t } from '@/i18n';

/**
 * Before going live: a title and who may watch.
 *
 * One screen for every way in (Stories, a chat, a group, a channel), so the
 * choice reads the same everywhere. What differs is the first option: a live
 * from somewhere has "the people there"; a live from Stories has no place.
 *
 *   /live/setup                 from Stories
 *   /live/setup?chat=<id>       a direct chat (joint live) or a group
 *   /live/setup?channel=<id>    a channel
 */
type Option = { key: LiveAudience; icon: keyof typeof Ionicons.glyphMap; label: string; hint: string };

export default function LiveSetupScreen() {
  const params = useLocalSearchParams<{ chat?: string; channel?: string; title?: string }>();
  const { chats } = useChats();
  const chat = params.chat ? chats.find((c) => c.id === params.chat) : undefined;
  const joint = chat?.type === 'direct';
  const partner = chat?.title || chat?.peer_username || t('call.someone');

  const [title, setTitle] = useState(params.title ?? '');
  const hasPlace = !!params.chat || !!params.channel;
  const [audience, setAudience] = useState<LiveAudience>(hasPlace ? 'place' : 'contacts');
  const [picked, setPicked] = useState<PickablePerson[]>([]);
  const [picking, setPicking] = useState(false);

  const options: Option[] = [
    ...(hasPlace
      ? [
          {
            key: 'place' as const,
            icon: (joint ? 'people' : params.channel ? 'megaphone' : 'people-circle') as Option['icon'],
            label: joint
              ? t('live.aud_place_direct')
              : params.channel
                ? t('live.aud_place_channel')
                : t('live.aud_place_group'),
            hint: joint
              ? t('live.aud_place_direct_hint', { name: partner })
              : t('live.aud_place_hint'),
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
    if (key === 'selected' && picked.length === 0) setPicking(true);
  };

  const canStart = audience !== 'selected' || picked.length > 0;

  const start = () => {
    if (!canStart) return;
    const q = new URLSearchParams();
    if (params.chat) q.set('chat', params.chat);
    if (params.channel) q.set('channel', params.channel);
    if (title.trim()) q.set('title', title.trim());
    q.set('audience', audience);
    if (audience === 'selected') q.set('viewers', picked.map((p) => p.id).join(','));
    router.replace(`/live/new?${q.toString()}`);
  };

  return (
    <View style={styles.root}>
      <StatusBar style="light" />
      <SafeAreaView style={{ flex: 1 }} edges={['top', 'bottom']}>
        <View style={styles.top}>
          <Pressable
            onPress={() => router.back()}
            hitSlop={10}
            style={styles.iconBtn}
            accessibilityRole="button"
            accessibilityLabel={t('common.close')}
          >
            <Ionicons name="close" size={24} color="#FFF" />
          </Pressable>
          <Text style={styles.heading}>{t('live.setup_title')}</Text>
          <View style={styles.iconBtn} />
        </View>

        <ScrollView contentContainerStyle={styles.body} keyboardShouldPersistTaps="handled">
          <TextInput
            value={title}
            onChangeText={setTitle}
            placeholder={t('live.title_placeholder')}
            placeholderTextColor="rgba(255,255,255,0.4)"
            maxLength={100}
            style={styles.titleInput}
          />

          {joint ? (
            <View style={styles.joint}>
              <Ionicons name="sparkles" size={16} color={LIVE_RED} />
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
                  <Ionicons name={o.icon} size={26} color={on ? LIVE_RED : 'rgba(255,255,255,0.7)'} />
                  <View style={{ flex: 1 }}>
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
                      color={on ? LIVE_RED : 'rgba(255,255,255,0.3)'}
                    />
                  )}
                </Pressable>
              );
            })}
          </View>

          <View style={styles.note}>
            <Ionicons name="information-circle-outline" size={15} color="rgba(255,255,255,0.5)" />
            <Text style={styles.noteText}>{t('live.not_e2ee')}</Text>
          </View>
        </ScrollView>

        <View style={styles.footer}>
          <Pressable
            onPress={start}
            disabled={!canStart}
            style={({ pressed }) => [
              styles.go,
              !canStart && { opacity: 0.4 },
              pressed && { opacity: 0.85 },
            ]}
            accessibilityRole="button"
          >
            <Ionicons name="radio" size={20} color="#FFF" />
            <Text style={styles.goText}>{t('live.go_live')}</Text>
          </Pressable>
        </View>
      </SafeAreaView>

      <PeoplePicker
        visible={picking}
        title={t('live.aud_selected')}
        confirmLabel={t('common.done')}
        onClose={() => {
          setPicking(false);
          if (picked.length === 0) setAudience(hasPlace ? 'place' : 'contacts');
        }}
        onConfirm={(people) => {
          setPicked(people);
          setPicking(false);
          if (people.length === 0) setAudience(hasPlace ? 'place' : 'contacts');
        }}
      />
    </View>
  );
}

const LIVE_RED = '#FE2C55';

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#0B0C10' },
  top: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: Spacing.md,
    height: 56,
  },
  iconBtn: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  heading: { ...Typography.h3, color: '#FFF' },
  body: { padding: Spacing.lg, gap: Spacing.lg },
  titleInput: {
    ...Typography.h2,
    color: '#FFF',
    paddingVertical: Spacing.md,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: 'rgba(255,255,255,0.2)',
  },
  joint: {
    flexDirection: 'row',
    gap: Spacing.sm,
    alignItems: 'flex-start',
    padding: Spacing.md,
    borderRadius: Radii.lg,
    backgroundColor: 'rgba(254,44,85,0.12)',
  },
  jointText: { ...Typography.callout, color: 'rgba(255,255,255,0.9)', flex: 1 },
  section: { ...Typography.label, color: 'rgba(255,255,255,0.55)', textTransform: 'uppercase' },
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
  optionOn: { borderColor: LIVE_RED, backgroundColor: 'rgba(254,44,85,0.08)' },
  optionLabel: { ...Typography.bodyStrong, color: '#FFF' },
  optionHint: { ...Typography.caption, color: 'rgba(255,255,255,0.55)' },
  edit: { ...Typography.label, color: LIVE_RED },
  note: { flexDirection: 'row', gap: 6, alignItems: 'center' },
  noteText: { ...Typography.micro, color: 'rgba(255,255,255,0.5)', flex: 1 },
  footer: { padding: Spacing.lg },
  go: {
    height: 52,
    borderRadius: Radii.pill,
    backgroundColor: LIVE_RED,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing.sm,
  },
  goText: { ...Typography.bodyStrong, color: '#FFF' },
});
