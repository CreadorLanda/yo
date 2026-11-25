import { Ionicons } from '@expo/vector-icons';
import { router, useLocalSearchParams } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, RefreshControl, ScrollView, StyleSheet, Switch, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { SecretCard } from '@/components/bots/secret-card';
import { Avatar } from '@/components/ui/avatar';
import { PrimaryButton } from '@/components/ui/primary-button';
import { Text } from '@/components/ui/text';
import { TextField } from '@/components/ui/text-field';
import { Radii, Spacing, Typography } from '@/constants/theme';
import { ApiError } from '@/data/api/client';
import {
  clearBotWebhook,
  deleteBot,
  getBot,
  getBotWebhook,
  listBotDeliveries,
  listBotTokens,
  openBotDirect,
  revokeBotTokens,
  rotateBotToken,
  rotateBotWebhookSecret,
  sendBotTestEvent,
  setBotWebhook,
  updateBot,
  type BotDeliveryDTO,
  type BotDTO,
  type BotEventType,
  type BotTokenDTO,
  type BotWebhookDTO,
} from '@/data/api/bots';
import { isValidBotName, looksLikeWebhookUrl, MAX_BOT_DESCRIPTION, WEBHOOK_EVENT_CHOICES } from '@/data/bot-policy';
import { appAlert } from '@/data/dialog-store';
import { formatMsgTime } from '@/data/message-map';
import { showToast } from '@/data/toast-store';
import { useTheme } from '@/hooks/use-theme';
import { t } from '@/i18n';

/**
 * Run a bot you own (#328): its profile, privacy mode, token, webhook,
 * delivery log, a test event, and deleting it. Secrets appear here only in
 * the reply that made them, and are gone when the screen is.
 */
