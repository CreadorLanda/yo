import { Ionicons } from '@expo/vector-icons';
import { router, useLocalSearchParams } from 'expo-router';
import {
  ExternalE2EEKeyProvider,
  Room,
  RoomEvent,
  type RoomOptions,
  Track,
  type RemoteParticipant,
} from 'livekit-client';
import { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Text } from '@/components/ui/text';
import { Palette, Radii, Spacing, Typography } from '@/constants/theme';
import { callToken, hangupCall } from '@/data/api/calls';
import { getCallSecurityState } from '@/data/call-security';
import { RING_TIMEOUT_MS } from '@/data/incoming-call';
import { listChats } from '@/data/api/messages';
import { callKeyFingerprint, callKeyFor } from '@/data/crypto/call-key';
import { appAlert } from '@/data/dialog-store';
import { useTheme } from '@/hooks/use-theme';
import { t } from '@/i18n';

/**
 * The call screen in a browser.
 *
 * `app/call/[id].tsx` is built on `@livekit/react-native`, which pulls in a
 * native WebRTC module, so the browser gets its own screen on plain
 * `livekit-client`. The flow is the same: ask the server for a token (which
 * rings the other side when we are the caller), derive the media key from the
 * conversation's E2EE session, join the room, hang up through the API.
 *
 * Not carried over: adding people mid-call, the Android keep-alive and the
 * audio session. None of them exist in a browser tab.
 *
 * The E2EE worker is a separate script the browser loads. It is copied into
 * `public/` by `scripts/copy-livekit-worker.js`, which `bun run web` runs.
 */
const E2EE_WORKER = '/livekit-e2ee-worker.js';

type Mode = 'voice' | 'video';

