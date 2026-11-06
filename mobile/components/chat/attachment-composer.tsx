import { Ionicons } from '@expo/vector-icons';
import { Image } from 'expo-image';
import * as Location from 'expo-location';
import { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Linking,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  View,
} from 'react-native';
import { KeyboardAvoidingView } from 'react-native-keyboard-controller';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { LocationMap } from '@/components/chat/location-map';
import { EmptyState } from '@/components/ui/empty-state';
import { Text, TextInput } from '@/components/ui/text';
import { Radii, Spacing, Typography } from '@/constants/theme';
import { searchUsers, type PublicUser } from '@/data/api/users';
import { getCurrentUser } from '@/data/auth-store';
import { displayChatName } from '@/data/chat-identity';
import { useChats } from '@/data/chat-store';
import { formatCoords, LIVE_DURATIONS, type LatLng } from '@/data/location-share';
import { type MessageAttachment } from '@/data/mock';
import { useTheme } from '@/hooks/use-theme';
import { getLocale, t } from '@/i18n';

const GAMES = [
  { name: 'Xadrez', tagline: 'Clássico de estratégia', icon: 'grid', color: '#6366F1' },
  { name: 'Dados', tagline: 'Sorte a dois', icon: 'dice', color: '#EC4899' },
  { name: 'Puzzle', tagline: 'Resolve o desafio', icon: 'extension-puzzle', color: '#F59E0B' },
  { name: 'Quiz', tagline: 'Testa o que sabes', icon: 'bulb', color: '#0EA5E9' },
  { name: 'Bowling', tagline: 'Derruba os pinos', icon: 'tennisball', color: '#22C55E' },
  { name: 'Cartas', tagline: 'Mão a mão', icon: 'albums', color: '#EF4444' },
] as const;

const TIMES = ['09:00', '12:00', '15:00', '18:00', '21:00'];

const WEEKDAYS: Record<string, string[]> = {
  pt: ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'],
  en: ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'],
};
const MONTHS: Record<string, string[]> = {
  pt: ['Jan', 'Fev', 'Mar', 'Abr', 'Mai', 'Jun', 'Jul', 'Ago', 'Set', 'Out', 'Nov', 'Dez'],
  en: ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'],
};

function localeKey(): 'pt' | 'en' {
  return getLocale().startsWith('pt') ? 'pt' : 'en';
}

function buildDays() {
  const lk = localeKey();
  const out: { weekday: string; day: number; month: string }[] = [];
  for (let i = 0; i < 6; i += 1) {
    const d = new Date();
    d.setDate(d.getDate() + i);
    out.push({
      weekday: WEEKDAYS[lk][d.getDay()],
      day: d.getDate(),
      month: MONTHS[lk][d.getMonth()],
    });
  }
  return out;
}

/** Routes the attachment menu selection to the matching compose sheet. */
export function AttachmentComposer({
  kind,
  onClose,
  onSend,
  onShareLive,
}: {
  kind: string | null;
  onClose: () => void;
  onSend: (attachment: MessageAttachment) => void;
  /** Start a live location share. Rejects with a LiveLocationError when it cannot. */
  onShareLive?: (durationMs: number | null) => Promise<void>;
}) {
  const [shownKind, setShownKind] = useState<string | null>(null);
  const [openId, setOpenId] = useState(0);

  useEffect(() => {
    if (kind) {
      setShownKind(kind);
      setOpenId((n) => n + 1);
    }
  }, [kind]);

  return (
    <Modal transparent animationType="slide" visible={kind !== null} onRequestClose={onClose}>
      <View style={styles.overlay}>
        <Pressable style={StyleSheet.absoluteFill} onPress={onClose} />
        <KeyboardAvoidingView behavior="padding">
          {shownKind === 'location' ? (
            <LocationSheet key={openId} onClose={onClose} onSend={onSend} onShareLive={onShareLive} />
          ) : shownKind === 'contact' ? (
            <ContactSheet key={openId} onClose={onClose} onSend={onSend} />
          ) : shownKind === 'poll' ? (
            <PollSheet key={openId} onClose={onClose} onSend={onSend} />
          ) : shownKind === 'event' ? (
            <EventSheet key={openId} onClose={onClose} onSend={onSend} />
          ) : shownKind === 'games' ? (
            <GamesSheet key={openId} onClose={onClose} onSend={onSend} />
          ) : null}
        </KeyboardAvoidingView>
      </View>
    </Modal>
  );
}

