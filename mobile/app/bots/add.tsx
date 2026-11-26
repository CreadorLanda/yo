import { Ionicons } from '@expo/vector-icons';
import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Switch, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { BotBadge } from '@/components/bots/bot-badge';
import { Avatar } from '@/components/ui/avatar';
import { PrimaryButton } from '@/components/ui/primary-button';
import { Text } from '@/components/ui/text';
import { TextField } from '@/components/ui/text-field';
import { Radii, Spacing, Typography } from '@/constants/theme';
import { ApiError } from '@/data/api/client';
import { getBot, installBot, listMyBots, type BotDTO } from '@/data/api/bots';
import { normalizeBotUsername, scopesFor } from '@/data/bot-policy';
import { invalidateChatBots } from '@/data/bot-store';
import { useChats } from '@/data/chat-store';
import { appAlert } from '@/data/dialog-store';
import { refreshGroup } from '@/data/group-store';
import { showToast } from '@/data/toast-store';
import { useTheme } from '@/hooks/use-theme';
import { t } from '@/i18n';

/**
 * Add a bot to a group (#326). From a group (pick the bot) or from a bot
 * (pick the group); either way it ends on a consent screen that says, in
 * plain words, what the bot will be able to see and do there.
 */
export default function AddBotScreen() {
  const params = useLocalSearchParams<{ chatId?: string; botId?: string }>();
  const { colors } = useTheme();
  const { chats } = useChats();
  const [bot, setBot] = useState<BotDTO | null>(null);
  const [chatId, setChatId] = useState<string | undefined>(params.chatId);
  const [mine, setMine] = useState<BotDTO[] | null>(null);
  const [query, setQuery] = useState('');
  const [searching, setSearching] = useState(false);
  const [notFound, setNotFound] = useState(false);
  const [readAll, setReadAll] = useState(false);
  const [moderate, setModerate] = useState(false);
  const [busy, setBusy] = useState(false);

  const groups = useMemo(() => chats.filter((c) => c.type === 'group'), [chats]);
  const group = groups.find((g) => g.id === chatId);

  useEffect(() => {
    if (params.botId) {
      getBot(params.botId).then(setBot).catch(() => setNotFound(true));
    } else {
      listMyBots()
        .then((l) => setMine(l ?? []))
        .catch(() => setMine([]));
    }
  }, [params.botId]);

  const search = async () => {
    const u = normalizeBotUsername(query);
    if (!u) return;
    setSearching(true);
    setNotFound(false);
    try {
      setBot(await getBot(u));
    } catch {
      setNotFound(true);
    } finally {
      setSearching(false);
    }
  };

  const add = async () => {
    if (!bot || !chatId) return;
    setBusy(true);
    try {
      await installBot(chatId, { bot_id: bot.id, scopes: scopesFor({ readAll, moderate }) });
      invalidateChatBots(chatId);
      void refreshGroup(chatId).catch(() => {});
      showToast(t('bots.added', { name: bot.display_name }), 'success');
      router.back();
    } catch (e) {
      const code = e instanceof ApiError ? e.code : '';
      const body =
        code === 'not_group_admin'
          ? t('bots.only_admins')
          : code === 'bot_already_installed'
            ? t('bots.already_added')
            : code === 'chat_not_supported'
              ? t('bots.chat_not_supported')
              : t('chats.action_failed_body');
      appAlert(t('chats.action_failed_title'), body);
    } finally {
      setBusy(false);
    }
  };

  const step: 'bot' | 'group' | 'consent' = !bot ? 'bot' : !chatId ? 'group' : 'consent';

  return (
    <SafeAreaView style={[styles.screen, { backgroundColor: colors.background }]} edges={['top', 'bottom']}>
      <View style={[styles.header, { borderBottomColor: colors.border }]}>
        <Pressable
          onPress={() => {
            // Step back inside the flow before leaving it.
            if (step === 'consent' && !params.chatId) setChatId(undefined);
            else if (step !== 'bot' && !params.botId) setBot(null);
            else router.back();
          }}
          hitSlop={10}
        >
          <Ionicons name="chevron-back" size={26} color={colors.text} />
        </Pressable>
        <Text style={[styles.title, { color: colors.text }]} numberOfLines={1}>
          {step === 'bot' ? t('bots.pick_bot') : step === 'group' ? t('bots.pick_group') : t('bots.consent_title')}
        </Text>
      </View>

      <ScrollView contentContainerStyle={styles.body} keyboardShouldPersistTaps="handled">
        {step === 'bot' ? (
          <>
            <TextField
              label={t('bots.find_by_username')}
              value={query}
              onChangeText={(v) => {
                setQuery(v);
                setNotFound(false);
              }}
              placeholder="reminder_bot"
              autoCapitalize="none"
              autoCorrect={false}
              leftAdornment={<Text style={{ color: colors.textMuted }}>@</Text>}
              returnKeyType="search"
              onSubmitEditing={search}
              error={notFound ? t('bots.not_found') : undefined}
            />
            <PrimaryButton label={t('bots.find')} variant="secondary" loading={searching} disabled={!query.trim()} onPress={search} />
            {mine === null ? (
              <ActivityIndicator color={colors.primary} />
            ) : mine.length > 0 ? (
              <>
                <Text style={[styles.section, { color: colors.textSecondary }]}>{t('bots.my_bots')}</Text>
                <View style={[styles.list, { backgroundColor: colors.surface }]}>
                  {mine.map((b, i) => (
                    <Pressable
                      key={b.id}
                      onPress={() => setBot(b)}
                      style={({ pressed }) => [
                        styles.row,
                        i > 0 && { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.divider },
                        pressed && { backgroundColor: colors.surfaceMuted },
                      ]}
                    >
                      <Avatar uri={b.avatar_url} id={b.id} username={b.username} size={40} />
                      <View style={{ flex: 1 }}>
                        <Text style={[styles.name, { color: colors.text }]} numberOfLines={1}>
                          {b.display_name}
                        </Text>
                        <Text style={[styles.sub, { color: colors.textSecondary }]}>@{b.username}</Text>
                      </View>
                    </Pressable>
                  ))}
                </View>
              </>
            ) : null}
          </>
        ) : null}

        {step === 'group' ? (
          groups.length === 0 ? (
            <Text style={[styles.sub, { color: colors.textSecondary }]}>{t('bots.no_groups')}</Text>
          ) : (
            <>
              <Text style={[styles.sub, { color: colors.textSecondary }]}>{t('bots.pick_group_hint')}</Text>
              <View style={[styles.list, { backgroundColor: colors.surface }]}>
                {groups.map((g, i) => (
                  <Pressable
                    key={g.id}
                    onPress={() => setChatId(g.id)}
                    style={({ pressed }) => [
                      styles.row,
                      i > 0 && { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.divider },
                      pressed && { backgroundColor: colors.surfaceMuted },
                    ]}
                  >
                    <Avatar uri={g.avatar_url} id={g.id} username={g.title} size={40} />
                    <Text style={[styles.name, { color: colors.text, flex: 1 }]} numberOfLines={1}>
                      {g.title}
                    </Text>
                  </Pressable>
                ))}
              </View>
            </>
          )
        ) : null}

        {step === 'consent' && bot ? (
          <>
            <View style={styles.hero}>
              <Avatar uri={bot.avatar_url} id={bot.id} username={bot.username} size={72} />
              <View style={styles.heroName}>
                <Text style={[styles.heroTitle, { color: colors.text }]}>{bot.display_name}</Text>
                <BotBadge />
                {bot.verified ? <Ionicons name="checkmark-circle" size={18} color={colors.primary} /> : null}
              </View>
              <Text style={[styles.sub, { color: colors.textSecondary }]}>@{bot.username}</Text>
              {bot.description ? (
                <Text style={[styles.desc, { color: colors.text }]}>{bot.description}</Text>
              ) : null}
            </View>

            <Text style={[styles.section, { color: colors.textSecondary }]}>
              {t('bots.consent_can', { group: group?.title ?? '' })}
            </Text>
            <View style={[styles.list, styles.points, { backgroundColor: colors.surface }]}>
              <Point icon="chatbubble-ellipses-outline" text={t('bots.consent_addressed')} />
              <Point icon="send-outline" text={t('bots.consent_send')} />
              <Point icon="people-outline" text={t('bots.consent_members')} />
              <Point icon="lock-closed-outline" text={t('bots.consent_encrypted')} />
            </View>

            <View style={[styles.list, styles.toggle, { backgroundColor: colors.surface }]}>
              <View style={{ flex: 1, gap: 2 }}>
                <Text style={[styles.name, { color: colors.text }]}>{t('bots.allow_read_all')}</Text>
                <Text style={[styles.sub, { color: readAll ? colors.warning : colors.textSecondary }]}>
                  {readAll ? t('bots.allow_read_all_body') : t('bots.read_all_off_hint')}
                </Text>
              </View>
              <Switch value={readAll} onValueChange={setReadAll} trackColor={{ true: colors.warning, false: colors.border }} />
            </View>
            <View style={[styles.list, styles.toggle, { backgroundColor: colors.surface }]}>
              <View style={{ flex: 1, gap: 2 }}>
                <Text style={[styles.name, { color: colors.text }]}>{t('bots.allow_moderate')}</Text>
                <Text style={[styles.sub, { color: moderate ? colors.warning : colors.textSecondary }]}>
                  {moderate ? t('bots.allow_moderate_body') : t('bots.moderate_off_hint')}
                </Text>
              </View>
              <Switch value={moderate} onValueChange={setModerate} trackColor={{ true: colors.warning, false: colors.border }} />
            </View>
            <Text style={[styles.sub, { color: colors.textSecondary }]}>{t('bots.consent_announced')}</Text>
          </>
        ) : null}
      </ScrollView>

      {step === 'consent' && bot ? (
        <View style={styles.footer}>
          <PrimaryButton label={t('bots.add_to', { group: group?.title ?? '' })} loading={busy} onPress={add} />
        </View>
      ) : null}
    </SafeAreaView>
  );
}

