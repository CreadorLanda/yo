import { Ionicons } from '@expo/vector-icons';
import { Image } from 'expo-image';
import { router } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import type { ReactNode } from 'react';
import { useCallback, useEffect, useState } from 'react';
import { Linking, Pressable, ScrollView, StyleSheet, Switch, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Text } from '@/components/ui/text';
import { Radii, Spacing, Typography } from '@/constants/theme';
import { appAlert, appPrompt } from '@/data/dialog-store';
import { deleteMe, me, patchMe, type UserPatch } from '@/data/api/users';
import {
  biometricsAvailable,
  setAppLockBiometrics,
  setAppLockEnabled,
  setAppLockTimeout,
  useAppLockPrefs,
} from '@/data/app-lock';
import { LOCK_TIMEOUTS_MS, type LockTimeoutMs } from '@/data/app-lock-policy';
import { clearSession, getSessionPhone } from '@/data/auth-store';
import { hasLockCode, isValidCode, setLockCode } from '@/data/chat-lock';
import { resetAllStores } from '@/data/reset';

import {
  getNotifPrefs,
  patchNotifPrefs,
} from '@/data/api/notifications';
import { registerPushWithServer } from '@/data/push';
import { useProfile } from '@/data/profile-store';
import {
  getActivePack,
  setSchemePreference,
  type SchemePreference,
  useActiveThemeId,
} from '@/data/theme-store';
import { useTheme } from '@/hooks/use-theme';
import { t } from '@/i18n';

type Visibility = 'everyone' | 'contacts' | 'nobody';

const APP_VERSION = '1.0.0';