function SheetShell({
  title,
  onClose,
  children,
}: {
  title: string;
  onClose: () => void;
  children: React.ReactNode;
}) {
  const { colors } = useTheme();
  return (
    <View style={[styles.sheet, { backgroundColor: colors.surfaceElevated }]}>
      <View style={styles.handle}>
        <View style={[styles.handleBar, { backgroundColor: colors.border }]} />
      </View>
      <View style={styles.header}>
        <Text style={[styles.title, { color: colors.text }]}>{title}</Text>
        <Pressable onPress={onClose} hitSlop={12}>
          <Ionicons name="close" size={22} color={colors.text} />
        </Pressable>
      </View>
      {children}
    </View>
  );
}

// ── Location ──────────────────────────────────────────────────────────────────
type Fix =
  | { state: 'locating' }
  | { state: 'denied' }
  | { state: 'off' }
  | { state: 'error' }
  | { state: 'ready'; point: LatLng; accuracy?: number };

/**
 * Where you are, shown before it is sent, and the two ways to share it.
 *
 * The position is read when the sheet opens so the map is the preview of what
 * will go out. Nothing is sent until a button is pressed.
 */
function LocationSheet({
  onClose,
  onSend,
  onShareLive,
}: {
  onClose: () => void;
  onSend: (a: MessageAttachment) => void;
  onShareLive?: (durationMs: number | null) => Promise<void>;
}) {
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const [fix, setFix] = useState<Fix>({ state: 'locating' });
  const [duration, setDuration] = useState(LIVE_DURATIONS[1].id);
  const [starting, setStarting] = useState(false);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setFix({ state: 'locating' });
    (async () => {
      const permission = await Location.requestForegroundPermissionsAsync().catch(() => null);
      if (cancelled) return;
      if (!permission?.granted) return setFix({ state: 'denied' });
      if (!(await Location.hasServicesEnabledAsync().catch(() => false))) {
        return cancelled ? undefined : setFix({ state: 'off' });
      }
      try {
        const here = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
        if (cancelled) return;
        setFix({
          state: 'ready',
          point: { lat: here.coords.latitude, lng: here.coords.longitude },
          accuracy: here.coords.accuracy ?? undefined,
        });
      } catch {
        if (!cancelled) setFix({ state: 'error' });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [attempt]);

  const sendCurrent = () => {
    if (fix.state !== 'ready') return;
    onSend({
      kind: 'location',
      place: t('chat.loc_current'),
      address: formatCoords(fix.point),
      lat: fix.point.lat,
      lng: fix.point.lng,
      accuracy: fix.accuracy,
      updatedAt: new Date().toISOString(),
    });
  };

  const startLive = async () => {
    if (!onShareLive || starting) return;
    setStarting(true);
    try {
      await onShareLive(LIVE_DURATIONS.find((d) => d.id === duration)?.ms ?? null);
    } finally {
      setStarting(false);
    }
  };

  const problem =
    fix.state === 'denied'
      ? { icon: 'lock-closed-outline', title: t('location.permission_title'), body: t('location.permission_body'), action: t('location.open_settings'), run: () => void Linking.openSettings() }
      : fix.state === 'off'
        ? { icon: 'navigate-circle-outline', title: t('location.services_title'), body: t('location.services_body'), action: t('location.try_again'), run: () => setAttempt((n) => n + 1) }
        : fix.state === 'error'
          ? { icon: 'cloud-offline-outline', title: t('location.error_title'), body: t('location.error_body'), action: t('location.try_again'), run: () => setAttempt((n) => n + 1) }
          : null;

  return (
    <SheetShell title={t('chat.loc_share')} onClose={onClose}>
      <ScrollView
        style={styles.bodyScroll}
        showsVerticalScrollIndicator={false}
        contentContainerStyle={{ paddingBottom: Math.max(insets.bottom, Spacing.md) }}
      >
        {fix.state === 'ready' ? (
          <>
            <LocationMap point={fix.point} height={170} />
            <Text style={[styles.locMeta, { color: colors.textSecondary }]}>
              {formatCoords(fix.point)}
              {fix.accuracy ? `  ·  ${t('location.accuracy', { meters: Math.round(fix.accuracy) })}` : ''}
            </Text>
          </>
        ) : problem ? (
          <View style={[styles.locProblem, { backgroundColor: colors.surfaceMuted }]}>
            <Ionicons name={problem.icon as keyof typeof Ionicons.glyphMap} size={30} color={colors.textMuted} />
            <Text style={[styles.locProblemTitle, { color: colors.text }]}>{problem.title}</Text>
            <Text style={[styles.locProblemBody, { color: colors.textSecondary }]}>{problem.body}</Text>
            <Pressable onPress={problem.run} accessibilityRole="button" style={[styles.locAction, { backgroundColor: colors.primary }]}>
              <Text style={[styles.locActionText, { color: colors.onPrimary }]}>{problem.action}</Text>
            </Pressable>
          </View>
        ) : (
          <View style={[styles.locProblem, { backgroundColor: colors.surfaceMuted }]}>
            <ActivityIndicator color={colors.primary} />
            <Text style={[styles.locProblemBody, { color: colors.textSecondary }]}>{t('location.getting')}</Text>
          </View>
        )}

        <Pressable
          onPress={sendCurrent}
          disabled={fix.state !== 'ready'}
          accessibilityRole="button"
          style={({ pressed }) => [
            styles.currentLoc,
            { borderColor: colors.border, opacity: fix.state === 'ready' ? 1 : 0.45 },
            pressed && { backgroundColor: colors.surfaceMuted },
          ]}
        >
          <View style={[styles.currentLocIcon, { backgroundColor: `${colors.primary}1F` }]}>
            <Ionicons name="navigate" size={18} color={colors.primary} />
          </View>
          <Text style={[styles.currentLocText, { color: colors.primary }]}>
            {t('location.send_current')}
          </Text>
        </Pressable>

        {onShareLive ? (
          <>
            <Text style={[styles.sectionLabel, { color: colors.textSecondary }]}>
              {t('location.live_title')}
            </Text>
            <View style={styles.durations}>
              {LIVE_DURATIONS.map((d) => {
                const on = d.id === duration;
                return (
                  <Pressable
                    key={d.id}
                    onPress={() => setDuration(d.id)}
                    accessibilityRole="radio"
                    accessibilityState={{ selected: on }}
                    style={[
                      styles.durationChip,
                      { backgroundColor: on ? colors.primary : colors.surfaceMuted },
                    ]}
                  >
                    <Text style={[styles.durationText, { color: on ? colors.onPrimary : colors.text }]}>
                      {t(`location.d_${d.id}`)}
                    </Text>
                  </Pressable>
                );
              })}
            </View>
            <Pressable
              onPress={() => void startLive()}
              disabled={fix.state !== 'ready' || starting}
              accessibilityRole="button"
              style={[
                styles.liveStart,
                { backgroundColor: colors.danger, opacity: fix.state === 'ready' && !starting ? 1 : 0.45 },
              ]}
            >
              {starting ? (
                <ActivityIndicator color={colors.onPrimary} />
              ) : (
                <>
                  <Ionicons name="radio" size={18} color={colors.onPrimary} />
                  <Text style={[styles.liveStartText, { color: colors.onPrimary }]}>
                    {t('location.start_live')}
                  </Text>
                </>
              )}
            </Pressable>
            <Text style={[styles.locHint, { color: colors.textMuted }]}>{t('location.live_hint')}</Text>
          </>
        ) : null}
      </ScrollView>
    </SheetShell>
  );
}

// ── Contact ───────────────────────────────────────────────────────────────────
function ContactSheet({
  onClose,
  onSend,
}: {
  onClose: () => void;
  onSend: (a: MessageAttachment) => void;
}) {
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const { chats } = useChats();
  const me = getCurrentUser()?.id;

  const [query, setQuery] = useState('');
  const [found, setFound] = useState<PublicUser[] | null>(null);

  /**
   * Typing searches the server; an empty box offers the people you already
   * talk to.
   *
   * This used to filter the `CHATS` demo fixture, so the sheet offered
   * ninani.eth and Samuel Garu — sample data from before there was a server —
   * and would happily send a card for someone who was never born into a real
   * conversation. The shape below is the one `people-picker` already uses.
   */
  useEffect(() => {
    const q = query.trim();
    if (q.length < 2) {
      setFound(null);
      return;
    }
    let cancelled = false;
    const timer = setTimeout(() => {
      searchUsers(q)
        .then((list) => {
          if (!cancelled) setFound(list ?? []);
        })
        .catch(() => {
          if (!cancelled) setFound([]);
        });
    }, 300);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [query]);

  // A group has no single peer, so a group chat is not a contact to share.
  const known = chats
    .filter((c) => c.type === 'direct' && c.peer_user_id)
    .map((c) => ({
      id: c.peer_user_id!,
      name: displayChatName(c, t('chats.saved_messages'), ''),
      username: c.peer_username ?? '',
      avatarUri: c.avatar_url ?? '',
    }));

  const list = (
    found
      ? found.map((u) => ({
          id: u.id,
          name: u.display_name || u.username,
          username: u.username,
          avatarUri: u.avatar_uri ?? '',
        }))
      : known
  ).filter((p) => p.id !== me);

  return (
    <SheetShell title={t('chat.contact_share')} onClose={onClose}>
      <View style={[styles.searchField, { backgroundColor: colors.surfaceMuted }]}>
        <Ionicons name="search" size={16} color={colors.textMuted} />
        <TextInput
          value={query}
          onChangeText={setQuery}
          placeholder={t('chat.contact_search')}
          placeholderTextColor={colors.textMuted}
          style={[styles.searchInput, { color: colors.text }]}
        />
      </View>
      <ScrollView
        style={styles.bodyScroll}
        showsVerticalScrollIndicator={false}
        contentContainerStyle={{ paddingBottom: Math.max(insets.bottom, Spacing.md) }}
        keyboardShouldPersistTaps="handled"
      >
        {/*
          Two different empties, because they call for two different answers:
          a search that found nobody is not the same as an account that has
          not spoken to anyone yet, and telling the second person "nobody
          found" would be blaming them for the app being new.
        */}
        {list.length === 0 ? (
          <EmptyState
            icon={found ? 'search-outline' : 'people-outline'}
            title={found ? t('chat.contact_none_found') : t('chat.contact_none_yet')}
            description={found ? undefined : t('chat.contact_none_yet_hint')}
          />
        ) : null}
        {list.map((c) => (
          <Pressable
            key={c.id}
            onPress={() =>
              onSend({ kind: 'contact', name: c.name, detail: c.username, avatarUri: c.avatarUri })
            }
            style={({ pressed }) => [styles.listRow, pressed && { backgroundColor: colors.surfaceMuted }]}
          >
            <Image
              source={{ uri: c.avatarUri }}
              style={[styles.contactAvatar, { backgroundColor: colors.surfaceMuted }]}
              contentFit="cover"
            />
            <View style={styles.listText}>
              <Text style={[styles.listTitle, { color: colors.text }]} numberOfLines={1}>
                {c.name}
              </Text>
              <Text style={[styles.listSub, { color: colors.textSecondary }]} numberOfLines={1}>
                {c.username}
              </Text>
            </View>
            <Ionicons name="chevron-forward" size={18} color={colors.textMuted} />
          </Pressable>
        ))}
      </ScrollView>
    </SheetShell>
  );
}

// ── Poll ──────────────────────────────────────────────────────────────────────
function PollSheet({
  onClose,
  onSend,
}: {
  onClose: () => void;
  onSend: (a: MessageAttachment) => void;
}) {
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const [question, setQuestion] = useState('');
  const [options, setOptions] = useState<string[]>(['', '']);
  const [multi, setMulti] = useState(false);

  const setOption = (i: number, v: string) =>
    setOptions((prev) => prev.map((o, idx) => (idx === i ? v : o)));
  const addOption = () => setOptions((prev) => (prev.length < 12 ? [...prev, ''] : prev));
  const removeOption = (i: number) => setOptions((prev) => prev.filter((_, idx) => idx !== i));

  const valid = options.filter((o) => o.trim().length > 0);
  const canSave = question.trim().length > 0 && valid.length >= 2;

  const submit = () => {
    if (!canSave) return;
    onSend({
      kind: 'poll',
      question: question.trim(),
      multi,
      options: valid.map((text, i) => ({ id: `o${i}`, text: text.trim(), votes: 0 })),
    });
  };

  return (
    <SheetShell title={t('chat.poll_create')} onClose={onClose}>
      <ScrollView
        style={styles.bodyScroll}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
      >
        <TextInput
          value={question}
          onChangeText={setQuestion}
          placeholder={t('chat.poll_question')}
          placeholderTextColor={colors.textMuted}
          style={[styles.input, { backgroundColor: colors.surfaceMuted, color: colors.text }]}
          maxLength={120}
        />
        <View style={styles.pollOptions}>
          {options.map((opt, i) => (
            <View key={i} style={styles.pollOptionRow}>
              <TextInput
                value={opt}
                onChangeText={(v) => setOption(i, v)}
                placeholder={t('chat.poll_option', { index: i + 1 })}
                placeholderTextColor={colors.textMuted}
                style={[
                  styles.input,
                  styles.pollOptionInput,
                  { backgroundColor: colors.surfaceMuted, color: colors.text },
                ]}
                maxLength={60}
              />
              {options.length > 2 ? (
                <Pressable onPress={() => removeOption(i)} hitSlop={8}>
                  <Ionicons name="close-circle" size={22} color={colors.textMuted} />
                </Pressable>
              ) : null}
            </View>
          ))}
        </View>
        {options.length < 12 ? (
          <Pressable onPress={addOption} style={styles.addOption}>
            <Ionicons name="add-circle-outline" size={20} color={colors.primary} />
            <Text style={[styles.addOptionText, { color: colors.primary }]}>
              {t('chat.poll_add_option')}
            </Text>
          </Pressable>
        ) : null}
        <View style={[styles.toggleRow, { borderTopColor: colors.divider }]}>
          <Text style={[styles.toggleLabel, { color: colors.text }]}>{t('chat.poll_multi')}</Text>
          <Switch
            value={multi}
            onValueChange={setMulti}
            trackColor={{ true: colors.primary, false: colors.surfaceMuted }}
            thumbColor="#FFFFFF"
          />
        </View>
      </ScrollView>
      <PrimaryButton
        label={t('chat.poll_create')}
        enabled={canSave}
        onPress={submit}
        bottomInset={insets.bottom}
      />
    </SheetShell>
  );
}

// ── Event ─────────────────────────────────────────────────────────────────────
function EventSheet({
  onClose,
  onSend,
}: {
  onClose: () => void;
  onSend: (a: MessageAttachment) => void;
}) {
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const days = buildDays();
  const [title, setTitle] = useState('');
  const [location, setLocation] = useState('');
  const [dayIdx, setDayIdx] = useState(0);
  const [time, setTime] = useState(TIMES[3]);

  const canSave = title.trim().length > 0;

  const submit = () => {
    if (!canSave) return;
    const d = days[dayIdx];
    onSend({
      kind: 'event',
      title: title.trim(),
      day: d.day,
      month: d.month,
      weekday: d.weekday,
      time,
      location: location.trim() || undefined,
    });
  };

  return (
    <SheetShell title={t('chat.event_create')} onClose={onClose}>
      <ScrollView
        style={styles.bodyScroll}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
      >
        <TextInput
          value={title}
          onChangeText={setTitle}
          placeholder={t('chat.event_name')}
          placeholderTextColor={colors.textMuted}
          style={[styles.input, { backgroundColor: colors.surfaceMuted, color: colors.text }]}
          maxLength={60}
        />

        <Text style={[styles.sectionLabel, { color: colors.textSecondary }]}>
          {t('chat.event_date')}
        </Text>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chipRow}>
          {days.map((d, i) => {
            const on = i === dayIdx;
            return (
              <Pressable
                key={i}
                onPress={() => setDayIdx(i)}
                style={[
                  styles.dateChip,
                  on
                    ? { backgroundColor: colors.primary, borderColor: colors.primary }
                    : { backgroundColor: colors.surfaceMuted, borderColor: colors.border },
                ]}
              >
                <Text style={[styles.dateChipWk, { color: on ? colors.onPrimary : colors.textSecondary }]}>
                  {d.weekday}
                </Text>
                <Text style={[styles.dateChipDay, { color: on ? colors.onPrimary : colors.text }]}>
                  {d.day}
                </Text>
              </Pressable>
            );
          })}
        </ScrollView>

        <Text style={[styles.sectionLabel, { color: colors.textSecondary }]}>
          {t('chat.event_time')}
        </Text>
        <View style={styles.chipRow}>
          {TIMES.map((tm) => {
            const on = tm === time;
            return (
              <Pressable
                key={tm}
                onPress={() => setTime(tm)}
                style={[
                  styles.timeChip,
                  on
                    ? { backgroundColor: colors.primary, borderColor: colors.primary }
                    : { backgroundColor: colors.surfaceMuted, borderColor: colors.border },
                ]}
              >
                <Text style={[styles.timeChipText, { color: on ? colors.onPrimary : colors.text }]}>
                  {tm}
                </Text>
              </Pressable>
            );
          })}
        </View>

        <View style={[styles.input, styles.locInput, { backgroundColor: colors.surfaceMuted }]}>
          <Ionicons name="location-outline" size={18} color={colors.textMuted} />
          <TextInput
            value={location}
            onChangeText={setLocation}
            placeholder={t('chat.event_location')}
            placeholderTextColor={colors.textMuted}
            style={[styles.locInputField, { color: colors.text }]}
            maxLength={50}
          />
        </View>
      </ScrollView>
      <PrimaryButton
        label={t('chat.event_create')}
        enabled={canSave}
        onPress={submit}
        bottomInset={insets.bottom}
      />
    </SheetShell>
  );
}

// ── Games ─────────────────────────────────────────────────────────────────────
function GamesSheet({
  onClose,
  onSend,
}: {
  onClose: () => void;
  onSend: (a: MessageAttachment) => void;
}) {
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  return (
    <SheetShell title={t('chat.game_choose')} onClose={onClose}>
      <ScrollView
        style={styles.bodyScroll}
        showsVerticalScrollIndicator={false}
        contentContainerStyle={[styles.gameGrid, { paddingBottom: Math.max(insets.bottom, Spacing.md) }]}
      >
        {GAMES.map((g) => (
          <Pressable
            key={g.name}
            onPress={() =>
              onSend({ kind: 'game', name: g.name, tagline: g.tagline, color: g.color, icon: g.icon })
            }
            style={({ pressed }) => [
              styles.gameCard,
              { backgroundColor: colors.surfaceMuted, borderColor: colors.border },
              pressed && { opacity: 0.7 },
            ]}
          >
            <View style={[styles.gameCardTile, { backgroundColor: g.color }]}>
              <Ionicons name={g.icon as keyof typeof Ionicons.glyphMap} size={28} color="#FFFFFF" />
            </View>
            <Text style={[styles.gameCardName, { color: colors.text }]} numberOfLines={1}>
              {g.name}
            </Text>
            <Text style={[styles.gameCardTag, { color: colors.textSecondary }]} numberOfLines={1}>
              {g.tagline}
            </Text>
          </Pressable>
        ))}
      </ScrollView>
    </SheetShell>
  );
}

function PrimaryButton({
  label,
  enabled,
  onPress,
  bottomInset,
}: {
  label: string;
  enabled: boolean;
  onPress: () => void;
  bottomInset: number;
}) {
  const { colors } = useTheme();
  return (
    <Pressable
      onPress={enabled ? onPress : undefined}
      style={({ pressed }) => [
        styles.primaryBtn,
        { backgroundColor: enabled ? colors.primary : colors.surfaceMuted },
        pressed && enabled && { opacity: 0.9 },
        { marginBottom: Math.max(bottomInset, Spacing.md) },
      ]}
    >
      <Text style={[styles.primaryBtnText, { color: enabled ? colors.onPrimary : colors.textMuted }]}>
        {label}
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    justifyContent: 'flex-end',
    backgroundColor: 'rgba(0,0,0,0.5)',
  },
  sheet: {
    borderTopLeftRadius: Radii.xl,
    borderTopRightRadius: Radii.xl,
    paddingHorizontal: Spacing.lg,
    maxHeight: '88%',
  },
  handle: { alignItems: 'center', paddingTop: Spacing.sm, paddingBottom: Spacing.xs },
  handleBar: { width: 36, height: 4, borderRadius: Radii.pill },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: Spacing.sm,
  },
  title: { ...Typography.h3 },
  bodyScroll: { marginTop: Spacing.xs },

  sectionLabel: {
    ...Typography.micro,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginTop: Spacing.lg,
    marginBottom: Spacing.sm,
  },

  // shared list row
  listRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.md,
    paddingVertical: Spacing.sm,
    paddingHorizontal: Spacing.xs,
    borderRadius: Radii.md,
  },
  listIcon: {
    width: 44,
    height: 44,
    borderRadius: Radii.pill,
    alignItems: 'center',
    justifyContent: 'center',
  },
  listText: { flex: 1, gap: 2 },
  listTitle: { ...Typography.body, fontSize: 15, fontWeight: '600' },
  listSub: { ...Typography.caption },

  // Location
  locMeta: { ...Typography.micro, textAlign: 'center', marginTop: Spacing.xs },
  locProblem: {
    height: 170,
    borderRadius: Radii.lg,
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing.xs,
    paddingHorizontal: Spacing.lg,
  },
  locProblemTitle: { ...Typography.bodyStrong },
  locProblemBody: { ...Typography.caption, textAlign: 'center' },
  locAction: {
    marginTop: Spacing.xs,
    paddingHorizontal: Spacing.lg,
    paddingVertical: 8,
    borderRadius: Radii.pill,
  },
  locActionText: { ...Typography.label },
  durations: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.sm, marginTop: Spacing.xs },
  durationChip: { paddingHorizontal: Spacing.md, paddingVertical: 8, borderRadius: Radii.pill },
  durationText: { ...Typography.label },
  liveStart: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing.sm,
    height: 48,
    borderRadius: Radii.pill,
    marginTop: Spacing.md,
  },
  liveStartText: { ...Typography.bodyStrong },
  locHint: { ...Typography.micro, textAlign: 'center', marginTop: Spacing.sm },
  currentLoc: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.md,
    borderWidth: 1,
    borderRadius: Radii.md,
    padding: Spacing.md,
    marginTop: Spacing.md,
  },
  currentLocIcon: {
    width: 38,
    height: 38,
    borderRadius: Radii.pill,
    alignItems: 'center',
    justifyContent: 'center',
  },
  currentLocText: { ...Typography.body, fontSize: 15, fontWeight: '700', flex: 1 },

  // Contact
  searchField: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
    borderRadius: Radii.pill,
    paddingHorizontal: Spacing.md,
    height: 42,
    marginTop: Spacing.xs,
  },
  searchInput: { flex: 1, ...Typography.body, fontSize: 15, padding: 0 },
  contactAvatar: { width: 44, height: 44, borderRadius: Radii.pill },

  // shared input
  input: {
    ...Typography.body,
    fontSize: 15,
    borderRadius: Radii.md,
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm + 3,
  },

  // Poll
  pollOptions: { gap: Spacing.sm, marginTop: Spacing.sm },
  pollOptionRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm },
  pollOptionInput: { flex: 1 },
  addOption: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingVertical: Spacing.sm,
    marginTop: Spacing.xs,
  },
  addOptionText: { ...Typography.body, fontSize: 15, fontWeight: '600' },
  toggleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: Spacing.md,
    marginTop: Spacing.sm,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  toggleLabel: { ...Typography.body, fontSize: 15 },

  // Event
  chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.sm },
  dateChip: {
    width: 56,
    paddingVertical: Spacing.sm,
    borderRadius: Radii.md,
    borderWidth: 1,
    alignItems: 'center',
    gap: 2,
  },
  dateChipWk: { ...Typography.micro, fontWeight: '700', textTransform: 'uppercase' },
  dateChipDay: { ...Typography.h3, fontWeight: '800' },
  timeChip: {
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm,
    borderRadius: Radii.pill,
    borderWidth: 1,
  },
  timeChipText: { ...Typography.label },
  locInput: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
    marginTop: Spacing.lg,
  },
  locInputField: { flex: 1, ...Typography.body, fontSize: 15, padding: 0 },

  // Games
  gameGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: Spacing.md,
    paddingTop: Spacing.sm,
  },
  gameCard: {
    width: '47%',
    flexGrow: 1,
    borderRadius: Radii.lg,
    borderWidth: 1,
    padding: Spacing.md,
    gap: 4,
  },
  gameCardTile: {
    width: 52,
    height: 52,
    borderRadius: Radii.md,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: Spacing.xs,
  },
  gameCardName: { ...Typography.body, fontSize: 15, fontWeight: '700' },
  gameCardTag: { ...Typography.caption },

  primaryBtn: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: Spacing.md,
    borderRadius: Radii.pill,
    marginTop: Spacing.md,
  },
  primaryBtnText: { ...Typography.body, fontWeight: '700' },
});
