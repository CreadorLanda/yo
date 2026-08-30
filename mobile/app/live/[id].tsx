import { Ionicons } from '@expo/vector-icons';
import {
  AudioSession,
  LiveKitRoom,
  VideoTrack,
  registerGlobals,
  useLocalParticipant,
  useParticipants,
  useTracks,
} from '@livekit/react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { Track } from 'livekit-client';
import type { TrackReference } from '@livekit/react-native';
import { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Text } from '@/components/ui/text';
import { Radii, Spacing, Typography } from '@/constants/theme';
import {
  endLive,
  joinLive,
  leaveLive,
  startLive,
  type LiveGrant,
} from '@/data/api/lives';
import { appAlert } from '@/data/dialog-store';
import { useLiveViewers } from '@/data/live-store';
import { t } from '@/i18n';

registerGlobals();

/**
 * A live broadcast.
 *
 * Separate from the call screen because the shapes are different, not just the
 * styling: a call is a grid of peers who can all speak, a broadcast is one
 * stage and an audience that cannot. Forcing both through one screen would
 * mean a component whose every branch asks "am I allowed to be here".
 *
 * The permission is not this screen's to enforce. A viewer's token carries
 * `CanPublish: false` and the SFU refuses the track — this file only decides
 * which buttons to draw.
 *
 * Reached two ways:
 *   /live/new?chat=<id>     or ?channel=<id>  — start one
 *   /live/<liveId>                            — watch one
 */
export default function LiveScreen() {
  const { id, chat, channel, title } = useLocalSearchParams<{
    id: string;
    chat?: string;
    channel?: string;
    title?: string;
  }>();

  const [grant, setGrant] = useState<LiveGrant | null>(null);
  const [failure, setFailure] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const g =
          id === 'new'
            ? await startLive({ chatId: chat, channelId: channel, title })
            : await joinLive(id!);
        if (!cancelled) setGrant(g);
      } catch (err) {
        if (cancelled) return;
        // "Already live" is not a failure the person can do anything about by
        // retrying, and it reads very differently from "it broke".
        const already = err instanceof Error && /already_live/.test(err.message);
        setFailure(already ? t('live.already_live') : t('live.failed'));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [id, chat, channel, title]);

  // The audio session has to be running before the room connects, or the first
  // seconds arrive with nowhere to play.
  useEffect(() => {
    void AudioSession.startAudioSession();
    return () => {
      void AudioSession.stopAudioSession();
    };
  }, []);

  if (failure) {
    return (
      <SafeAreaView style={styles.screen}>
        <StatusBar style="light" />
        <View style={styles.center}>
          <Ionicons name="radio-outline" size={44} color="rgba(255,255,255,0.4)" />
          <Text style={styles.status}>{failure}</Text>
          <Pressable onPress={() => router.back()} hitSlop={10}>
            <Text style={styles.link}>{t('common.close')}</Text>
          </Pressable>
        </View>
      </SafeAreaView>
    );
  }

  if (!grant) {
    return (
      <SafeAreaView style={styles.screen}>
        <StatusBar style="light" />
        <View style={styles.center}>
          <ActivityIndicator color="#FFF" size="large" />
          <Text style={styles.status}>
            {id === 'new' ? t('live.starting') : t('live.connecting')}
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
      // The host publishes; the audience does not ask for a microphone it is
      // not allowed to use. Asking anyway would put a permission prompt in
      // front of someone who only wants to watch.
      audio={grant.host}
      video={grant.host}
      options={{ adaptiveStream: true, dynacast: true }}
      onError={() => setFailure(t('live.failed'))}
    >
      <Stage grant={grant} />
    </LiveKitRoom>
  );
}

/**
 * Everything inside the room.
 *
 * Split out because the LiveKit hooks only work under the provider — the outer
 * component cannot see participants or tracks at all.
 */
