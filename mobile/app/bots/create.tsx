import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { useEffect, useState } from 'react';
import { BackHandler, KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { SecretCard } from '@/components/bots/secret-card';
import { PrimaryButton } from '@/components/ui/primary-button';
import { StepHeader } from '@/components/ui/step-header';
import { Text } from '@/components/ui/text';
import { TextField } from '@/components/ui/text-field';
import { Radii, Spacing, Typography } from '@/constants/theme';
import { ApiError, getBaseUrl } from '@/data/api/client';
import {
  createBot,
  openBotDirect,
  sendBotTestEvent,
  setBotWebhook,
  type BotDTO,
} from '@/data/api/bots';
import {
  gatewayUrl,
  isValidBotName,
  isValidBotUsername,
  looksLikeWebhookUrl,
  MAX_BOT_DESCRIPTION,
  normalizeBotUsername,
  suggestBotUsername,
} from '@/data/bot-policy';
import { appAlert } from '@/data/dialog-store';
import { showToast } from '@/data/toast-store';
import { useTheme } from '@/hooks/use-theme';
import { t } from '@/i18n';

/**
 * Make a bot without leaving the app (#328): what a bot is, its name, its
 * token (shown once), how it will hear about events, and where to use it.
 */

type Step = 'intro' | 'details' | 'token' | 'connect' | 'done';
const ORDER: Step[] = ['intro', 'details', 'token', 'connect', 'done'];

export default function CreateBotScreen() {
  const { colors } = useTheme();
  const [step, setStep] = useState<Step>('intro');
  const [name, setName] = useState('');
  const [username, setUsername] = useState('');
  const [usernameEdited, setUsernameEdited] = useState(false);
  const [description, setDescription] = useState('');
  const [busy, setBusy] = useState(false);
  const [usernameError, setUsernameError] = useState<string | undefined>();
  const [bot, setBot] = useState<BotDTO | null>(null);
  const [token, setToken] = useState('');
  const [webhookUrl, setWebhookUrl] = useState('');
  const [webhookSecret, setWebhookSecret] = useState('');
  const [mode, setMode] = useState<'webhook' | 'gateway' | null>(null);

  const index = ORDER.indexOf(step);
  const shownUsername = usernameEdited ? username : name.trim() ? suggestBotUsername(name) : '';

  const back = () => {
    // Once the bot exists there is no going back to make it again.
    if (step === 'intro' || step === 'token' || step === 'done') {
      if (bot) router.replace({ pathname: '/bots/[id]', params: { id: bot.id } });
      else router.back();
      return;
    }
    setStep(ORDER[index - 1]);
  };

  // Android's back button steps back through the wizard, like the header's.
  useEffect(() => {
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      back();
      return true;
    });
    return () => sub.remove();
  });

  const create = async () => {
    const u = shownUsername;
    if (!isValidBotName(name) || !isValidBotUsername(u)) return;
    setBusy(true);
    setUsernameError(undefined);
    try {
      const res = await createBot({ username: u, display_name: name.trim(), description: description.trim() });
      setBot(res.bot);
      setToken(res.token.token);
      setStep('token');
    } catch (e) {
      const code = e instanceof ApiError ? e.code : '';
      if (code === 'username_taken') setUsernameError(t('bots.username_taken'));
      else if (code === 'too_many_bots') appAlert(t('bots.too_many_title'), t('bots.too_many_body'));
      else appAlert(t('chats.action_failed_title'), t('chats.action_failed_body'));
    } finally {
      setBusy(false);
    }
  };

  const saveWebhook = async () => {
    if (!bot || !looksLikeWebhookUrl(webhookUrl)) return;
    setBusy(true);
    try {
      const cfg = await setBotWebhook(bot.id, { url: webhookUrl.trim() });
      if (cfg.secret) setWebhookSecret(cfg.secret);
    } catch (e) {
      const code = e instanceof ApiError ? e.code : '';
      appAlert(
        t('chats.action_failed_title'),
        code === 'invalid_webhook_url' ? t('bots.webhook_invalid') : t('chats.action_failed_body'),
      );
    } finally {
      setBusy(false);
    }
  };

  const testEvent = async () => {
    if (!bot) return;
    try {
      await sendBotTestEvent(bot.id);
      showToast(t('bots.test_sent'), 'success');
    } catch {
      showToast(t('chats.action_failed_body'), 'error');
    }
  };

  const openChat = async () => {
    if (!bot) return;
    try {
      const { chat_id } = await openBotDirect(bot.id);
      router.replace({ pathname: '/chat/[id]', params: { id: chat_id } });
    } catch {
      appAlert(t('chats.action_failed_title'), t('chats.action_failed_body'));
    }
  };

  const titles: Record<Step, [string, string?]> = {
    intro: [t('bots.intro_title'), t('bots.intro_subtitle')],
    details: [t('bots.details_title'), t('bots.details_subtitle')],
    token: [t('bots.token_title'), t('bots.token_subtitle')],
    connect: [t('bots.connect_title'), t('bots.connect_subtitle')],
    done: [t('bots.done_title', { name: bot?.display_name ?? '' }), t('bots.done_subtitle')],
  };

  return (
    <SafeAreaView style={[styles.screen, { backgroundColor: colors.background }]} edges={['top', 'bottom']}>
      <KeyboardAvoidingView style={styles.screen} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <StepHeader step={index + 1} total={ORDER.length} title={titles[step][0]} subtitle={titles[step][1]} onBack={back} />
        <ScrollView contentContainerStyle={styles.body} keyboardShouldPersistTaps="handled">
          {step === 'intro' ? (
            <View style={styles.points}>
              <Point icon="chatbubbles-outline" title={t('bots.intro_point_what')} body={t('bots.intro_point_what_body')} />
              <Point icon="lock-closed-outline" title={t('bots.intro_point_private')} body={t('bots.intro_point_private_body')} />
              <Point icon="key-outline" title={t('bots.intro_point_token')} body={t('bots.intro_point_token_body')} />
              <Point icon="people-outline" title={t('bots.intro_point_groups')} body={t('bots.intro_point_groups_body')} />
            </View>
          ) : null}

          {step === 'details' ? (
            <View style={styles.form}>
              <TextField
                label={t('bots.field_name')}
                value={name}
                onChangeText={setName}
                placeholder={t('bots.field_name_placeholder')}
                maxLength={64}
                autoFocus
              />
              <TextField
                label={t('bots.field_username')}
                value={shownUsername}
                onChangeText={(v) => {
                  setUsernameEdited(true);
                  setUsername(normalizeBotUsername(v));
                  setUsernameError(undefined);
                }}
                autoCapitalize="none"
                autoCorrect={false}
                leftAdornment={<Text style={{ color: colors.textMuted }}>@</Text>}
                hint={t('bots.field_username_hint')}
                error={
                  usernameError ??
                  (shownUsername && !isValidBotUsername(shownUsername) ? t('bots.field_username_invalid') : undefined)
                }
              />
              <TextField
                label={t('bots.field_description')}
                value={description}
                onChangeText={setDescription}
                placeholder={t('bots.field_description_placeholder')}
                multiline
                maxLength={MAX_BOT_DESCRIPTION}
              />
            </View>
          ) : null}

          {step === 'token' && token ? (
            <View style={styles.form}>
              <SecretCard label={t('bots.token_label')} value={token} />
              <Text style={[styles.note, { color: colors.textSecondary }]}>{t('bots.token_how')}</Text>
              <Text selectable style={[styles.code, { color: colors.text, backgroundColor: colors.surfaceMuted }]}>
                Authorization: Bot zsb_…
              </Text>
            </View>
          ) : null}

          {step === 'connect' ? (
            <View style={styles.form}>
              <Choice
                icon="globe-outline"
                title={t('bots.mode_webhook')}
                body={t('bots.mode_webhook_body')}
                selected={mode === 'webhook'}
                onPress={() => setMode('webhook')}
              />
              {mode === 'webhook' ? (
                <View style={styles.form}>
                  <TextField
                    label={t('bots.webhook_url')}
                    value={webhookUrl}
                    onChangeText={setWebhookUrl}
                    placeholder="https://"
                    autoCapitalize="none"
                    autoCorrect={false}
                    keyboardType="url"
                    error={webhookUrl && !looksLikeWebhookUrl(webhookUrl) ? t('bots.webhook_https') : undefined}
                  />
                  {webhookSecret ? (
                    <>
                      <SecretCard label={t('bots.webhook_secret_label')} value={webhookSecret} />
                      <Text style={[styles.note, { color: colors.textSecondary }]}>{t('bots.webhook_verify')}</Text>
                      <PrimaryButton label={t('bots.test_event')} variant="secondary" onPress={testEvent} />
                    </>
                  ) : (
                    <PrimaryButton
                      label={t('bots.webhook_save')}
                      loading={busy}
                      disabled={!looksLikeWebhookUrl(webhookUrl)}
                      onPress={saveWebhook}
                    />
                  )}
                </View>
              ) : null}
              <Choice
                icon="flash-outline"
                title={t('bots.mode_gateway')}
                body={t('bots.mode_gateway_body')}
                selected={mode === 'gateway'}
                onPress={() => setMode('gateway')}
              />
              {mode === 'gateway' ? (
                <Text selectable style={[styles.code, { color: colors.text, backgroundColor: colors.surfaceMuted }]}>
                  {gatewayUrl(getBaseUrl())}
                </Text>
              ) : null}
            </View>
          ) : null}

          {step === 'done' && bot ? (
            <View style={styles.form}>
              <View style={[styles.doneIcon, { backgroundColor: colors.surfaceMuted }]}>
                <Ionicons name="checkmark-circle" size={48} color={colors.success} />
              </View>
              <Text style={[styles.handle, { color: colors.textSecondary }]}>@{bot.username}</Text>
              <PrimaryButton
                label={t('bots.add_to_group')}
                onPress={() => router.replace({ pathname: '/bots/add', params: { botId: bot.id } })}
              />
              <PrimaryButton label={t('bots.open_chat')} variant="secondary" onPress={openChat} />
              <PrimaryButton
                label={t('bots.manage')}
                variant="secondary"
                onPress={() => router.replace({ pathname: '/bots/[id]', params: { id: bot.id } })}
              />
            </View>
          ) : null}
        </ScrollView>

        {step !== 'done' ? (
          <View style={styles.footer}>
            {step === 'intro' ? <PrimaryButton label={t('bots.intro_start')} onPress={() => setStep('details')} /> : null}
            {step === 'details' ? (
              <PrimaryButton
                label={t('bots.create')}
                loading={busy}
                disabled={!isValidBotName(name) || !isValidBotUsername(shownUsername)}
                onPress={create}
              />
            ) : null}
            {step === 'token' ? <PrimaryButton label={t('bots.token_saved')} onPress={() => setStep('connect')} /> : null}
            {step === 'connect' ? (
              <PrimaryButton
                label={mode ? t('common.continue') : t('bots.connect_later')}
                variant={mode ? 'primary' : 'secondary'}
                onPress={() => setStep('done')}
              />
            ) : null}
          </View>
        ) : null}
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

function Point({ icon, title, body }: { icon: keyof typeof Ionicons.glyphMap; title: string; body: string }) {
  const { colors } = useTheme();
  return (
    <View style={styles.point}>
      <View style={[styles.pointIcon, { backgroundColor: colors.surfaceMuted }]}>
        <Ionicons name={icon} size={22} color={colors.primary} />
      </View>
      <View style={{ flex: 1, gap: 2 }}>
        <Text style={[styles.pointTitle, { color: colors.text }]}>{title}</Text>
        <Text style={[styles.pointBody, { color: colors.textSecondary }]}>{body}</Text>
      </View>
    </View>
  );
}

function Choice({
  icon,
  title,
  body,
  selected,
  onPress,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  title: string;
  body: string;
  selected: boolean;
  onPress: () => void;
}) {
  const { colors } = useTheme();
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="radio"
      accessibilityState={{ selected }}
      style={[
        styles.choice,
        { backgroundColor: colors.surface, borderColor: selected ? colors.primary : colors.border },
      ]}
    >
      <Ionicons name={icon} size={22} color={selected ? colors.primary : colors.textSecondary} />
      <View style={{ flex: 1, gap: 2 }}>
        <Text style={[styles.pointTitle, { color: colors.text }]}>{title}</Text>
        <Text style={[styles.pointBody, { color: colors.textSecondary }]}>{body}</Text>
      </View>
      <Ionicons
        name={selected ? 'radio-button-on' : 'radio-button-off'}
        size={20}
        color={selected ? colors.primary : colors.textMuted}
      />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  body: { padding: Spacing.lg, gap: Spacing.lg, paddingBottom: Spacing.xxl },
  points: { gap: Spacing.lg },
  point: { flexDirection: 'row', gap: Spacing.md, alignItems: 'flex-start' },
  pointIcon: { width: 44, height: 44, borderRadius: Radii.pill, alignItems: 'center', justifyContent: 'center' },
  pointTitle: { ...Typography.bodyStrong },
  pointBody: { ...Typography.callout },
  form: { gap: Spacing.md },
  note: { ...Typography.caption },
  code: { ...Typography.caption, fontFamily: 'monospace', padding: Spacing.md, borderRadius: Radii.md },
  choice: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.md,
    padding: Spacing.lg,
    borderRadius: Radii.lg,
    borderWidth: 1.5,
  },
  doneIcon: {
    alignSelf: 'center',
    width: 88,
    height: 88,
    borderRadius: Radii.pill,
    alignItems: 'center',
    justifyContent: 'center',
  },
  handle: { ...Typography.callout, textAlign: 'center' },
  footer: { padding: Spacing.lg },
});
