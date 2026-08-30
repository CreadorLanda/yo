import { Ionicons } from '@expo/vector-icons';
import { router, useLocalSearchParams } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import {
  AudioSession,
  LiveKitRoom,
  VideoTrack,
  registerGlobals,
  useLocalParticipant,
  useParticipants,
  useRoomContext,
  useTracks,
} from '@livekit/react-native';
import { Track } from 'livekit-client';
import type { TrackReference } from '@livekit/react-native';
import { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { PeoplePicker, type PickablePerson } from '@/components/ui/people-picker';
import { Text } from '@/components/ui/text';
import { Palette, Radii, Spacing, Typography } from '@/constants/theme';
import { callToken, hangupCall, inviteToCall, type CallGrant } from '@/data/api/calls';
import { RING_TIMEOUT_MS } from '@/data/incoming-call';
import { listChats } from '@/data/api/messages';
import { callKeyFingerprint, callKeyFor } from '@/data/crypto/call-key';
import { appAlert } from '@/data/dialog-store';
import { useTheme } from '@/hooks/use-theme';
import { t } from '@/i18n';

// WebRTC needs its globals installed before any of it is touched. Done at
// module load rather than inside the component: a re-render must not
// re-register, and the screen can be reached by deep link with nothing else
// mounted.
registerGlobals();

type Mode = 'voice' | 'video';

/**
 * A call.
 *
 * This screen used to simulate one — three setTimeouts walked it from
 * "calling" to "connected" and a face from `data/mock` sat in the middle. It
 * looked exactly like a working call and could not carry a second of audio.
 *
 * The real thing: the server signs a token saying this user may join the room
 * named after this chat, the SFU relays the media, and the streams are
 * encrypted with a key derived from the conversation's own E2EE session —
 * which the server never sees. See server/internal/modules/calls.
 */
export default function CallScreen() {
  const { id, mode, incoming } = useLocalSearchParams<{
    id: string;
    mode?: string;
    incoming?: string;
  }>();
  const callMode: Mode = mode === 'video' ? 'video' : 'voice';
  const { colors } = useTheme();

  const [grant, setGrant] = useState<CallGrant | null>(null);
  const [e2eeKey, setE2eeKey] = useState<string | null>(null);
  const [isGroup, setIsGroup] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);

  useEffect(() => {
    if (!id) return;
    let cancelled = false;

    (async () => {
      try {
        // Fetched now, not cached: the token lives five minutes and holding
        // one is holding a key to the room.
        // `incoming=1` means we are answering; anything else means we are
        // placing the call and the other phones should ring.
        const g = await callToken(id, { ring: incoming !== '1', mode: callMode });
        if (cancelled) return;
        setGrant(g);

        // The media key is derived from the pairwise session, so both sides
        // arrive at the same bytes without anything being transmitted. A
        // group has no single pairwise session; those calls run without the
        // extra layer until the key is derived from the group's sender key.
        const chat = (await listChats()).find((c) => c.id === id);
        if (!cancelled) setIsGroup(chat?.type === 'group');
        if (chat?.type !== 'group' && chat?.peer_user_id) {
          const key = await callKeyFor(id, chat.peer_user_id);
          if (!cancelled) setE2eeKey(key);
        }
      } catch {
        if (!cancelled) setFailure(t('call.failed_to_join'));
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [id, incoming, callMode]);

  // The audio session has to be running before the room connects, or the
  // first seconds arrive with nowhere to play.
  useEffect(() => {
    void AudioSession.startAudioSession();
    return () => {
      void AudioSession.stopAudioSession();
    };
  }, []);

  if (failure) {
    return (
      <SafeAreaView style={[styles.screen, { backgroundColor: colors.background }]}>
        <StatusBar style="light" />
        <View style={styles.center}>
          <Ionicons name="cloud-offline-outline" size={44} color={colors.textMuted} />
          <Text style={[styles.status, { color: colors.text }]}>{failure}</Text>
          <Pressable onPress={() => router.back()} hitSlop={10}>
            <Text style={[styles.link, { color: colors.primary }]}>{t('common.close')}</Text>
          </Pressable>
        </View>
      </SafeAreaView>
    );
  }

  if (!grant) {
    return (
      <SafeAreaView style={[styles.screen, { backgroundColor: colors.background }]}>
        <StatusBar style="light" />
        <View style={styles.center}>
          <ActivityIndicator color={colors.primary} size="large" />
          <Text style={[styles.status, { color: colors.textSecondary }]}>
            {t('call.connecting')}
          </Text>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <LiveKitRoom
      serverUrl={grant.url}
      token={grant.token}
      connect
      audio
      video={callMode === 'video'}
      options={{ adaptiveStream: true, dynacast: true }}
      {...(e2eeKey
        ? { e2ee: { keyProviderOptions: { sharedKey: e2eeKey } } as never }
        : {})}
      onError={() => setFailure(t('call.failed_to_join'))}
    >
      <CallStage
        chatId={id!}
        mode={callMode}
        e2eeKey={e2eeKey}
        isGroup={isGroup}
        onDropE2EE={() => setE2eeKey(null)}
      />
    </LiveKitRoom>
  );
}

/**
 * Everything inside the room.
 *
 * Split out because the LiveKit hooks only work under the provider — the
 * outer component cannot see participants or tracks at all.
 */
function CallStage({
  chatId,
  mode,
  e2eeKey,
  isGroup,
  onDropE2EE,
}: {
  chatId: string;
  mode: Mode;
  e2eeKey: string | null;
  isGroup: boolean;
  /**
   * Give up the derived media key.
   *
   * Required before a third person can hear anything: the key comes from a
   * session between two people, and nobody else has a share in it.
   */
  onDropE2EE: () => void;
}) {
  const { colors } = useTheme();
  const room = useRoomContext();
  const participants = useParticipants();
  const { localParticipant, isMicrophoneEnabled, isCameraEnabled } = useLocalParticipant();

  const tracks = useTracks(
    [
      { source: Track.Source.Camera, withPlaceholder: true },
      { source: Track.Source.ScreenShare, withPlaceholder: false },
    ],
    { onlySubscribed: false },
  );

  const others = participants.filter((p) => p.identity !== localParticipant.identity);

  const [seconds, setSeconds] = useState(0);
  const [connected, setConnected] = useState(false);
  const [adding, setAdding] = useState(false);
  const startedAt = useRef<number | null>(null);

  // A call is connected when someone else is in it, not when this phone
  // reaches the SFU.
  //
  // RoomEvent.Connected fires as soon as we join, which for the caller is
  // immediately — the other phone is still ringing. The screen showed a
  // running duration for a call nobody had answered.
  //
  // Joining early is right: the caller has to be in the room to be heard the
  // moment the other side arrives. What was wrong was calling that
  // "connected".
  const someoneElseHere = others.length > 0;
  useEffect(() => {
    if (!someoneElseHere || connected) return;
    setConnected(true);
    startedAt.current = Date.now();
  }, [someoneElseHere, connected]);

  // Timed from the wall clock, not by counting ticks. An interval that misses
  // a beat while the app is backgrounded would drift, and a call timer that
  // disagrees with the phone's is a small thing people notice.
  useEffect(() => {
    if (!connected) return;
    const tick = setInterval(() => {
      if (startedAt.current) setSeconds(Math.floor((Date.now() - startedAt.current) / 1000));
    }, 1000);
    return () => clearInterval(tick);
  }, [connected]);

  /**
   * Turn the camera on or off mid-call.
   *
   * A voice call starts without a video track at all, so turning the camera on
   * has to create and publish one — and that asks for a permission the call
   * never requested. It fails silently otherwise: the button flips back and
   * nothing explains why, which reads as the feature being broken rather than
   * as a permission being missing.
   */
  const toggleCamera = async () => {
    try {
      await localParticipant.setCameraEnabled(!isCameraEnabled);
    } catch (err) {
      appAlert(
        t('call.camera_failed_title'),
        err instanceof Error && /permission|denied/i.test(err.message)
          ? t('call.camera_permission')
          : t('call.camera_failed_body'),
      );
    }
  };

  /**
   * Leave the call.
   *
   * Disconnecting from the SFU used to be the whole of it, and the server was
   * never told — so the call ran on until the four-hour sweep. The report goes
   * first, because router.back() unmounts this screen and anything started
   * after it may never run.
   *
   * Not awaited: hanging up must not wait on the network, and the server
   * treats a repeat or a miss as a no-op. The sweep is still there for the
   * phone that dies mid-call.
   */
  const reported = useRef(false);
  const reportLeaving = useCallback(() => {
    if (reported.current) return;
    reported.current = true;
    void hangupCall(chatId).catch(() => {});
  }, [chatId]);

  const hangUp = useCallback(() => {
    reportLeaving();
    void room.disconnect();
    router.back();
  }, [reportLeaving, room]);

  // Every other way out: the back gesture, a notification, the system taking
  // the screen away. The button is not the only exit, and a call left by any
  // other door was still running as far as the server knew.
  useEffect(() => reportLeaving, [reportLeaving]);

  /**
   * Nobody came.
   *
   * The caller had no timeout at all: a call declined, ignored, or ringing a
   * phone that was switched off left them watching "waiting for others"
   * indefinitely. The other phone stops ringing after RING_TIMEOUT_MS, so
   * this is the same moment seen from the other end — one number for one
   * decision, rather than two that can disagree.
   */
  useEffect(() => {
    if (connected) return;
    const giveUp = setTimeout(() => {
      appAlert(t('call.no_answer_title'), t('call.no_answer_body'));
      hangUp();
    }, RING_TIMEOUT_MS);
    return () => clearTimeout(giveUp);
  }, [connected, hangUp]);

  /**
   * Everyone else left.
   *
   * The room does not close itself: the last person sat in an empty call
   * watching a timer count up, with no sign the other side had gone. Only
   * after connecting, or the caller would hang up on themselves in the second
   * before the callee answers.
   */
  useEffect(() => {
    if (!connected || others.length > 0) return;
    hangUp();
  }, [connected, others.length, hangUp]);

  // useTracks hands back placeholders for participants who have not published
  // yet — they have no publication at all. VideoTrack needs a real one, so the
  // narrowing is a type guard rather than a filter: a placeholder rendered as
  // a video is a blank tile with nothing behind it.
  const cameraTracks = tracks.filter(
    (tr): tr is TrackReference =>
      tr.publication != null &&
      tr.publication.kind === Track.Kind.Video &&
      !tr.publication.isMuted,
  );

  const inviteMore = async (people: PickablePerson[]) => {
    if (people.length === 0) return;

    // The cost of a third person, stated before it is paid.
    //
    // The media key is derived from the session between two people. A third
    // has no share in it and would hear silence — and dropping the key means
    // the SFU could read the streams, which is exactly what the key exists to
    // prevent. Doing that quietly, with the lock still showing, would be the
    // worst of the options.
    if (e2eeKey) {
      appAlert(t('call.drop_e2ee_title'), t('call.drop_e2ee_body'), [
        { text: t('common.cancel'), style: 'cancel' },
        {
          text: t('call.drop_e2ee_confirm'),
          style: 'destructive',
          onPress: () => {
            onDropE2EE();
            void doInvite(people);
          },
        },
      ]);
      return;
    }
    void doInvite(people);
  };

  const doInvite = async (people: PickablePerson[]) => {
    try {
      // The call's guest list, not the chat's. A one-to-one conversation stays
      // one-to-one; only the room grows.
      await inviteToCall(chatId, people.map((p) => p.id));
    } catch {
      appAlert(t('chats.action_failed_title'), t('call.invite_failed'));
    }
  };

  return (
    <SafeAreaView style={[styles.screen, { backgroundColor: '#0B0C10' }]} edges={['top', 'bottom']}>
      <StatusBar style="light" />

      <View style={styles.header}>
        <Text style={styles.peerName} numberOfLines={1}>
          {others.length === 0
            ? t('call.waiting_for_others')
            : others.length === 1
              ? others[0].name || others[0].identity
              : t('call.participants', { count: others.length + 1 })}
        </Text>
        <Text style={styles.timer}>
          {/*
            Three states, not two. "Connecting" is reaching the SFU; "calling"
            is being there alone while the other phone rings. Collapsing them
            told the caller they were in a call nobody had answered.
          */}
          {connected
            ? formatDuration(seconds)
            : room.state === 'connected'
              ? t('call.calling')
              : t('call.connecting')}
        </Text>
        {/*
          Shown, not assumed. The fingerprint is derived from the same key on
          both phones, so two people reading the same four bytes to each other
          is a check the server cannot fake.
        */}
        {e2eeKey ? (
          <View style={styles.e2eeBadge}>
            <Ionicons name="lock-closed" size={11} color={Palette.brand[300]} />
            <Text style={styles.e2eeText}>{callKeyFingerprint(e2eeKey)}</Text>
          </View>
        ) : null}
      </View>

      <View style={styles.stage}>
        {mode === 'video' && cameraTracks.length > 0 ? (
          <View style={styles.grid}>
            {cameraTracks.map((tr) => (
              <View key={tr.participant.identity + tr.source} style={styles.tile}>
                <VideoTrack trackRef={tr} style={styles.video} objectFit="cover" />
                <Text style={styles.tileName} numberOfLines={1}>
                  {tr.participant.name || tr.participant.identity}
                </Text>
              </View>
            ))}
          </View>
        ) : (
          <View style={styles.center}>
            <View style={[styles.avatarBig, { borderColor: colors.border }]}>
              <Ionicons name="person" size={54} color={colors.textMuted} />
            </View>
            <Text style={styles.status}>
              {connected
                ? t('call.audio_only')
                : room.state === 'connected'
                  ? t('call.calling')
                  : t('call.connecting')}
            </Text>
          </View>
        )}
      </View>

      <View style={styles.controls}>
        <CircleButton
          icon={isMicrophoneEnabled ? 'mic' : 'mic-off'}
          active={!isMicrophoneEnabled}
          label={t('call.mute')}
          onPress={() => void localParticipant.setMicrophoneEnabled(!isMicrophoneEnabled)}
        />
        <CircleButton
          icon={isCameraEnabled ? 'videocam' : 'videocam-off'}
          active={!isCameraEnabled}
          label={t('call.camera')}
          onPress={() => void toggleCamera()}
        />
        <CircleButton
          icon="person-add"
          label={t('call.add_people')}
          onPress={() => setAdding(true)}
        />
        <CircleButton icon="call" label={t('call.hang_up')} danger onPress={hangUp} />
      </View>

      <PeoplePicker
        visible={adding}
        title={t('call.add_people')}
        confirmLabel={t('common.done')}
        excludeIds={participants.map((p) => p.identity)}
        onClose={() => setAdding(false)}
        onConfirm={(people) => void inviteMore(people)}
      />
    </SafeAreaView>
  );
}

function CircleButton({
  icon,
  label,
  onPress,
  active,
  danger,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  onPress: () => void;
  active?: boolean;
  danger?: boolean;
}) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={label}
      style={({ pressed }) => [
        styles.circle,
        danger && styles.circleDanger,
        active && styles.circleActive,
        pressed && { opacity: 0.75 },
      ]}
    >
      <Ionicons
        name={icon}
        size={24}
        color={danger || active ? '#FFFFFF' : '#0B0C10'}
        style={danger ? { transform: [{ rotate: '135deg' }] } : undefined}
      />
    </Pressable>
  );
}

function formatDuration(sec: number): string {
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: Spacing.md },
  header: { alignItems: 'center', paddingTop: Spacing.lg, gap: 2 },
  peerName: { ...Typography.h2, color: '#FFFFFF' },
  timer: { ...Typography.caption, color: 'rgba(255,255,255,0.6)' },
  e2eeBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    marginTop: Spacing.xs,
    paddingHorizontal: Spacing.sm,
    paddingVertical: 3,
    borderRadius: Radii.pill,
    backgroundColor: 'rgba(255,255,255,0.08)',
  },
  e2eeText: { ...Typography.micro, color: Palette.brand[300], letterSpacing: 1 },
  stage: { flex: 1, padding: Spacing.md },
  grid: { flex: 1, flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.sm },
  tile: {
    flexGrow: 1,
    flexBasis: '45%',
    minHeight: 180,
    borderRadius: Radii.lg,
    overflow: 'hidden',
    backgroundColor: '#15161C',
  },
  video: { flex: 1 },
  tileName: {
    ...Typography.micro,
    color: '#FFFFFF',
    position: 'absolute',
    left: Spacing.sm,
    bottom: Spacing.sm,
  },
  avatarBig: {
    width: 128,
    height: 128,
    borderRadius: Radii.pill,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#15161C',
  },
  status: { ...Typography.body, color: 'rgba(255,255,255,0.7)' },
  link: { ...Typography.bodyStrong },
  controls: {
    flexDirection: 'row',
    justifyContent: 'center',
    gap: Spacing.lg,
    paddingBottom: Spacing.xl,
  },
  circle: {
    width: 58,
    height: 58,
    borderRadius: Radii.pill,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#FFFFFF',
  },
  circleActive: { backgroundColor: 'rgba(255,255,255,0.22)' },
  circleDanger: { backgroundColor: '#EF4444' },
});