export default function BotScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { colors } = useTheme();
  const [bot, setBot] = useState<BotDTO | null>(null);
  const [tokens, setTokens] = useState<BotTokenDTO[]>([]);
  const [hook, setHook] = useState<BotWebhookDTO | null>(null);
  const [deliveries, setDeliveries] = useState<BotDeliveryDTO[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [url, setUrl] = useState('');
  const [intents, setIntents] = useState<BotEventType[]>([]);
  const [newToken, setNewToken] = useState('');
  const [newSecret, setNewSecret] = useState('');
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!id) return;
    try {
      const [b, toks, wh, del] = await Promise.all([
        getBot(id),
        listBotTokens(id),
        getBotWebhook(id),
        listBotDeliveries(id),
      ]);
      setBot(b);
      setName(b.display_name);
      setDescription(b.description);
      setTokens(toks ?? []);
      setHook(wh);
      setUrl(wh.url);
      setIntents(wh.intents ?? []);
      setDeliveries(del ?? []);
    } catch {
      appAlert(t('chats.action_failed_title'), t('chats.action_failed_body'));
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [id]);

  useEffect(() => {
    void load();
  }, [load]);

  const run = async (key: string, work: () => Promise<void>) => {
    setBusy(key);
    try {
      await work();
    } catch (e) {
      const code = e instanceof ApiError ? e.code : '';
      appAlert(
        t('chats.action_failed_title'),
        code === 'invalid_webhook_url' ? t('bots.webhook_invalid') : t('chats.action_failed_body'),
      );
    } finally {
      setBusy(null);
    }
  };

  if (loading || !bot || !id) {
    return (
      <SafeAreaView style={[styles.screen, styles.center, { backgroundColor: colors.background }]}>
        <ActivityIndicator color={colors.primary} />
      </SafeAreaView>
    );
  }

  const profileDirty = name.trim() !== bot.display_name || description.trim() !== bot.description;
  const hookDirty =
    url.trim() !== (hook?.url ?? '') || [...intents].sort().join() !== [...(hook?.intents ?? [])].sort().join();

  const saveProfile = () =>
    run('profile', async () => {
      const b = await updateBot(id, { display_name: name.trim(), description: description.trim() });
      setBot(b);
      showToast(t('bots.saved'), 'success');
    });

  const togglePrivacy = (on: boolean) =>
    run('privacy', async () => {
      setBot(await updateBot(id, { privacy_mode: on }));
    });

  const rotateToken = () =>
    appAlert(t('bots.rotate_token_title'), t('bots.rotate_token_body'), [
      { text: t('common.cancel'), style: 'cancel' },
      {
        text: t('bots.rotate_token'),
        onPress: () =>
          void run('token', async () => {
            const tok = await rotateBotToken(id);
            setNewToken(tok.token);
            setTokens(await listBotTokens(id));
          }),
      },
    ]);

  const revokeTokens = () =>
    appAlert(t('bots.revoke_title'), t('bots.revoke_body'), [
      { text: t('common.cancel'), style: 'cancel' },
      {
        text: t('bots.revoke'),
        style: 'destructive',
        onPress: () =>
          void run('token', async () => {
            await revokeBotTokens(id);
            setNewToken('');
            setTokens([]);
          }),
      },
    ]);

  const saveHook = () =>
    run('hook', async () => {
      const cfg = await setBotWebhook(id, { url: url.trim(), intents });
      if (cfg.secret) setNewSecret(cfg.secret);
      setHook({ ...cfg, secret: undefined });
      showToast(t('bots.saved'), 'success');
    });

  const rotateSecret = () =>
    run('hook', async () => {
      const cfg = await rotateBotWebhookSecret(id);
      setNewSecret(cfg.secret ?? '');
    });

  const removeHook = () =>
    appAlert(t('bots.webhook_remove_title'), t('bots.webhook_remove_body'), [
      { text: t('common.cancel'), style: 'cancel' },
      {
        text: t('bots.webhook_remove'),
        style: 'destructive',
        onPress: () =>
          void run('hook', async () => {
            await clearBotWebhook(id);
            setHook({ url: '', intents: [], has_secret: false });
            setUrl('');
            setIntents([]);
            setNewSecret('');
          }),
      },
    ]);

  const testEvent = () =>
    run('test', async () => {
      await sendBotTestEvent(id);
      showToast(t('bots.test_sent'), 'success');
      setTimeout(() => {
        void listBotDeliveries(id).then((d) => setDeliveries(d ?? [])).catch(() => {});
      }, 2500);
    });

  const remove = () =>
    appAlert(t('bots.delete_title', { name: bot.display_name }), t('bots.delete_body'), [
      { text: t('common.cancel'), style: 'cancel' },
      {
        text: t('common.delete'),
        style: 'destructive',
        onPress: () =>
          void run('delete', async () => {
            await deleteBot(id);
            router.back();
          }),
      },
    ]);

  const toggleIntent = (e: BotEventType) =>
    setIntents((cur) => (cur.includes(e) ? cur.filter((x) => x !== e) : [...cur, e]));

  return (
    <SafeAreaView style={[styles.screen, { backgroundColor: colors.background }]} edges={['top']}>
      <View style={[styles.header, { borderBottomColor: colors.border }]}>
        <Pressable onPress={() => router.back()} hitSlop={10}>
          <Ionicons name="chevron-back" size={26} color={colors.text} />
        </Pressable>
        <Text style={[styles.title, { color: colors.text }]} numberOfLines={1}>
          {bot.display_name}
        </Text>
      </View>

      <ScrollView
        contentContainerStyle={styles.body}
        keyboardShouldPersistTaps="handled"
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={() => {
              setRefreshing(true);
              void load();
            }}
            tintColor={colors.primary}
          />
        }
      >
        <View style={styles.hero}>
          <Avatar uri={bot.avatar_url} id={bot.id} username={bot.username} size={72} />
          <View style={styles.heroName}>
            <Text style={[styles.name, { color: colors.text }]}>{bot.display_name}</Text>
            <View style={[styles.badge, { backgroundColor: colors.surfaceMuted }]}>
              <Text style={[styles.badgeText, { color: colors.primary }]}>{t('bots.badge')}</Text>
            </View>
          </View>
          <Text style={[styles.handle, { color: colors.textSecondary }]}>@{bot.username}</Text>
          <View style={styles.heroActions}>
            <PrimaryButton
              label={t('bots.open_chat')}
              onPress={() =>
                void run('dm', async () => {
                  const { chat_id } = await openBotDirect(bot.id);
                  router.push({ pathname: '/chat/[id]', params: { id: chat_id } });
                })
              }
            />
          </View>
        </View>

        <Section title={t('bots.section_profile')}>
          <TextField label={t('bots.field_name')} value={name} onChangeText={setName} maxLength={64} />
          <TextField
            label={t('bots.field_description')}
            value={description}
            onChangeText={setDescription}
            multiline
            maxLength={MAX_BOT_DESCRIPTION}
          />
          {profileDirty ? (
            <PrimaryButton
              label={t('common.save')}
              loading={busy === 'profile'}
              disabled={!isValidBotName(name)}
              onPress={saveProfile}
            />
          ) : null}
          <View style={styles.switchRow}>
            <View style={{ flex: 1, gap: 2 }}>
              <Text style={[styles.rowTitle, { color: colors.text }]}>{t('bots.privacy_mode')}</Text>
              <Text style={[styles.rowBody, { color: colors.textSecondary }]}>
                {bot.privacy_mode ? t('bots.privacy_on') : t('bots.privacy_off')}
              </Text>
            </View>
            <Switch
              value={bot.privacy_mode}
              onValueChange={togglePrivacy}
              disabled={busy === 'privacy'}
              trackColor={{ true: colors.primary, false: colors.border }}
            />
          </View>
        </Section>

        <Section title={t('bots.section_token')}>
          {newToken ? <SecretCard label={t('bots.token_label')} value={newToken} /> : null}
          {tokens.length === 0 ? (
            <Text style={[styles.rowBody, { color: colors.textSecondary }]}>{t('bots.no_token')}</Text>
          ) : (
            tokens.map((tok) => (
              <View key={tok.id} style={styles.tokenRow}>
                <Ionicons name="key-outline" size={18} color={colors.textSecondary} />
                <Text style={[styles.mono, { color: colors.text }]}>{tok.prefix}…</Text>
                <Text style={[styles.rowBody, { color: colors.textSecondary }]}>
                  {tok.last_used_at
                    ? t('bots.token_used', { time: formatMsgTime(tok.last_used_at) })
                    : t('bots.token_unused')}
                </Text>
              </View>
            ))
          )}
          <View style={styles.inline}>
            <SmallButton label={t('bots.rotate_token')} onPress={rotateToken} busy={busy === 'token'} />
            {tokens.length > 0 ? <SmallButton label={t('bots.revoke')} danger onPress={revokeTokens} /> : null}
          </View>
        </Section>

        <Section title={t('bots.section_webhook')} hint={t('bots.webhook_hint')}>
          <TextField
            label={t('bots.webhook_url')}
            value={url}
            onChangeText={setUrl}
            placeholder="https://"
            autoCapitalize="none"
            autoCorrect={false}
            keyboardType="url"
            error={url && !looksLikeWebhookUrl(url) ? t('bots.webhook_https') : undefined}
          />
          <Text style={[styles.rowTitle, { color: colors.text }]}>{t('bots.events')}</Text>
          <Text style={[styles.rowBody, { color: colors.textSecondary }]}>
            {intents.length === 0 ? t('bots.events_all') : t('bots.events_some', { count: intents.length })}
          </Text>
          <View style={styles.chips}>
            {WEBHOOK_EVENT_CHOICES.map((e) => {
              const on = intents.includes(e);
              return (
                <Pressable
                  key={e}
                  onPress={() => toggleIntent(e)}
                  accessibilityRole="checkbox"
                  accessibilityState={{ checked: on }}
                  style={[
                    styles.chip,
                    { borderColor: on ? colors.primary : colors.border, backgroundColor: on ? colors.surfaceMuted : 'transparent' },
                  ]}
                >
                  <Text style={[styles.chipText, { color: on ? colors.primary : colors.textSecondary }]}>{e}</Text>
                </Pressable>
              );
            })}
          </View>
          {hookDirty && looksLikeWebhookUrl(url) ? (
            <PrimaryButton label={t('bots.webhook_save')} loading={busy === 'hook'} onPress={saveHook} />
          ) : null}
          {newSecret ? <SecretCard label={t('bots.webhook_secret_label')} value={newSecret} /> : null}
          {hook?.url ? (
            <View style={styles.inline}>
              <SmallButton label={t('bots.rotate_secret')} onPress={rotateSecret} busy={busy === 'hook'} />
              <SmallButton label={t('bots.webhook_remove')} danger onPress={removeHook} />
            </View>
          ) : null}
        </Section>

        <Section title={t('bots.section_deliveries')} hint={t('bots.deliveries_hint')}>
          <SmallButton label={t('bots.test_event')} onPress={testEvent} busy={busy === 'test'} />
          {deliveries.length === 0 ? (
            <Text style={[styles.rowBody, { color: colors.textSecondary }]}>{t('bots.deliveries_empty')}</Text>
          ) : (
            deliveries.slice(0, 30).map((d) => (
              <View key={d.id} style={[styles.delivery, { borderBottomColor: colors.divider }]}>
                <View
                  style={[
                    styles.dot,
                    {
                      backgroundColor:
                        d.status === 'delivered' ? colors.success : d.status === 'dead' ? colors.danger : colors.warning,
                    },
                  ]}
                />
                <View style={{ flex: 1 }}>
                  <Text style={[styles.mono, { color: colors.text }]}>{d.event_type}</Text>
                  <Text style={[styles.rowBody, { color: colors.textSecondary }]} numberOfLines={1}>
                    {t(`bots.delivery_${d.status}`)}
                    {d.last_status ? ` · ${d.last_status}` : ''}
                    {d.last_error ? ` · ${d.last_error}` : ''}
                    {` · ${t('bots.delivery_attempts', { count: d.attempts })}`}
                  </Text>
                </View>
                <Text style={[styles.rowBody, { color: colors.textMuted }]}>{formatMsgTime(d.created_at)}</Text>
              </View>
            ))
          )}
        </Section>

        <PrimaryButton label={t('bots.delete')} variant="secondary" loading={busy === 'delete'} onPress={remove} />
      </ScrollView>
    </SafeAreaView>
  );
}

