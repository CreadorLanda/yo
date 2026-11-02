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
import { Track, type LocalVideoTrack } from 'livekit-client';
import { isTrackReference, type TrackReferenceOrPlaceholder } from '@livekit/react-native';
import { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Platform, Pressable, StyleSheet, View, type LayoutChangeEvent } from 'react-native';
import Animated, { FadeIn, FadeOut } from 'react-native-reanimated';
import { SafeAreaView } from 'react-native-safe-area-context';

import {
  CallAvatar,
  PictureInPicture,
  RoundControl,
  type Corner,
} from '@/components/call/call-ui';
import { PeoplePicker, type PickablePerson } from '@/components/ui/people-picker';
import { startCallKeepAlive, stopCallKeepAlive } from '@/modules/call-keepalive';
import { Text } from '@/components/ui/text';
import { Palette, Radii, Spacing, Typography } from '@/constants/theme';
import { callToken, hangupCall, inviteToCall, type CallGrant } from '@/data/api/calls';
import { getCallSecurityState } from '@/data/call-security';
import { RING_TIMEOUT_MS } from '@/data/incoming-call';
import { listChats } from '@/data/api/messages';
import { callKeyFingerprint, callKeyFor } from '@/data/crypto/call-key';
import { appAlert } from '@/data/dialog-store';
import { availableMedia, type AvailableMedia } from '@/data/media-devices';
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
  const [media, setMedia] = useState<AvailableMedia>({ camera: false, microphone: true });

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

        // Join with the microphone that exists. The camera is never started
        // here: an emulator may advertise one that fails when WebRTC opens it,
        // which crashed the call screen. Video calls begin with the camera off
        // and the person turns it on, where a failure is caught and explained.
        const devices = await availableMedia();
        if (cancelled) return;
        setMedia(devices);

        // The media key is derived from the pairwise session, so both sides
        // arrive at the same bytes without anything being transmitted. A
        // group has no single pairwise session; those calls run without the
        // extra layer until the key is derived from the group's sender key.
        const chat = (await listChats()).find((c) => c.id === id);
        if (cancelled) return;
        if (chat?.type !== 'group' && chat?.peer_user_id) {
          const key = await callKeyFor(id, chat.peer_user_id);
          if (cancelled) return;
          setE2eeKey(key);
        }
        // Don't connect the media room until the call type and encryption
        // state are known. Otherwise a group call briefly starts without
        // showing that the SFU can access its streams.
        setIsGroup(chat?.type === 'group');
        setGrant(g);
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
  //
  // The keep-alive goes up with it and comes down with it, because the two
  // answer the same question from opposite ends: LiveKit's session routes the
  // audio, and this stops the OS from taking the process away mid-call. On
  // Android that is a foreground service; on iOS it is holding the
  // AVAudioSession active. Without it, pressing home silenced the call and
  // then ended it, and nothing here noticed — see #160.
  useEffect(() => {
    void AudioSession.startAudioSession();
    startCallKeepAlive({
      video: callMode === 'video',
      title: t('call.ongoing_title'),
      body: t('call.ongoing_body'),
    });
    return () => {
      stopCallKeepAlive();
      void AudioSession.stopAudioSession();
    };
  }, [callMode]);

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
      audio={media.microphone}
      video={false}
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

  // Looks: who fills the screen, where the small picture rests, whether the
  // controls are showing, and the speaker and lens choices.
  const [swapped, setSwapped] = useState(false);
  const [corner, setCorner] = useState<Corner>('br');
  const [area, setArea] = useState({ w: 0, h: 0 });
  const [chrome, setChrome] = useState(true);
  const [speakerOn, setSpeakerOn] = useState(mode === 'video');
  const [facing, setFacing] = useState<'user' | 'environment'>('user');

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
  // yet. They have no publication, so they cannot be drawn as video: they
  // become an avatar tile instead of a blank rectangle.
  const cameraTiles = tracks.filter((tr) => tr.source === Track.Source.Camera);
  const hasVideo = (tr: TrackReferenceOrPlaceholder) =>
    isTrackReference(tr) && tr.publication.kind === Track.Kind.Video && !tr.publication.isMuted;
  const localTile = cameraTiles.find((tr) => tr.participant.isLocal);
  const remoteTiles = cameraTiles.filter((tr) => !tr.participant.isLocal);
  const localVideoOn = !!localTile && hasVideo(localTile);

  const callSecurity = getCallSecurityState(isGroup, e2eeKey);
  useEffect(() => {
    if (!localVideoOn && swapped) setSwapped(false);
  }, [localVideoOn, swapped]);

  // The controls fade away on a video call so the picture gets the screen,
  // and come back on a tap. A voice call keeps them: there is no picture.
  const video = mode === 'video';
  useEffect(() => {
    if (!video || !connected || !chrome) return;
    const hide = setTimeout(() => setChrome(false), 5000);
    return () => clearTimeout(hide);
  }, [video, connected, chrome]);
  const showChrome = !video || !connected || chrome;

  // Video calls start on the speaker, voice calls at the ear, as on a phone.
  const route = useCallback(async (speaker: boolean) => {
    try {
      const outputs = await AudioSession.getAudioOutputs();
      const pick = Platform.OS === 'ios'
        ? (speaker ? 'force_speaker' : 'default')
        : (speaker ? 'speaker' : 'earpiece');
      if (outputs.includes(pick)) await AudioSession.selectAudioOutput(pick);
    } catch {
      // No routing control on this device: the call keeps its default.
    }
  }, []);
  useEffect(() => {
    void route(mode === 'video');
  }, [route, mode]);

  const toggleSpeaker = () => {
    const next = !speakerOn;
    setSpeakerOn(next);
    void route(next);
  };

  const flipCamera = async () => {
    const next = facing === 'user' ? 'environment' : 'user';
    try {
      const pub = localParticipant.getTrackPublication(Track.Source.Camera);
      await (pub?.track as LocalVideoTrack | undefined)?.restartTrack({ facingMode: next });
      setFacing(next);
    } catch {
      appAlert(t('call.camera_failed_title'), t('call.camera_failed_body'));
    }
  };

  const onStageLayout = (e: LayoutChangeEvent) =>
    setArea({ w: e.nativeEvent.layout.width, h: e.nativeEvent.layout.height });

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

  const peerName =
    others.length === 0
      ? t('call.waiting_for_others')
      : others.length === 1
        ? others[0].name || others[0].identity
        : t('call.participants', { count: others.length + 1 });
  const status = connected
    ? formatDuration(seconds)
    : room.state === 'connected'
      ? mode === 'video'
        ? t('call.ringing')
        : t('call.calling')
      : t('call.connecting');

  // One person is the big picture. With one other person and the camera on,
  // you are the small picture and a tap swaps the two.
  const one = remoteTiles.length === 1;
  const mainTile = one ? (swapped && localVideoOn ? localTile : remoteTiles[0]) : undefined;
  const pipTile = one && localVideoOn ? (swapped ? remoteTiles[0] : localTile) : undefined;
  const grid = video && remoteTiles.length > 1;
  const headerH = callSecurity === 'encrypted' ? 96 : 150;
  const reserve = { top: headerH, bottom: showChrome ? 150 : 24 };

  return (
    <View style={[styles.screen, { backgroundColor: '#0B0C10' }]}>
      <StatusBar style="light" />

      {/* The picture. Everything else floats over it. */}
      <Pressable
        style={StyleSheet.absoluteFill}
        onPress={() => video && connected && setChrome((v) => !v)}
        onLayout={onStageLayout}
        accessibilityLabel={peerName}
      >
        {grid ? (
          <View style={styles.grid}>
            {[...remoteTiles, ...(localVideoOn && localTile ? [localTile] : [])].map((tr) => (
              <View key={tr.participant.identity + tr.source} style={styles.tile}>
                {hasVideo(tr) && isTrackReference(tr) ? (
                  <VideoTrack trackRef={tr} style={StyleSheet.absoluteFillObject} objectFit="cover" />
                ) : (
                  <View style={styles.tileEmpty}>
                    <CallAvatar name={tr.participant.name || tr.participant.identity} size={72} />
                  </View>
                )}
                <View style={styles.tileName}>
                  {!tr.participant.isMicrophoneEnabled ? (
                    <Ionicons name="mic-off" size={12} color="#FFFFFF" />
                  ) : null}
                  <Text style={styles.tileNameText} numberOfLines={1}>
                    {tr.participant.isLocal ? t('hangout.you') : tr.participant.name || tr.participant.identity}
                  </Text>
                </View>
              </View>
            ))}
          </View>
        ) : mainTile && hasVideo(mainTile) && isTrackReference(mainTile) ? (
          <VideoTrack trackRef={mainTile} style={StyleSheet.absoluteFillObject} objectFit="cover" />
        ) : !one && video && localVideoOn && localTile && isTrackReference(localTile) ? (
          // Calling: your own camera until the other person answers.
          <VideoTrack trackRef={localTile} style={StyleSheet.absoluteFillObject} objectFit="cover" />
        ) : (
          <View style={styles.center}>
            <CallAvatar name={others[0]?.name || others[0]?.identity || peerName} size={132} />
            <Text style={styles.status}>
              {connected ? (video ? t('call.camera_off_peer') : t('call.audio_only')) : status}
            </Text>
          </View>
        )}
      </Pressable>

      {/* Scrims, so white text reads over any picture. */}
      <View style={[styles.scrim, styles.scrimTop]} pointerEvents="none" />
      {showChrome ? <View style={[styles.scrim, styles.scrimBottom]} pointerEvents="none" /> : null}

      {pipTile && area.w > 0 ? (
        <PictureInPicture
          area={area}
          reserve={reserve}
          corner={corner}
          onCorner={setCorner}
          onPress={() => setSwapped((v) => !v)}
        >
          {hasVideo(pipTile) && isTrackReference(pipTile) ? (
            <VideoTrack
              trackRef={pipTile}
              style={StyleSheet.absoluteFillObject}
              objectFit="cover"
              mirror={pipTile.participant.isLocal && facing === 'user'}
            />
          ) : (
            <View style={styles.tileEmpty}>
              <CallAvatar name={pipTile.participant.name || pipTile.participant.identity} size={48} />
            </View>
          )}
        </PictureInPicture>
      ) : null}

      <SafeAreaView style={styles.chrome} edges={['top', 'bottom']} pointerEvents="box-none">
        {showChrome ? (
          <Animated.View entering={FadeIn.duration(180)} exiting={FadeOut.duration(180)} style={styles.header}>
            <View style={styles.headerText}>
              <Text style={styles.peerName} numberOfLines={1}>
                {peerName}
              </Text>
              {/* Three states, not two. "Connecting" is reaching the SFU;
                  "calling" is being there alone while the other phone
                  rings. Collapsing them told the caller they were in a call
                  nobody had answered. */}
              <Text style={styles.timer}>{status}</Text>
              {callSecurity === 'encrypted' && e2eeKey ? (
                // Shown, not assumed. The fingerprint comes from the same key
                // on both phones, so two people reading it to each other is a
                // check the server cannot fake.
                <Pressable
                  onPress={() => appAlert(t('call.encrypted'), callKeyFingerprint(e2eeKey))}
                  style={styles.lockRow}
                  accessibilityRole="button"
                  accessibilityLabel={t('call.encrypted')}
                >
                  <Ionicons name="lock-closed" size={11} color="rgba(255,255,255,0.8)" />
                  <Text style={styles.lockText}>{t('call.encrypted')}</Text>
                </Pressable>
              ) : null}
            </View>
            <Pressable
              onPress={() => setAdding(true)}
              hitSlop={10}
              style={styles.headerBtn}
              accessibilityRole="button"
              accessibilityLabel={t('call.add_people')}
            >
              <Ionicons name="person-add" size={20} color="#FFFFFF" />
            </Pressable>
          </Animated.View>
        ) : (
          <View />
        )}

        {showChrome && callSecurity !== 'encrypted' ? (
          <View style={styles.e2eeWarning} accessibilityRole="alert" accessibilityLiveRegion="polite">
            <Ionicons name="warning-outline" size={16} color={Palette.semantic.warning} />
            <View style={styles.e2eeWarningCopy}>
              <Text style={styles.e2eeWarningTitle}>
                {callSecurity === 'group-unencrypted'
                  ? t('call.group_not_e2ee_title')
                  : t('call.not_e2ee_title')}
              </Text>
              <Text style={styles.e2eeWarningBody}>{t('call.not_e2ee_body')}</Text>
            </View>
          </View>
        ) : null}

        <View style={{ flex: 1 }} pointerEvents="none" />

        {showChrome ? (
          <Animated.View entering={FadeIn.duration(180)} exiting={FadeOut.duration(180)} style={styles.panel}>
            <RoundControl
              icon={speakerOn ? 'volume-high' : 'volume-medium'}
              active={speakerOn}
              label={t('call.speaker')}
              onPress={toggleSpeaker}
            />
            <RoundControl
              icon={isCameraEnabled ? 'videocam' : 'videocam-off'}
              active={!isCameraEnabled}
              label={t('call.camera')}
              onPress={() => void toggleCamera()}
            />
            <RoundControl
              icon={isMicrophoneEnabled ? 'mic' : 'mic-off'}
              active={!isMicrophoneEnabled}
              label={t('call.mute')}
              onPress={() => void localParticipant.setMicrophoneEnabled(!isMicrophoneEnabled)}
            />
            {isCameraEnabled ? (
              <RoundControl icon="camera-reverse" label={t('call.flip_camera')} onPress={() => void flipCamera()} />
            ) : null}
            <RoundControl icon="call" label={t('call.hang_up')} danger onPress={hangUp} />
          </Animated.View>
        ) : null}
      </SafeAreaView>

      <PeoplePicker
        visible={adding}
        title={t('call.add_people')}
        confirmLabel={t('common.done')}
        excludeIds={participants.map((p) => p.identity)}
        onClose={() => setAdding(false)}
        onConfirm={(people) => void inviteMore(people)}
      />
    </View>
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
  chrome: { flex: 1 },
  scrim: { position: 'absolute', left: 0, right: 0 },
  scrimTop: { top: 0, height: 170, backgroundColor: 'rgba(0,0,0,0.28)' },
  scrimBottom: { bottom: 0, height: 240, backgroundColor: 'rgba(0,0,0,0.3)' },
  header: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    paddingHorizontal: Spacing.lg,
    paddingTop: Spacing.md,
    gap: Spacing.md,
  },
  headerText: { flex: 1, gap: 2 },
  peerName: { ...Typography.h2, color: '#FFFFFF' },
  timer: { ...Typography.callout, color: 'rgba(255,255,255,0.8)', fontVariant: ['tabular-nums'] },
  lockRow: { flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 2 },
  lockText: { ...Typography.micro, color: 'rgba(255,255,255,0.8)' },
  headerBtn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(0,0,0,0.3)',
  },
  e2eeWarning: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: Spacing.sm,
    marginTop: Spacing.sm,
    marginHorizontal: Spacing.lg,
    padding: Spacing.sm,
    borderRadius: Radii.md,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: Palette.semantic.warning,
    backgroundColor: 'rgba(245,158,11,0.16)',
  },
  e2eeWarningCopy: { flex: 1, gap: 2 },
  e2eeWarningTitle: { ...Typography.caption, color: '#FFFFFF' },
  e2eeWarningBody: { ...Typography.micro, color: 'rgba(255,255,255,0.8)' },
  grid: { flex: 1, flexDirection: 'row', flexWrap: 'wrap', backgroundColor: '#0B0C10' },
  tile: { width: '50%', height: '50%', backgroundColor: '#15161C', overflow: 'hidden' },
  tileEmpty: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: '#1B1C22' },
  tileName: {
    position: 'absolute',
    left: Spacing.sm,
    bottom: Spacing.sm,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: Spacing.sm,
    paddingVertical: 2,
    borderRadius: Radii.pill,
    backgroundColor: 'rgba(0,0,0,0.45)',
  },
  tileNameText: { ...Typography.micro, color: '#FFFFFF' },
  status: { ...Typography.body, color: 'rgba(255,255,255,0.75)' },
  link: { ...Typography.bodyStrong },
  panel: {
    flexDirection: 'row',
    justifyContent: 'center',
    gap: Spacing.md,
    marginHorizontal: Spacing.md,
    marginBottom: Spacing.sm,
    paddingVertical: Spacing.md,
    paddingHorizontal: Spacing.lg,
    borderRadius: Radii.xxl,
    backgroundColor: 'rgba(24,25,31,0.88)',
  },
});