export default function CallScreen() {
  const { id, mode, incoming } = useLocalSearchParams<{
    id: string;
    mode?: string;
    incoming?: string;
  }>();
  const callMode: Mode = mode === 'video' ? 'video' : 'voice';
  const { colors } = useTheme();

  const roomRef = useRef<Room | null>(null);
  const reported = useRef(false);
  const remoteEl = useRef<HTMLDivElement | null>(null);
  const localEl = useRef<HTMLVideoElement | null>(null);

  const [state, setState] = useState<'joining' | 'waiting' | 'connected' | 'failed'>('joining');
  const [e2eeKey, setE2eeKey] = useState<string | null>(null);
  const [isGroup, setIsGroup] = useState(false);
  const [micOn, setMicOn] = useState(true);
  const [camOn, setCamOn] = useState(false);
  const [seconds, setSeconds] = useState(0);
  const startedAt = useRef<number | null>(null);

  // Told once, from whichever door the call is left by. The server treats a
  // repeat as a no-op, but one report is the honest number.
  const reportLeaving = useCallback(() => {
    if (reported.current || !id) return;
    reported.current = true;
    void hangupCall(id).catch(() => {});
  }, [id]);

  const hangUp = useCallback(() => {
    reportLeaving();
    void roomRef.current?.disconnect();
    router.back();
  }, [reportLeaving]);

  useEffect(() => {
    if (!id) return;
    let cancelled = false;
    // Remote media goes into the page as ordinary <video>/<audio> elements.
    const attach = (track: Track) => {
      if (!remoteEl.current) return;
      const el = track.attach();
      if (track.kind === Track.Kind.Video) {
        el.style.width = '100%';
        el.style.height = '100%';
        el.style.objectFit = 'cover';
      }
      remoteEl.current.appendChild(el);
    };
    const detach = (track: Track) => track.detach().forEach((el) => el.remove());

    const wire = (room: Room) => {
      room
        .on(RoomEvent.TrackSubscribed, (track) => attach(track))
        .on(RoomEvent.TrackUnsubscribed, (track) => detach(track))
        .on(RoomEvent.ParticipantConnected, () => {
          if (startedAt.current === null) startedAt.current = Date.now();
          setState('connected');
        })
        .on(RoomEvent.ParticipantDisconnected, () => {
          if (room.remoteParticipants.size === 0) hangUp();
        })
        .on(RoomEvent.Disconnected, () => {
          if (!cancelled) hangUp();
        });
    };

    (async () => {
      try {
        // Fetched now, not cached: the token lives five minutes.
        // `incoming=1` means we are answering; otherwise we place the call.
        const grant = await callToken(id, { ring: incoming !== '1', mode: callMode });
        if (cancelled) return;

        // Same rule as the native screen: a pairwise chat derives the media
        // key from its E2EE session, a group runs without the extra layer.
        const chat = (await listChats()).find((c) => c.id === id);
        if (cancelled) return;
        let key: string | null = null;
        if (chat?.type !== 'group' && chat?.peer_user_id) {
          key = await callKeyFor(id, chat.peer_user_id);
          if (cancelled) return;
        }
        setE2eeKey(key);
        setIsGroup(chat?.type === 'group');

        // The key has to be on the provider before connecting, or the first
        // frames would go out in the clear.
        let e2ee: RoomOptions['e2ee'];
        if (key) {
          const keyProvider = new ExternalE2EEKeyProvider();
          await keyProvider.setKey(key);
          e2ee = { keyProvider, worker: new Worker(E2EE_WORKER) };
        }
        const room = new Room({ adaptiveStream: true, dynacast: true, e2ee });
        roomRef.current = room;
        wire(room);
        await room.connect(grant.url, grant.token);
        if (key) await room.setE2EEEnabled(true);
        await finishJoin(room);
      } catch {
        if (!cancelled) setState('failed');
      }
    })();

    async function finishJoin(active: Room) {
      if (cancelled) return;
      await active.localParticipant.setMicrophoneEnabled(true);
      // The camera starts off, as on the phone: the person turns it on, where
      // a failure is caught and explained.
      active.remoteParticipants.forEach((p: RemoteParticipant) => {
        p.trackPublications.forEach((pub) => {
          if (pub.track) attach(pub.track);
        });
      });
      setState(active.remoteParticipants.size > 0 ? 'connected' : 'waiting');
      if (active.remoteParticipants.size > 0 && startedAt.current === null) {
        startedAt.current = Date.now();
      }
    }

    return () => {
      cancelled = true;
      reportLeaving();
      void roomRef.current?.disconnect();
    };
  }, [id, incoming, callMode, hangUp, reportLeaving]);

  // Nobody came: the same moment the other phone stops ringing.
  useEffect(() => {
    if (state === 'connected' || state === 'failed') return;
    const giveUp = setTimeout(() => {
      appAlert(t('call.no_answer_title'), t('call.no_answer_body'));
      hangUp();
    }, RING_TIMEOUT_MS);
    return () => clearTimeout(giveUp);
  }, [state, hangUp]);

  useEffect(() => {
    if (state !== 'connected') return;
    const tick = setInterval(() => {
      if (startedAt.current) setSeconds(Math.floor((Date.now() - startedAt.current) / 1000));
    }, 1000);
    return () => clearInterval(tick);
  }, [state]);

  const toggleMic = async () => {
    const next = !micOn;
    await roomRef.current?.localParticipant.setMicrophoneEnabled(next);
    setMicOn(next);
  };

  const toggleCamera = async () => {
    const next = !camOn;
    try {
      await roomRef.current?.localParticipant.setCameraEnabled(next);
      setCamOn(next);
      const pub = roomRef.current?.localParticipant.getTrackPublication(Track.Source.Camera);
      if (next && pub?.track && localEl.current) pub.track.attach(localEl.current);
    } catch {
      appAlert(t('call.camera_failed_title'), t('call.camera_failed_body'));
    }
  };

  if (state === 'failed') {
    return (
      <SafeAreaView style={[styles.screen, { backgroundColor: colors.background }]}>
        <View style={styles.center}>
          <Ionicons name="cloud-offline-outline" size={44} color={colors.textMuted} />
          <Text style={[styles.status, { color: colors.text }]}>{t('call.failed_to_join')}</Text>
          <Pressable onPress={() => router.back()} hitSlop={10}>
            <Text style={[styles.link, { color: colors.primary }]}>{t('common.close')}</Text>
          </Pressable>
        </View>
      </SafeAreaView>
    );
  }

  const security = getCallSecurityState(isGroup, e2eeKey);
  const clock = `${String(Math.floor(seconds / 60)).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`;
  const caption =
    state === 'connected'
      ? clock
      : state === 'joining'
        ? t('call.connecting')
        : t('call.waiting_for_others');

  return (
    <SafeAreaView style={[styles.screen, { backgroundColor: '#0B0B10' }]}>
      {/* Remote media lands here; plain DOM, appended by the room listeners. */}
      <div ref={remoteEl} style={remoteStyle} />

      {state === 'joining' ? (
        <View style={styles.center} pointerEvents="none">
          <ActivityIndicator color={colors.primary} size="large" />
        </View>
      ) : null}

      <View style={styles.top} pointerEvents="none">
        <Text style={styles.title}>
          {callMode === 'video' ? t('call.video_call') : t('call.voice_call')}
        </Text>
        <Text style={styles.caption}>{caption}</Text>
        {security === 'encrypted' && e2eeKey ? (
          <View style={styles.badge}>
            <Ionicons name="lock-closed" size={12} color={Palette.brand[300]} />
            <Text style={styles.badgeText}>{callKeyFingerprint(e2eeKey)}</Text>
          </View>
        ) : (
          <View style={styles.badge}>
            <Ionicons name="warning-outline" size={12} color="#FFFFFF" />
            <Text style={styles.badgeText}>
              {isGroup ? t('call.group_not_e2ee_title') : t('call.not_e2ee_title')}
            </Text>
          </View>
        )}
      </View>

      <video
        ref={localEl}
        muted
        autoPlay
        playsInline
        style={{ ...localStyle, display: camOn ? 'block' : 'none' }}
      />

      <View style={styles.controls}>
        <RoundButton
          icon={micOn ? 'mic' : 'mic-off'}
          label={t('call.mute')}
          active={!micOn}
          onPress={toggleMic}
        />
        <RoundButton
          icon={camOn ? 'videocam' : 'videocam-off'}
          label={t('call.camera')}
          active={!camOn}
          onPress={toggleCamera}
        />
        <RoundButton icon="call" label={t('call.end')} danger onPress={hangUp} />
      </View>
    </SafeAreaView>
  );
}