function Point({ icon, text }: { icon: keyof typeof Ionicons.glyphMap; text: string }) {
  const { colors } = useTheme();
  return (
    <View style={styles.point}>
      <Ionicons name={icon} size={18} color={colors.primary} />
      <Text style={[styles.pointText, { color: colors.text }]}>{text}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.md,
    paddingHorizontal: Spacing.lg,
    paddingVertical: Spacing.md,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  title: { ...Typography.h3, flex: 1 },
  body: { padding: Spacing.lg, gap: Spacing.md, paddingBottom: Spacing.xxl },
  section: { ...Typography.label, textTransform: 'uppercase', marginTop: Spacing.sm },
  list: { borderRadius: Radii.lg, overflow: 'hidden' },
  row: { flexDirection: 'row', alignItems: 'center', gap: Spacing.md, padding: Spacing.md },
  name: { ...Typography.bodyStrong },
  sub: { ...Typography.caption },
  hero: { alignItems: 'center', gap: Spacing.xs, paddingVertical: Spacing.md },
  heroName: { flexDirection: 'row', alignItems: 'center', gap: Spacing.xs },
  heroTitle: { ...Typography.h2 },
  desc: { ...Typography.callout, textAlign: 'center', marginTop: Spacing.xs },
  points: { padding: Spacing.lg, gap: Spacing.md },
  point: { flexDirection: 'row', gap: Spacing.md, alignItems: 'flex-start' },
  pointText: { ...Typography.callout, flex: 1 },
  toggle: { flexDirection: 'row', alignItems: 'center', gap: Spacing.md, padding: Spacing.lg },
  footer: { padding: Spacing.lg },
});