function Section({ title, hint, children }: { title: string; hint?: string; children: React.ReactNode }) {
  const { colors } = useTheme();
  return (
    <View style={styles.section}>
      <Text style={[styles.sectionTitle, { color: colors.textSecondary }]}>{title}</Text>
      <View style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.border }]}>
        {hint ? <Text style={[styles.rowBody, { color: colors.textSecondary }]}>{hint}</Text> : null}
        {children}
      </View>
    </View>
  );
}

function SmallButton({ label, onPress, busy, danger }: { label: string; onPress: () => void; busy?: boolean; danger?: boolean }) {
  const { colors } = useTheme();
  return (
    <Pressable
      onPress={onPress}
      disabled={busy}
      accessibilityRole="button"
      style={({ pressed }) => [styles.small, { borderColor: colors.border, opacity: pressed || busy ? 0.6 : 1 }]}
    >
      {busy ? <ActivityIndicator size="small" color={colors.primary} /> : null}
      <Text style={[styles.smallText, { color: danger ? colors.danger : colors.primary }]}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  center: { alignItems: 'center', justifyContent: 'center' },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.md,
    paddingHorizontal: Spacing.lg,
    paddingVertical: Spacing.md,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  title: { ...Typography.h3, flex: 1 },
  body: { padding: Spacing.lg, gap: Spacing.xl, paddingBottom: Spacing.xxxl },
  hero: { alignItems: 'center', gap: Spacing.sm },
  heroName: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm },
  name: { ...Typography.h2 },
  badge: { paddingHorizontal: Spacing.sm, paddingVertical: 2, borderRadius: Radii.sm },
  badgeText: { ...Typography.micro },
  handle: { ...Typography.callout },
  heroActions: { alignSelf: 'stretch', gap: Spacing.sm, marginTop: Spacing.sm },
  section: { gap: Spacing.sm },
  sectionTitle: { ...Typography.label, textTransform: 'uppercase' },
  card: { borderWidth: StyleSheet.hairlineWidth, borderRadius: Radii.lg, padding: Spacing.lg, gap: Spacing.md },
  switchRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.md },
  rowTitle: { ...Typography.bodyStrong },
  rowBody: { ...Typography.caption },
  tokenRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm },
  mono: { ...Typography.callout, fontFamily: 'monospace' },
  inline: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.sm },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.xs },
  chip: { borderWidth: 1, borderRadius: Radii.pill, paddingHorizontal: Spacing.md, paddingVertical: Spacing.xs },
  chipText: { ...Typography.micro },
  delivery: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
    paddingVertical: Spacing.sm,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  dot: { width: 8, height: 8, borderRadius: Radii.pill },
  small: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.xs,
    alignSelf: 'flex-start',
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: Radii.pill,
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm,
  },
  smallText: { ...Typography.label },
});