function Stage({ grant }: { grant: LiveGrant }) {
  const { localParticipant, isMicrophoneEnabled, isCameraEnabled } = useLocalParticipant();
  const participants = useParticipants();
  const liveId = grant.live.id;

  // The count comes from the server, which counts rows. Counting the
  // participants in the room would drift the moment someone's connection
  // hiccups, and would count the host as their own audience.
  const viewers = useLiveViewers(liveId, grant.live.viewers);

  const tracks = useTracks([{ source: Track.Source.Camera, withPlaceholder: false }], {
    onlySubscribed: false,
  });

  // The stage is whoever is publishing — the host. A placeholder has no
  // publication behind it and would render as a blank rectangle.
  const stage = tracks.find(
    (tr): tr is TrackReference =>
      tr.publication != null &&
      tr.publication.kind === Track.Kind.Video &&
      !tr.publication.isMuted,
  );

  const hostHere = grant.host || participants.some((p) => p.identity === grant.live.host_id);

  const left = useRef(false);
  const leave = useCallback(() => {
    if (!left.current) {
      left.current = true;
      // Never awaited: leaving must not wait on the network. Without it the
      // viewer count only ever grows.
      void leaveLive(liveId).catch(() => {});
    }
    router.back();
  }, [liveId]);

  // Every other way out — the back gesture, a notification, the system taking
  // the screen. The button is not the only exit.
  useEffect(
    () => () => {
      if (left.current) return;
      left.current = true;
      void leaveLive(liveId).catch(() => {});
    },
    [liveId],
  );

  const finish = () => {
    appAlert(t('live.end_title'), t('live.end_body'), [
      { text: t('common.cancel'), style: 'cancel' },
      {
        text: t('live.end_confirm'),
        style: 'destructive',
        onPress: () => {
          void endLive(liveId).catch(() => {});
          router.back();
        },
      },
    ]);
  };

  return (
    <SafeAreaView style={styles.screen} edges={['top', 'bottom']}>
      <StatusBar style="light" />

      <View style={styles.header}>
        <View style={styles.liveBadge}>
          <View style={styles.liveDot} />
          <Text style={styles.liveBadgeText}>{t('live.badge')}</Text>
        </View>
        <View style={styles.viewerPill}>
          <Ionicons name="eye" size={12} color="#FFF" />
          <Text style={styles.viewerText}>{viewers}</Text>
        </View>
        <View style={{ flex: 1 }} />
        <Pressable onPress={leave} hitSlop={10} style={styles.closeBtn}>
          <Ionicons name="close" size={22} color="#FFF" />
        </Pressable>
      </View>

      <View style={styles.stage}>
        {stage ? (
          <VideoTrack trackRef={stage} style={styles.video} objectFit="cover" />
        ) : (
          <View style={styles.center}>
            <Ionicons name="videocam-off-outline" size={40} color="rgba(255,255,255,0.35)" />
            <Text style={styles.status}>
              {/* Two different silences. The host has not turned the camera on;
                  a viewer is waiting for someone who may have walked away. */}
              {grant.host
                ? t('live.your_camera_is_off')
                : hostHere
                  ? t('live.host_camera_off')
                  : t('live.waiting_for_host')}
            </Text>
          </View>
        )}
      </View>

      <View style={styles.footer}>
        <Text style={styles.hostName} numberOfLines={1}>
          {grant.live.title || grant.live.host_name}
        </Text>

        {/* The promise the rest of the app makes, and where it stops.
            Everything else here is end-to-end encrypted; a broadcast cannot
            be, because an audience of strangers shares no session to derive a
            key from. Saying nothing would be the lie. */}
        <View style={styles.notice}>
          <Ionicons name="information-circle-outline" size={13} color="rgba(255,255,255,0.55)" />
          <Text style={styles.noticeText}>{t('live.not_e2ee')}</Text>
        </View>

        {grant.host ? (
          <View style={styles.controls}>
            <Ctrl
              icon={isMicrophoneEnabled ? 'mic' : 'mic-off'}
              danger={!isMicrophoneEnabled}
              label={isMicrophoneEnabled ? t('call.mute') : t('call.unmute')}
              onPress={() => {
                void localParticipant
                  .setMicrophoneEnabled(!isMicrophoneEnabled)
                  .catch(() => appAlert(t('live.mic_failed'), t('call.camera_permission')));
              }}
            />
            <Ctrl
              icon={isCameraEnabled ? 'videocam' : 'videocam-off'}
              label={isCameraEnabled ? t('hangout.cam_off') : t('hangout.cam_on')}
              onPress={() => {
                void localParticipant
                  .setCameraEnabled(!isCameraEnabled)
                  .catch(() =>
                    appAlert(t('call.camera_failed_title'), t('call.camera_permission')),
                  );
              }}
            />
            <Ctrl icon="stop" label={t('live.end')} danger onPress={finish} />
          </View>
        ) : null}
      </View>
    </SafeAreaView>
  );
}

function Ctrl({
  icon,
  label,
  danger,
  onPress,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  danger?: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable onPress={onPress} style={styles.ctrl} accessibilityRole="button">
      <View style={[styles.ctrlCircle, danger && styles.ctrlDanger]}>
        <Ionicons name={icon} size={20} color="#FFF" />
      </View>
      <Text style={styles.ctrlLabel}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: '#0B0C10' },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: Spacing.md },
  status: { ...Typography.body, color: 'rgba(255,255,255,0.75)', textAlign: 'center' },
  link: { ...Typography.bodyStrong, color: '#FFF' },

  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
    paddingHorizontal: Spacing.lg,
    paddingVertical: Spacing.md,
  },
  liveBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: '#EF4444',
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: Radii.pill,
  },
  liveDot: { width: 6, height: 6, borderRadius: 3, backgroundColor: '#FFF' },
  liveBadgeText: { ...Typography.micro, color: '#FFF', fontWeight: '700' },
  viewerPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    backgroundColor: 'rgba(255,255,255,0.14)',
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: Radii.pill,
  },
  viewerText: { ...Typography.micro, color: '#FFF' },
  closeBtn: {
    width: 34,
    height: 34,
    borderRadius: 17,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(255,255,255,0.12)',
  },

  stage: { flex: 1, backgroundColor: '#000', overflow: 'hidden' },
  video: { flex: 1 },

  footer: { paddingHorizontal: Spacing.lg, paddingTop: Spacing.md, gap: Spacing.sm },
  hostName: { ...Typography.h3, color: '#FFF' },
  notice: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  noticeText: { ...Typography.micro, color: 'rgba(255,255,255,0.55)', flex: 1 },

  controls: {
    flexDirection: 'row',
    justifyContent: 'space-around',
    paddingTop: Spacing.md,
    paddingBottom: Spacing.sm,
  },
  ctrl: { alignItems: 'center', gap: 6 },
  ctrlCircle: {
    width: 52,
    height: 52,
    borderRadius: 26,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(255,255,255,0.14)',
  },
  ctrlDanger: { backgroundColor: '#EF4444' },
  ctrlLabel: { ...Typography.micro, color: 'rgba(255,255,255,0.8)' },
});
