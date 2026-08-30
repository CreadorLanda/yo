import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { router } from 'expo-router';
import { useEffect } from 'react';
import { Modal, Pressable, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Text } from '@/components/ui/text';
import { Radii, Spacing, Typography } from '@/constants/theme';
import { declineCall } from '@/data/api/calls';
import { dismissIncoming, useIncomingCall } from '@/data/incoming-call';
import { t } from '@/i18n';

/**
 * The ringing screen.
 *
 * Mounted once in the root layout, like the dialog host: a call arrives while
 * whatever screen happens to be on top, and it has to cover it. Before this,
 * the `call.incoming` event reached the app and nothing listened — the call
 * existed on the server and the other phone stayed silent.
 *
 * Answering routes with `incoming=1`, which is what stops this phone asking
 * the server to ring everyone all over again.
 */
export function IncomingCallHost() {
  const call = useIncomingCall();

  // A pulse rather than a ringtone. A sound needs an audio session, which
  // would fight the one the call screen starts a moment later.
  useEffect(() => {
    if (!call) return;
    const beat = setInterval(() => {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning).catch(() => {});
    }, 1800);
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning).catch(() => {});
    return () => clearInterval(beat);
  }, [call]);

  if (!call) return null;

  const answer = () => {
    const { chatId, mode } = call;
    dismissIncoming();
    router.push(`/call/${chatId}?mode=${mode}&incoming=1`);
  };

  /**
   * Say no, out loud.
   *
   * The button only closed this screen. `declineCall` existed and nothing
   * called it, so no refusal was ever recorded — eight participations in
   * production, not one of them declined. Every "no" read as "missed", and
   * the caller waited out the full ring for someone who had already answered.
   *
   * Not awaited: refusing must not wait on the network, and the screen closing
   * is the part the person is looking at.
   */
  const decline = () => {
    const { chatId } = call;
    void declineCall(chatId).catch(() => {});
    dismissIncoming();
  };

  return (
    <Modal visible transparent animationType="fade" onRequestClose={decline}>
      <SafeAreaView style={styles.screen} edges={['top', 'bottom']}>
        <View style={styles.who}>
          <View style={styles.avatar}>
            <Ionicons name="person" size={48} color="rgba(255,255,255,0.5)" />
          </View>
          <Text style={styles.name} numberOfLines={1}>
            {call.callerName || t('call.someone')}
          </Text>
          <Text style={styles.sub}>
            {call.mode === 'video' ? t('call.incoming_video') : t('call.incoming_voice')}
          </Text>
        </View>

        <View style={styles.actions}>
          <View style={styles.action}>
            <Pressable
              onPress={decline}
              style={({ pressed }) => [styles.circle, styles.decline, pressed && styles.pressed]}
              accessibilityRole="button"
              accessibilityLabel={t('call.decline')}
            >
              <Ionicons
                name="call"
                size={28}
                color="#FFFFFF"
                style={{ transform: [{ rotate: '135deg' }] }}
              />
            </Pressable>
            <Text style={styles.actionLabel}>{t('call.decline')}</Text>
          </View>

          <View style={styles.action}>
            <Pressable
              onPress={answer}
              style={({ pressed }) => [styles.circle, styles.accept, pressed && styles.pressed]}
              accessibilityRole="button"
              accessibilityLabel={t('call.answer')}
            >
              <Ionicons name="call" size={28} color="#FFFFFF" />
            </Pressable>
            <Text style={styles.actionLabel}>{t('call.answer')}</Text>
          </View>
        </View>
      </SafeAreaView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: '#0B0C10', justifyContent: 'space-between' },
  who: { alignItems: 'center', paddingTop: 96, gap: Spacing.md },
  avatar: {
    width: 132,
    height: 132,
    borderRadius: Radii.pill,
    backgroundColor: '#15161C',
    alignItems: 'center',
    justifyContent: 'center',
  },
  name: { ...Typography.h1, color: '#FFFFFF' },
  sub: { ...Typography.body, color: 'rgba(255,255,255,0.6)' },
  actions: {
    flexDirection: 'row',
    justifyContent: 'space-evenly',
    paddingBottom: 72,
  },
  action: { alignItems: 'center', gap: Spacing.sm },
  circle: { width: 72, height: 72, borderRadius: Radii.pill, alignItems: 'center', justifyContent: 'center' },
  accept: { backgroundColor: '#22C55E' },
  decline: { backgroundColor: '#EF4444' },
  pressed: { opacity: 0.8 },
  actionLabel: { ...Typography.caption, color: 'rgba(255,255,255,0.7)' },
});
