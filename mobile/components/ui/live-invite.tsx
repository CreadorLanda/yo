import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { router } from 'expo-router';
import { useEffect } from 'react';
import { Modal, Pressable, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Text } from '@/components/ui/text';
import { Radii, Spacing, Typography } from '@/constants/theme';
import { respondLive } from '@/data/api/lives';
import { dismissLiveInvite, useLiveInvite } from '@/data/live-room';
import { t } from '@/i18n';

/**
 * Invitations into a live, mounted once in the root layout like the ringing
 * screen.
 *
 * A joint live rings: the other person in the chat is being asked to host,
 * which is a call in all but name. "Not now" is recorded, but it is not a
 * refusal for good; the seat stays theirs and the chat shows the live running.
 *
 * An invitation to watch is a nudge, so it is a banner that goes away on its
 * own rather than a screen that takes over.
 */
export function LiveInviteHost() {
  const invite = useLiveInvite();

  useEffect(() => {
    if (!invite) return;
    if (invite.kind === 'cohost') {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning).catch(() => {});
      const beat = setInterval(() => {
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning).catch(() => {});
      }, 1800);
      return () => clearInterval(beat);
    }
    const gone = setTimeout(dismissLiveInvite, 12000);
    return () => clearTimeout(gone);
  }, [invite]);

  if (!invite) return null;
  const { live } = invite;
  const host = live.host_name || t('call.someone');

  const open = () => {
    dismissLiveInvite();
    router.push(`/live/${live.id}`);
  };

  if (invite.kind === 'watch') {
    return (
      <SafeAreaView style={styles.bannerWrap} edges={['top']} pointerEvents="box-none">
        <View style={styles.banner}>
          <View style={styles.bannerDot} />
          <Text style={styles.bannerText} numberOfLines={2}>
            {t('live.watch_invite', { name: invite.by || host })}
          </Text>
          <Pressable onPress={open} style={styles.bannerBtn} accessibilityRole="button">
            <Text style={styles.bannerBtnText}>{t('live.watch')}</Text>
          </Pressable>
          <Pressable
            onPress={dismissLiveInvite}
            hitSlop={10}
            accessibilityRole="button"
            accessibilityLabel={t('common.close')}
          >
            <Ionicons name="close" size={18} color="rgba(255,255,255,0.7)" />
          </Pressable>
        </View>
      </SafeAreaView>
    );
  }

  const notNow = () => {
    void respondLive(live.id, false).catch(() => {});
    dismissLiveInvite();
  };

  return (
    <Modal visible transparent animationType="fade" onRequestClose={notNow}>
      <SafeAreaView style={styles.screen} edges={['top', 'bottom']}>
        <View style={styles.who}>
          <View style={styles.ring}>
            <View style={styles.avatar}>
              <Text style={styles.initial}>{host.slice(0, 1).toUpperCase()}</Text>
            </View>
            <View style={styles.badge}>
              <Text style={styles.badgeText}>{t('live.badge')}</Text>
            </View>
          </View>
          <Text style={styles.name} numberOfLines={2}>
            {t('live.cohost_invite_title', { name: host })}
          </Text>
          {live.title ? (
            <Text style={styles.title} numberOfLines={2}>
              {live.title}
            </Text>
          ) : null}
          <Text style={styles.sub}>{t('live.cohost_invite_body')}</Text>
        </View>

        <View style={styles.actions}>
          <View style={styles.action}>
            <Pressable
              onPress={notNow}
              style={({ pressed }) => [styles.circle, styles.decline, pressed && styles.pressed]}
              accessibilityRole="button"
              accessibilityLabel={t('live.not_now')}
            >
              <Ionicons name="close" size={30} color="#FFFFFF" />
            </Pressable>
            <Text style={styles.actionLabel}>{t('live.not_now')}</Text>
          </View>
          <View style={styles.action}>
            <Pressable
              onPress={open}
              style={({ pressed }) => [styles.circle, styles.accept, pressed && styles.pressed]}
              accessibilityRole="button"
              accessibilityLabel={t('live.join')}
            >
              <Ionicons name="radio" size={28} color="#FFFFFF" />
            </Pressable>
            <Text style={styles.actionLabel}>{t('live.join')}</Text>
          </View>
        </View>
      </SafeAreaView>
    </Modal>
  );
}

const LIVE_RED = '#FE2C55';

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: '#0B0C10', justifyContent: 'space-between' },
  who: { alignItems: 'center', paddingTop: 96, paddingHorizontal: Spacing.xl, gap: Spacing.md },
  ring: {
    width: 148,
    height: 148,
    borderRadius: Radii.pill,
    borderWidth: 3,
    borderColor: LIVE_RED,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: Spacing.sm,
  },
  avatar: {
    width: 128,
    height: 128,
    borderRadius: Radii.pill,
    backgroundColor: '#1C1D24',
    alignItems: 'center',
    justifyContent: 'center',
  },
  initial: { fontSize: 52, fontWeight: '700', color: '#FFFFFF' },
  badge: {
    position: 'absolute',
    bottom: -10,
    backgroundColor: LIVE_RED,
    borderRadius: 6,
    paddingHorizontal: 8,
    paddingVertical: 2,
  },
  badgeText: { ...Typography.micro, color: '#FFFFFF', fontWeight: '800', letterSpacing: 0.5 },
  name: { ...Typography.h2, color: '#FFFFFF', textAlign: 'center' },
  title: { ...Typography.body, color: 'rgba(255,255,255,0.85)', textAlign: 'center' },
  sub: { ...Typography.callout, color: 'rgba(255,255,255,0.6)', textAlign: 'center' },
  actions: { flexDirection: 'row', justifyContent: 'space-evenly', paddingBottom: 72 },
  action: { alignItems: 'center', gap: Spacing.sm },
  circle: { width: 72, height: 72, borderRadius: Radii.pill, alignItems: 'center', justifyContent: 'center' },
  accept: { backgroundColor: LIVE_RED },
  decline: { backgroundColor: 'rgba(255,255,255,0.16)' },
  pressed: { opacity: 0.8 },
  actionLabel: { ...Typography.caption, color: 'rgba(255,255,255,0.7)' },

  bannerWrap: { position: 'absolute', top: 0, left: 0, right: 0 },
  banner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
    marginHorizontal: Spacing.md,
    marginTop: Spacing.sm,
    paddingLeft: Spacing.md,
    paddingRight: Spacing.sm,
    paddingVertical: Spacing.sm,
    borderRadius: Radii.lg,
    backgroundColor: 'rgba(17,18,24,0.96)',
  },
  bannerDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: LIVE_RED },
  bannerText: { ...Typography.callout, color: '#FFFFFF', flex: 1 },
  bannerBtn: {
    backgroundColor: LIVE_RED,
    borderRadius: Radii.pill,
    paddingHorizontal: Spacing.md,
    paddingVertical: 6,
  },
  bannerBtnText: { ...Typography.label, color: '#FFFFFF' },
});