function RoundButton({
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
      style={[
        styles.round,
        { backgroundColor: danger ? '#E5484D' : active ? '#FFFFFF' : 'rgba(255,255,255,0.16)' },
      ]}
    >
      <Ionicons name={icon} size={26} color={active && !danger ? '#0B0B10' : '#FFFFFF'} />
    </Pressable>
  );
}

const remoteStyle = {
  position: 'absolute' as const,
  inset: 0,
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
};

const localStyle = {
  position: 'absolute' as const,
  right: 16,
  bottom: 140,
  width: 120,
  height: 160,
  objectFit: 'cover' as const,
  borderRadius: 12,
  background: '#000',
  transform: 'scaleX(-1)',
};

const styles = StyleSheet.create({
  screen: { flex: 1 },
  center: { ...StyleSheet.absoluteFillObject, alignItems: 'center', justifyContent: 'center', gap: Spacing.md },
  status: { ...Typography.body },
  link: { ...Typography.bodyStrong },
  top: { alignItems: 'center', paddingTop: Spacing.xl, gap: Spacing.xs },
  title: { ...Typography.h3, color: '#FFFFFF' },
  caption: { ...Typography.callout, color: 'rgba(255,255,255,0.75)' },
  badge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginTop: Spacing.sm,
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.xs,
    borderRadius: Radii.pill,
    backgroundColor: 'rgba(255,255,255,0.12)',
  },
  badgeText: { ...Typography.micro, color: '#FFFFFF', letterSpacing: 1 },
  controls: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: Spacing.xxl,
    flexDirection: 'row',
    justifyContent: 'center',
    gap: Spacing.lg,
  },
  round: {
    width: 64,
    height: 64,
    borderRadius: 32,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