export default function SettingsScreen() {
  const { colors, isDark, schemePreference } = useTheme();
  const profile = useProfile();
  // Subscribe so the marketplace row refreshes when a pack is applied.
  useActiveThemeId();
  const activePack = getActivePack();

  // Privacy, loaded from the account and written back on change. These were
  // React state and nothing else: every switch reset itself the moment you
  // left the screen, and none of it ever reached the server.
  const [lastSeen, setLastSeen] = useState<Visibility>('everyone');
  const [profilePhoto, setProfilePhoto] = useState<Visibility>('everyone');
  const [readReceipts, setReadReceipts] = useState(true);
  const [phone, setPhone] = useState('');
  const [privacyLoaded, setPrivacyLoaded] = useState(false);

  useEffect(() => {
    let cancelled = false;
    me()
      .then((u) => {
        if (cancelled) return;
        setLastSeen(u.last_seen_visibility ?? 'everyone');
        setProfilePhoto(u.photo_visibility ?? 'everyone');
        setReadReceipts(u.read_receipts !== false);
        // Not from the server: it holds a hash of the number, never the
        // number. The device is the only place that can answer this.
        void getSessionPhone().then(setPhone);
        setPrivacyLoaded(true);
      })
      .catch(() => {
        if (!cancelled) setPrivacyLoaded(true);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  /**
   * Optimistic, with a rollback.
   *
   * A privacy switch that silently fails to save is worse than one that
   * refuses: the person believes they are hidden and they are not.
   */
  const savePrivacy = useCallback(
    (patch: UserPatch, rollback: () => void) => {
      if (!privacyLoaded) return;
      patchMe(patch).catch(() => {
        rollback();
        appAlert(t('settings.privacy_failed_title'), t('settings.privacy_failed_body'));
      });
    },
    [privacyLoaded],
  );
  const [notifMessages, setNotifMessages] = useState(true);
  const [notifGroups, setNotifGroups] = useState(true);
  const [notifCalls, setNotifCalls] = useState(false);
  const [notifStories, setNotifStories] = useState(true);
  const [prefsLoaded, setPrefsLoaded] = useState(false);

  // Load notification prefs + register Expo/FCM push token with the API.
  useEffect(() => {
    let cancelled = false;
    getNotifPrefs()
      .then((p) => {
        if (cancelled) return;
        setNotifMessages(p.messages);
        setNotifGroups(p.groups);
        setNotifCalls(p.calls);
        setNotifStories(p.stories);
        setPrefsLoaded(true);
      })
      .catch(() => {
        if (!cancelled) setPrefsLoaded(true);
      });
    registerPushWithServer().catch(() => {
      /* permission denied / simulator / offline */
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const saveNotif = useCallback(
    (patch: {
      messages?: boolean;
      groups?: boolean;
      calls?: boolean;
      stories?: boolean;
    }) => {
      if (patch.messages != null) setNotifMessages(patch.messages);
      if (patch.groups != null) setNotifGroups(patch.groups);
      if (patch.calls != null) setNotifCalls(patch.calls);
      if (patch.stories != null) setNotifStories(patch.stories);
      if (!prefsLoaded) return;
      patchNotifPrefs(patch).catch(() => {
        /* keep optimistic */
      });
    },
    [prefsLoaded],
  );

  const visibilityLabel = (v: Visibility) =>
    v === 'everyone'
      ? t('settings.visibility_everyone')
      : v === 'contacts'
        ? t('settings.visibility_contacts')
        : t('settings.visibility_nobody');

  // ── App lock ──────────────────────────────────────────────────────────
  const appLock = useAppLockPrefs();
  const [bioAvailable, setBioAvailable] = useState(false);

  useEffect(() => {
    let alive = true;
    biometricsAvailable().then((ok) => {
      if (alive) setBioAvailable(ok);
    });
    return () => {
      alive = false;
    };
  }, []);

  /** Same dialog shape the per-chat lock uses, so the two feel like one thing. */
  const promptCode = (title: string, onSubmit: (code: string) => Promise<boolean>) =>
    appPrompt(title, {
      message: t('app_lock.code_hint'),
      placeholder: t('app_lock.code_placeholder'),
      secure: true,
      keyboard: 'number-pad',
      cancelLabel: t('common.cancel'),
      submitLabel: t('common.confirm'),
      onSubmit,
    });

  /**
   * Switching the lock either way asks for the code.
   *
   * Turning it *off* matters as much as turning it on: without the check,
   * anyone holding the phone walks past the lock by opening settings and
   * flipping the switch.
   */
  const toggleAppLock = (next: boolean) => {
    void (async () => {
      if (next && !(await hasLockCode())) {
        promptCode(t('app_lock.set_code'), async (code) => {
          if (!isValidCode(code)) return false;
          await setLockCode(code);
          await setAppLockEnabled(true, code);
          appAlert(t('app_lock.enabled_title'), t('app_lock.enabled_body'));
          return true;
        });
        return;
      }
      promptCode(next ? t('app_lock.confirm_code') : t('app_lock.disable_code'), async (code) => {
        const ok = await setAppLockEnabled(next, code);
        return ok;
      });
    })();
  };

  const timeoutLabel = (ms: number) =>
    ms === 0 ? t('app_lock.timeout_immediately') : t('app_lock.timeout_minutes', { n: ms / 60000 });

  const pickTimeout = () => {
    appAlert(
      t('app_lock.timeout'),
      undefined,
      LOCK_TIMEOUTS_MS.map((ms) => ({
        text: timeoutLabel(ms) + (ms === appLock.timeoutMs ? '  \u2713' : ''),
        onPress: () => void setAppLockTimeout(ms as LockTimeoutMs),
      })),
    );
  };

  const pickVisibility = (
    title: string,
    current: Visibility,
    set: (v: Visibility) => void,
    field: 'last_seen_visibility' | 'photo_visibility',
  ) => {
    const opt = (v: Visibility) => ({
      text: visibilityLabel(v) + (v === current ? '  ✓' : ''),
      onPress: () => {
        set(v);
        savePrivacy({ [field]: v }, () => set(current));
      },
    });
    appAlert(title, undefined, [
      opt('everyone'),
      opt('contacts'),
      opt('nobody'),
      { text: t('settings.cancel'), style: 'cancel' },
    ]);
  };

  /**
   * Deleting the account. Two steps, and the second names what goes.
   *
   * The button used to open a dialog whose destructive option had no
   * handler at all — it looked like a decision and did nothing. Now it is
   * real and irreversible, which is exactly why it asks twice.
   */
  const confirmDelete = () =>
    appAlert(t('settings.delete_confirm_title'), t('settings.delete_confirm_body'), [
      { text: t('settings.cancel'), style: 'cancel' },
      {
        text: t('settings.delete_continue'),
        style: 'destructive',
        onPress: () =>
          appAlert(t('settings.delete_final_title'), t('settings.delete_final_body'), [
            { text: t('settings.cancel'), style: 'cancel' },
            {
              text: t('settings.delete'),
              style: 'destructive',
              onPress: () => {
                /*
                 * Leave only if the account actually went.
                 *
                 * This navigated in a `.finally`, so a failed delete looked
                 * exactly like a successful one: a generic dialog for a
                 * moment, then onboarding. And `clearSession()` ran only on
                 * success, so the token stayed in the keychain — the next
                 * launch restored the session and dropped you back into the
                 * account you thought you had deleted.
                 *
                 * The server refused every delete for anyone who had ever sent
                 * a message, so that was the normal path, not the edge case.
                 */
                deleteMe()
                  .then(async () => {
                    // Local state has to go too: the account is gone, and
                    // leaving its history on the device would outlive it.
                    await resetAllStores();
                    await clearSession();
                    router.replace('/onboarding');
                  })
                  .catch(() => {
                    // Stay put. The account is still there, and so is the
                    // session that reaches it.
                    appAlert(t('settings.delete_failed_title'), t('settings.delete_failed_body'));
                  });
              },
            },
          ]),
      },
    ]);

  const confirmLogout = () =>
    appAlert(t('settings.logout_title'), t('settings.logout_body'), [
      { text: t('settings.cancel'), style: 'cancel' },
      {
        text: t('settings.logout_confirm'),
        style: 'destructive',
        onPress: () => {
          // Every in-memory store, the encrypted database and the media
          // cache. Each one outlives the account that filled it, so the next
          // person to sign in inherits the last one's data — see data/reset.
          //
          // Before clearSession, not alongside it: the first step unregisters
          // this device for push, and that call needs the token the session
          // is about to erase. Running both at once meant the DELETE went out
          // authenticated-or-not depending on which promise won, so the
          // device stayed subscribed to an account nobody was signed in to.
          // resetAllStores never rejects and each step is bounded.
          void resetAllStores().finally(() => {
            clearSession().catch(() => {
              /* swallowed — local SecureStore wipe is best-effort */
            });
          });
          // replace, not push — the user shouldn't be able to swipe back
          // into a screen that still thinks it's authenticated.
          router.replace('/onboarding');
        },
      },
    ]);

  return (
    <SafeAreaView style={[styles.safe, { backgroundColor: colors.background }]} edges={['top', 'bottom']}>
      <StatusBar style={isDark ? 'light' : 'dark'} />

      <View style={[styles.header, { borderBottomColor: colors.divider }]}>
        <Pressable
          onPress={() => router.back()}
          hitSlop={12}
          style={styles.backBtn}
          accessibilityLabel={t('auth.back')}
        >
          <Ionicons name="chevron-back" size={26} color={colors.text} />
        </Pressable>
        <Text style={[styles.headerTitle, { color: colors.text }]}>{t('settings.title')}</Text>
        <View style={styles.backBtn} />
      </View>

      <ScrollView contentContainerStyle={styles.body} showsVerticalScrollIndicator={false}>
        <Pressable
          onPress={() => router.push('/profile')}
          style={({ pressed }) => [
            styles.profileCard,
            { backgroundColor: colors.surface, borderColor: colors.border },
            pressed && { opacity: 0.7 },
          ]}
          accessibilityRole="button"
          accessibilityLabel={t('profile.title')}
        >
          <Image
            source={{ uri: profile.avatarUri }}
            style={[styles.profileAvatar, { backgroundColor: colors.surfaceMuted }]}
            contentFit="cover"
          />
          <View style={styles.profileText}>
            <Text style={[styles.profileName, { color: colors.text }]} numberOfLines={1}>
              {profile.name}
            </Text>
            <Text style={[styles.profileUsername, { color: colors.textSecondary }]} numberOfLines={1}>
              {profile.username}
            </Text>
          </View>
          <Ionicons name="chevron-forward" size={20} color={colors.textMuted} />
        </Pressable>

        <Group title={t('settings.section_account')}>
          {/* The real number, not a placeholder. It is the one thing in this
              section the person cannot look up anywhere else in the app. */}
          <Row
            icon="call-outline"
            label={t('settings.phone')}
            value={phone || t('settings.phone_hidden')}
          />
          {/* No onPress: there is no email on an account yet, and a row that
              responds to a tap by doing nothing is worse than one that does
              not respond at all. */}
          <Row icon="mail-outline" label={t('settings.email')} value={t('settings.email_empty')} />
          <Row icon="trash-outline" label={t('settings.delete_account')} danger onPress={confirmDelete} last />
        </Group>

        <Group title={t('settings.section_privacy')}>
          <Row
            icon="eye-outline"
            label={t('settings.last_seen')}
            value={visibilityLabel(lastSeen)}
            onPress={() => pickVisibility(t('settings.last_seen'), lastSeen, setLastSeen, 'last_seen_visibility')}
          />
          <Row
            icon="image-outline"
            label={t('settings.profile_photo')}
            value={visibilityLabel(profilePhoto)}
            onPress={() => pickVisibility(t('settings.profile_photo'), profilePhoto, setProfilePhoto, 'photo_visibility')}
          />
          <Row
            icon="ban-outline"
            label={t('settings.blocked')}
            onPress={() => router.push('/blocked')}
          />
          <Row
            icon="checkmark-done-outline"
            label={t('settings.read_receipts')}
            value={readReceipts ? undefined : t('settings.read_receipts_off')}
            control={
              <Switch
                value={readReceipts}
                onValueChange={(v) => {
                  setReadReceipts(v);
                  savePrivacy({ read_receipts: v }, () => setReadReceipts(!v));
                }}
                trackColor={{ false: colors.border, true: colors.primary }}
                thumbColor="#FFFFFF"
              />
            }
            last
          />
        </Group>

        <Group title={t('settings.section_security')}>
          <Row
            icon="lock-closed-outline"
            label={t('app_lock.row')}
            value={appLock.enabled ? undefined : t('app_lock.off')}
            control={
              <Switch
                value={appLock.enabled}
                onValueChange={toggleAppLock}
                trackColor={{ false: colors.border, true: colors.primary }}
                thumbColor="#FFFFFF"
              />
            }
            last={!appLock.enabled}
          />
          {appLock.enabled ? (
            <>
              <Row
                icon="time-outline"
                label={t('app_lock.timeout')}
                value={timeoutLabel(appLock.timeoutMs)}
                onPress={pickTimeout}
              />
              {/* Only offered where the device has biometrics enrolled —
                  a switch that cannot do anything is worse than no switch. */}
              {bioAvailable ? (
                <Row
                  icon="finger-print-outline"
                  label={t('app_lock.biometrics')}
                  value={appLock.biometrics ? undefined : t('app_lock.off')}
                  control={
                    <Switch
                      value={appLock.biometrics}
                      onValueChange={(v) => void setAppLockBiometrics(v)}
                      trackColor={{ false: colors.border, true: colors.primary }}
                      thumbColor="#FFFFFF"
                    />
                  }
                  last
                />
              ) : (
                <Row
                  icon="finger-print-outline"
                  label={t('app_lock.biometrics')}
                  value={t('app_lock.biometrics_unavailable')}
                  last
                />
              )}
            </>
          ) : null}
        </Group>

        <Group title={t('settings.section_notifications')}>
          <Row
            icon="chatbubble-outline"
            label={t('settings.notif_messages')}
            control={
              <Switch
                value={notifMessages}
                onValueChange={(v) => saveNotif({ messages: v })}
                trackColor={{ false: colors.border, true: colors.primary }}
                thumbColor="#FFFFFF"
              />
            }
          />
          <Row
            icon="people-outline"
            label={t('settings.notif_groups')}
            control={
              <Switch
                value={notifGroups}
                onValueChange={(v) => saveNotif({ groups: v })}
                trackColor={{ false: colors.border, true: colors.primary }}
                thumbColor="#FFFFFF"
              />
            }
          />
          <Row
            icon="call-outline"
            label={t('settings.notif_calls')}
            control={
              <Switch
                value={notifCalls}
                onValueChange={(v) => saveNotif({ calls: v })}
                trackColor={{ false: colors.border, true: colors.primary }}
                thumbColor="#FFFFFF"
              />
            }
          />
          <Row
            icon="images-outline"
            label={t('settings.notif_stories')}
            control={
              <Switch
                value={notifStories}
                onValueChange={(v) => saveNotif({ stories: v })}
                trackColor={{ false: colors.border, true: colors.primary }}
                thumbColor="#FFFFFF"
              />
            }
            last
          />
        </Group>

        <Group title={t('settings.section_appearance')}>
          <Row
            icon="contrast-outline"
            label={t('settings.theme')}
            below={
              <View style={[styles.segment, { backgroundColor: colors.surfaceMuted }]}>
                {(['system', 'light', 'dark'] as SchemePreference[]).map((choice) => {
                  const active = schemePreference === choice;
                  return (
                    <Pressable
                      key={choice}
                      onPress={() => setSchemePreference(choice)}
                      style={[
                        styles.segmentItem,
                        active && {
                          backgroundColor: colors.surface,
                          borderColor: colors.border,
                        },
                      ]}
                      accessibilityRole="button"
                      accessibilityState={{ selected: active }}
                    >
                      <Text
                        style={[
                          styles.segmentText,
                          { color: active ? colors.text : colors.textSecondary },
                        ]}
                      >
                        {t(`settings.theme_${choice}`)}
                      </Text>
                    </Pressable>
                  );
                })}
              </View>
            }
          />
          <Row
            icon="color-palette-outline"
            label={t('settings.theme_marketplace')}
            value={activePack?.name ?? t('settings.theme_default')}
            onPress={() => router.push('/themes')}
          />
          <Row
            icon="brush-outline"
            label={t('settings.theme_customize')}
            value={t('settings.theme_customize_hint')}
            onPress={() => {
              const id = activePack?.id;
              if (id && activePack?.isOwned) {
                router.push({ pathname: '/themes/create', params: { edit: id } });
              } else if (id) {
                router.push({ pathname: '/themes/create', params: { fork: id } });
              } else {
                router.push('/themes/create');
              }
            }}
            last
          />
        </Group>

        <Group title={t('settings.section_help')}>
          <Row icon="help-circle-outline" label={t('settings.help_faq')} onPress={() => {}} />
          <Row icon="chatbox-ellipses-outline" label={t('settings.help_contact')} onPress={() => {}} last />
        </Group>

        <Group title={t('settings.section_about')}>
          <Row icon="information-circle-outline" label={t('settings.about_version')} value={APP_VERSION} />
          <Row
            icon="document-text-outline"
            label={t('settings.about_terms')}
            /* socialize.app has never existed, so this row opened a dead
               link. The policy is real and lives in the repository. */
            onPress={() =>
              Linking.openURL(
                'https://github.com/CreadorLanda/yo/blob/main/docs/security/privacy-policy.md',
              )
            }
            last
          />
        </Group>

        <Group title={t('settings.section_session')}>
          <Row
            icon="log-out-outline"
            label={t('settings.logout')}
            danger
            onPress={confirmLogout}
            last
          />
        </Group>
      </ScrollView>
    </SafeAreaView>
  );
}

function Group({ title, children }: { title: string; children: ReactNode }) {
  const { colors } = useTheme();
  return (
    <View style={styles.group}>
      <Text style={[styles.groupTitle, { color: colors.textSecondary }]}>{title}</Text>
      <View style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.border }]}>
        {children}
      </View>
    </View>
  );
}

function Row({
  icon,
  label,
  value,
  danger,
  onPress,
  control,
  below,
  last,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  value?: string;
  danger?: boolean;
  onPress?: () => void;
  control?: ReactNode;
  below?: ReactNode;
  last?: boolean;
}) {
  const { colors } = useTheme();
  const tint = danger ? colors.danger : colors.text;
  return (
    <Pressable
      onPress={onPress}
      disabled={!onPress}
      style={({ pressed }) => [
        styles.rowWrap,
        !last && { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.divider },
        pressed && onPress ? { backgroundColor: colors.surfaceMuted } : null,
      ]}
      accessibilityRole={onPress ? 'button' : undefined}
    >
      <View style={styles.row}>
        <Ionicons name={icon} size={21} color={danger ? colors.danger : colors.textSecondary} />
        <Text style={[styles.rowLabel, { color: tint }]} numberOfLines={1}>
          {label}
        </Text>
        {value ? (
          <Text style={[styles.rowValue, { color: colors.textSecondary }]} numberOfLines={1}>
            {value}
          </Text>
        ) : null}
        {control ?? (onPress && !danger ? (
          <Ionicons name="chevron-forward" size={18} color={colors.textMuted} />
        ) : null)}
      </View>
      {below ? <View style={styles.below}>{below}</View> : null}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1 },

  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: Spacing.sm,
    paddingVertical: Spacing.sm,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  backBtn: {
    width: 40,
    height: 40,
    borderRadius: Radii.pill,
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerTitle: { ...Typography.h3 },

  body: {
    padding: Spacing.lg,
    paddingBottom: Spacing.xxxl,
    gap: Spacing.xl,
  },

  profileCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.md,
    padding: Spacing.md,
    borderRadius: Radii.xl,
    borderWidth: 1,
  },
  profileAvatar: {
    width: 56,
    height: 56,
    borderRadius: Radii.pill,
  },
  profileText: { flex: 1, gap: 2 },
  profileName: { ...Typography.h3, fontSize: 17 },
  profileUsername: { ...Typography.caption },

  group: { gap: Spacing.sm },
  groupTitle: {
    ...Typography.micro,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 0.6,
    marginLeft: Spacing.md,
  },
  card: {
    borderRadius: Radii.lg,
    borderWidth: 1,
    overflow: 'hidden',
  },

  rowWrap: {
    paddingHorizontal: Spacing.md,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.md,
    minHeight: 52,
    paddingVertical: 10,
  },
  rowLabel: { ...Typography.body, flex: 1 },
  rowValue: { ...Typography.body, maxWidth: 170, textAlign: 'right' },
  below: {
    paddingLeft: 21 + Spacing.md,
    paddingBottom: Spacing.md,
    paddingTop: 2,
  },

  segment: {
    flexDirection: 'row',
    borderRadius: Radii.md,
    padding: 3,
    gap: 3,
  },
  segmentItem: {
    flex: 1,
    paddingVertical: 9,
    borderRadius: Radii.sm,
    borderWidth: 1,
    borderColor: 'transparent',
    alignItems: 'center',
  },
  segmentText: { ...Typography.caption, fontWeight: '600' },


});
