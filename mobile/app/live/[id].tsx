import { Ionicons } from '@expo/vector-icons';
import {
  AudioSession,
  isTrackReference,
  LiveKitRoom,
  VideoTrack,
  registerGlobals,
  useDataChannel,
  useLocalParticipant,
  useTracks,
  type TrackReferenceOrPlaceholder,
} from '@livekit/react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { Track } from 'livekit-client';
import { useCameraPermission, useMicrophonePermission } from 'react-native-vision-camera';
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  AppState,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  StyleSheet,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import {
  CommentStream,
  HeartLayer,
  Initial,
  LIVE_RED,
  type FloatingHeart,
} from '@/components/live/live-overlay';
import { formatDuration, LiveToolsSheet, Stat } from '@/components/live/live-tools-sheet';
import { Text, TextInput } from '@/components/ui/text';
import { Radii, Spacing, Typography } from '@/constants/theme';
import {
  banFromLive,
  deleteLiveComment,
  endLive,
  joinLive,
  leaveLive,
  leaveStage,
  liveDetails,
  liveStats,
  postLiveComment,
  requestStage,
  respondLive,
  sendLiveHearts,
  startOrJoinLive,
  type LiveAudience,
  type LiveComment,
  type LiveGrant,
  type LiveStats,
} from '@/data/api/lives';
import { getCurrentUser } from '@/data/auth-store';
import { appAlert } from '@/data/dialog-store';
import { addOwnComment, closeRoom, openRoom, patchRoom, useLiveRoom } from '@/data/live-room';
import { refreshRunningLives, useLiveViewers } from '@/data/live-store';
import { t } from '@/i18n';

registerGlobals();

/**
 * A live broadcast, laid out the way people already know from TikTok: the
 * video takes the whole screen, who is live and how many are watching sit on
 * top, comments rise from the bottom left, and a heart floats up on the right.
 *
 * Everything else stays out of the way. A viewer sees a comment box, a heart
 * and a hand to ask to speak. A host adds the microphone and camera. The
 * moderation tools (people, stage, stats, settings) are behind a single
 * button that only moderators have.
 *
 * What someone may do is not this screen's to enforce: the token says whether
 * they may publish, and every tool is checked again by the server. This file
 * decides which buttons to draw.
 *
 * Reached two ways:
 *   /live/new?chat=<id> | ?channel=<id> | (neither, from Stories)
 *             &audience=…&viewers=a,b&title=…   start one (see /live/setup)
 *   /live/<liveId>                              watch or rejoin one
 */
export default function LiveScreen() {
  const { id, chat, channel, title, audience, viewers } = useLocalSearchParams<{
    id: string;
    chat?: string;
    channel?: string;
    title?: string;
    audience?: string;
    viewers?: string;
  }>();

  const [grant, setGrant] = useState<LiveGrant | null>(null);
  const [failure, setFailure] = useState<string | null>(null);
  const [hostMedia, setHostMedia] = useState({ camera: true, microphone: true });
  const [connectionNotice, setConnectionNotice] = useState<string | null>(null);
  const [backgrounded, setBackgrounded] = useState(
    AppState.currentState === 'background' || AppState.currentState === 'inactive',
  );
  const { hasPermission: hasCamera, requestPermission: requestCamera } = useCameraPermission();
  const { hasPermission: hasMicrophone, requestPermission: requestMicrophone } =
    useMicrophonePermission();
  const mediaPermission = useRef({ camera: !!hasCamera, microphone: !!hasMicrophone });

  useEffect(() => {
    mediaPermission.current = { camera: !!hasCamera, microphone: !!hasMicrophone };
  }, [hasCamera, hasMicrophone]);

  const requestHostMedia = useCallback(async () => {
    const camera =
      mediaPermission.current.camera || (await requestCamera().catch(() => false));
    const microphone =
      mediaPermission.current.microphone || (await requestMicrophone().catch(() => false));
    mediaPermission.current = { camera, microphone };
    return { camera, microphone };
  }, [requestCamera, requestMicrophone]);

  /** A guest called on stage needs the microphone, and only then. */
  const askMicrophone = useCallback(async () => {
    const ok = mediaPermission.current.microphone || (await requestMicrophone().catch(() => false));
    mediaPermission.current = { ...mediaPermission.current, microphone: ok };
    return ok;
  }, [requestMicrophone]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        let media = { camera: true, microphone: true };
        // Ask before creating a new broadcast. A denied permission must not
        // leave an orphaned server-side live while the prompt is on screen.
        if (id === 'new') media = await requestHostMedia();
        if (cancelled) return;

        const g =
          id === 'new'
            ? await startOrJoinLive({
                chatId: chat,
                channelId: channel,
                title,
                audience: audience as LiveAudience | undefined,
                viewerIds: viewers ? viewers.split(',').filter(Boolean) : undefined,
              })
            : await joinLive(id!);

        // A host returning to an existing room needs the same media state;
        // viewers never receive either permission prompt.
        if (g.host && id !== 'new') media = await requestHostMedia();

        const details = await liveDetails(g.live.id).catch(() => null);
        if (cancelled) {
          void (g.host ? endLive(g.live.id) : leaveLive(g.live.id)).catch(() => {});
          return;
        }
        openRoom(
          details ?? {
            live: g.live,
            members: [],
            role: g.role ?? (g.host ? 'host' : 'viewer'),
            moderator: !!g.moderator,
            comments: [],
          },
        );
        setHostMedia(media);
        setGrant(details ? { ...g, role: details.role, moderator: details.moderator } : g);
        // The host is left out of live.started. Refreshing keeps the Stories
        // rail truthful the moment they go live.
        void refreshRunningLives();
      } catch (err) {
        if (cancelled) return;
        const msg = err instanceof Error ? err.message : '';
        setFailure(
          /banned/.test(msg)
            ? t('live.you_were_banned')
            : /already_live/.test(msg)
              ? t('live.already_live')
              : t('live.failed'),
        );
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [id, chat, channel, title, audience, viewers, requestHostMedia]);

  useEffect(() => () => closeRoom(), []);

  useEffect(() => {
    const sub = AppState.addEventListener('change', (state) => setBackgrounded(state !== 'active'));
    return () => sub.remove();
  }, []);

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
      // Hosts start with the microphone and the camera off: an emulator
      // advertises a camera that fails to open, and opening it here took the
      // whole screen down. The camera button turns it on and explains a
      // failure. The audience never asks for either.
      audio={grant.host && hostMedia.microphone}
      video={false}
      options={{ adaptiveStream: true, dynacast: true }}
      onConnected={() => setConnectionNotice(null)}
      onDisconnected={() => setConnectionNotice(t('live.reconnecting'))}
      onError={() => setConnectionNotice(t('live.reconnecting'))}
    >
      <Stage
        grant={grant}
        hostMedia={hostMedia}
        askMicrophone={askMicrophone}
        notice={
          backgrounded
            ? t('live.backgrounded')
            : connectionNotice ??
              (grant.host && !hostMedia.microphone ? t('live.microphone_denied') : null)
        }
      />
    </LiveKitRoom>
  );
}

/**
 * Everything inside the room. Split out because the LiveKit hooks only work
 * under the provider.
 */
function Stage({
  grant,
  hostMedia,
  askMicrophone,
  notice,
}: {
  grant: LiveGrant;
  hostMedia: { camera: boolean; microphone: boolean };
  askMicrophone: () => Promise<boolean>;
  notice: string | null;
}) {
  const room = useLiveRoom();
  const me = getCurrentUser()?.id;
  const live = grant.live;
  const liveId = live.id;
  const { localParticipant, isMicrophoneEnabled, isCameraEnabled } = useLocalParticipant();

  // The count is the server's, counted from rows.
  const viewers = useLiveViewers(liveId, live.viewers);

  const isHost = grant.host;
  const meMember = room.members.find((m) => m.user_id === me);
  const moderator = !!grant.moderator || !!meMember?.moderator;
  const onStage = room.myStage === 'on';
  const publisher = isHost || onStage;

  // ── who is on screen ──
  // Everyone allowed to publish gets a tile, camera or not: a guest who is
  // only talking still needs a face on the stage.
  const tracks = useTracks([{ source: Track.Source.Camera, withPlaceholder: true }], {
    onlySubscribed: false,
  });
  const tiles = tracks.filter((tr) => tr.participant.permissions?.canPublish);

  // ── hearts ──
  const [hearts, setHearts] = useState<FloatingHeart[]>([]);
  const heartSeq = useRef(0);
  const pendingHearts = useRef(0);
  const floatHeart = useCallback(() => {
    const h = { id: ++heartSeq.current, drift: (Math.random() - 0.5) * 50 };
    setHearts((prev) => [...prev.slice(-24), h]);
  }, []);
  const { send } = useDataChannel('hearts', floatHeart);
  const heart = () => {
    floatHeart();
    pendingHearts.current += 1;
    void send(new Uint8Array([1]), { reliable: false }).catch(() => {});
  };
  // The count goes to the server in batches; the animation already travelled.
  useEffect(() => {
    const flush = setInterval(() => {
      const n = Math.min(50, pendingHearts.current);
      if (!n) return;
      pendingHearts.current -= n;
      void sendLiveHearts(liveId, n).catch(() => {});
    }, 3000);
    return () => clearInterval(flush);
  }, [liveId]);
  const lastTap = useRef(0);
  const tapStage = () => {
    const now = Date.now();
    if (now - lastTap.current < 280) heart();
    lastTap.current = now;
  };

  // ── stage: becoming a guest, or stopping being one ──
  useEffect(() => {
    if (isHost) return;
    if (onStage) {
      void askMicrophone().then((ok) => {
        if (ok) void localParticipant.setMicrophoneEnabled(true).catch(() => {});
      });
    } else {
      void localParticipant.setMicrophoneEnabled(false).catch(() => {});
      void localParticipant.setCameraEnabled(false).catch(() => {});
    }
  }, [onStage, isHost, localParticipant, askMicrophone]);

  const toggleHand = () => {
    if (room.myStage === 'requested' || onStage) {
      patchRoom({ myStage: undefined });
      void leaveStage(liveId).catch(() => {});
    } else {
      patchRoom({ myStage: 'requested' });
      void requestStage(liveId).catch(() => patchRoom({ myStage: undefined }));
    }
  };

  const answerStage = (accept: boolean) => {
    patchRoom({ myStage: accept ? 'on' : undefined, stageInviteBy: undefined });
    void respondLive(liveId, accept).catch(() => patchRoom({ myStage: undefined }));
  };

  // ── leaving, ending ──
  const [summary, setSummary] = useState<LiveStats | null>(null);
  const ending = useRef(false);
  const left = useRef(false);
  const reportLeaving = useCallback(() => {
    if (left.current) return;
    left.current = true;
    void leaveLive(liveId).catch(() => {});
  }, [liveId]);
  useEffect(() => reportLeaving, [reportLeaving]);

  const leave = () => {
    reportLeaving();
    router.back();
  };

  const finish = () => {
    appAlert(t('live.end_title'), t('live.end_body'), [
      { text: t('common.cancel'), style: 'cancel' },
      {
        text: t('live.end_confirm'),
        style: 'destructive',
        // Leave only once the server confirms: a request that failed would
        // otherwise drop the host out of a broadcast that is still on air.
        onPress: async () => {
          if (ending.current) return;
          ending.current = true;
          try {
            await endLive(liveId);
            await refreshRunningLives();
          } catch {
            ending.current = false;
            appAlert(t('live.end_title'), t('live.end_failed'));
            return;
          }
          const stats = await liveStats(liveId).catch(() => null);
          if (stats) setSummary(stats);
          else router.back();
        },
      },
    ]);
  };

  useEffect(() => {
    if (!room.banned) return;
    appAlert(t('live.you_were_banned'), '');
    router.back();
  }, [room.banned]);

  // A co-host ending it, or the sweeper: hosts see the numbers, viewers a note.
  useEffect(() => {
    if (!room.ended || summary) return;
    if (isHost || moderator) {
      void liveStats(liveId).then(setSummary).catch(() => {});
    }
  }, [room.ended, summary, isHost, moderator, liveId]);

  // ── comments ──
  const [draft, setDraft] = useState('');
  const canComment = room.commentsEnabled || moderator;
  const submit = () => {
    const body = draft.trim();
    if (!body) return;
    setDraft('');
    postLiveComment(liveId, body)
      .then(addOwnComment)
      .catch((err) => {
        setDraft(body);
        appAlert(
          err instanceof Error && /comments_off/.test(err.message)
            ? t('live.comments_off')
            : t('live.action_failed'),
          '',
        );
      });
  };

  const commentMenu = (c: LiveComment) => {
    const mine = c.user_id === me;
    if (!mine && !moderator) return;
    appAlert(c.name || t('call.someone'), c.body, [
      {
        text: t('live.delete_comment'),
        style: 'destructive',
        onPress: () => void deleteLiveComment(liveId, c.id).catch(() => {}),
      },
      ...(moderator && !mine
        ? [
            {
              text: t('live.ban'),
              style: 'destructive' as const,
              onPress: () => void banFromLive(liveId, c.user_id).catch(() => {}),
            },
          ]
        : []),
      { text: t('common.cancel'), style: 'cancel' as const },
    ]);
  };

  // ── top bar ──
  const cohosts = room.members.filter((m) => m.cohost);
  const hosts = [live.host_name, ...cohosts.map((m) => m.name)].filter(Boolean).join(' & ');
  const [elapsed, setElapsed] = useState(0);
  useEffect(() => {
    if (!isHost) return;
    const started = new Date(live.started_at).getTime();
    const tick = () => setElapsed(Math.max(0, Math.floor((Date.now() - started) / 1000)));
    tick();
    const every = setInterval(tick, 1000);
    return () => clearInterval(every);
  }, [isHost, live.started_at]);

  const [tools, setTools] = useState(false);
  const requests = room.members.filter((m) => m.stage === 'requested').length;

  if (summary) return <Summary stats={summary} title={live.title || hosts} />;

  if (room.ended && !isHost && !moderator) {
    return (
      <SafeAreaView style={styles.screen}>
        <View style={styles.center}>
          <Ionicons name="radio-outline" size={44} color="rgba(255,255,255,0.4)" />
          <Text style={styles.status}>{t('live.ended_already')}</Text>
          <Pressable onPress={leave} hitSlop={10}>
            <Text style={styles.link}>{t('common.close')}</Text>
          </Pressable>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <View style={styles.screen}>
      <StatusBar style="light" />

      {/* The video, edge to edge. Double tap sends a heart. */}
      <Pressable style={StyleSheet.absoluteFill} onPress={tapStage}>
        <Tiles tiles={tiles} hostName={live.host_name} isHost={isHost} />
      </Pressable>

      {/* Scrims so white text reads over any picture. */}
      <View style={[styles.scrim, styles.scrimTop]} pointerEvents="none" />
      <View style={[styles.scrim, styles.scrimBottom]} pointerEvents="none" />

      <SafeAreaView style={styles.chrome} edges={['top', 'bottom']} pointerEvents="box-none">
        <View style={styles.topBar}>
          <View style={styles.hostPill}>
            <Initial name={live.host_name} size={34} />
            <View style={{ flexShrink: 1 }}>
              <Text style={styles.hostName} numberOfLines={1}>
                {hosts}
              </Text>
              <Text style={styles.hostSub} numberOfLines={1}>
                {live.title || (live.joint ? t('live.joint') : t('live.badge'))}
              </Text>
            </View>
          </View>
          <View style={{ flex: 1 }} />
          <Pressable
            onPress={() => moderator && setTools(true)}
            style={styles.countPill}
            accessibilityRole={moderator ? 'button' : undefined}
          >
            <View style={styles.liveDot} />
            <Ionicons name="eye" size={13} color="#FFF" />
            <Text style={styles.countText}>{viewers}</Text>
          </Pressable>
          <Pressable
            onPress={isHost ? finish : leave}
            hitSlop={10}
            style={styles.closeBtn}
            accessibilityRole="button"
            accessibilityLabel={isHost ? t('live.end') : t('common.close')}
          >
            <Ionicons name="close" size={22} color="#FFF" />
          </Pressable>
        </View>

        <View style={styles.subBar}>
          {isHost ? (
            <View style={styles.smallPill}>
              <Text style={styles.smallPillText}>{formatDuration(elapsed)}</Text>
            </View>
          ) : null}
          {notice ? (
            <View style={styles.smallPill}>
              <Ionicons name="warning-outline" size={12} color="#FBBF24" />
              <Text style={styles.smallPillText} numberOfLines={1}>
                {notice}
              </Text>
            </View>
          ) : null}
        </View>

        {room.myStage === 'invited' ? (
          <View style={styles.inviteBanner}>
            <Ionicons name="mic" size={18} color="#FFF" />
            <Text style={styles.inviteText} numberOfLines={2}>
              {t('live.stage_invited', { name: room.stageInviteBy || t('call.someone') })}
            </Text>
            <Pressable onPress={() => answerStage(false)} style={styles.inviteBtn}>
              <Text style={styles.inviteBtnText}>{t('live.not_now')}</Text>
            </Pressable>
            <Pressable onPress={() => answerStage(true)} style={[styles.inviteBtn, { backgroundColor: LIVE_RED }]}>
              <Text style={styles.inviteBtnText}>{t('live.accept')}</Text>
            </Pressable>
          </View>
        ) : null}

        <View style={{ flex: 1 }} pointerEvents="none" />

        <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
          <View style={styles.lower}>
            <View style={styles.commentsCol}>
              <CommentStream comments={room.comments} note={t('live.not_e2ee')} onLongPress={commentMenu} />
            </View>
            <View style={styles.rail}>
              {moderator ? (
                <RailBtn icon="people" label={t('live.tools')} badge={requests} onPress={() => setTools(true)} />
              ) : null}
              {publisher ? (
                <>
                  <RailBtn
                    icon={isMicrophoneEnabled ? 'mic' : 'mic-off'}
                    label={isMicrophoneEnabled ? t('call.mute') : t('call.unmute')}
                    off={!isMicrophoneEnabled}
                    onPress={() => {
                      void localParticipant
                        .setMicrophoneEnabled(!isMicrophoneEnabled)
                        .catch(() => appAlert(t('live.mic_failed'), t('call.camera_permission')));
                    }}
                  />
                  <RailBtn
                    icon={isCameraEnabled ? 'videocam' : 'videocam-off'}
                    label={t('call.camera')}
                    off={!isCameraEnabled}
                    onPress={() => {
                      if (!isCameraEnabled && isHost && !hostMedia.camera) {
                        appAlert(t('call.camera_failed_title'), t('live.camera_denied'));
                        return;
                      }
                      void localParticipant
                        .setCameraEnabled(!isCameraEnabled)
                        .catch(() => appAlert(t('call.camera_failed_title'), t('call.camera_failed_body')));
                    }}
                  />
                </>
              ) : null}
              {!isHost ? (
                <RailBtn
                  icon={onStage ? 'exit-outline' : room.myStage === 'requested' ? 'hand-left' : 'hand-left-outline'}
                  label={
                    onStage
                      ? t('live.leave_stage')
                      : room.myStage === 'requested'
                        ? t('live.cancel_request')
                        : t('live.ask_to_speak')
                  }
                  active={room.myStage === 'requested'}
                  onPress={toggleHand}
                />
              ) : null}
            </View>
          </View>

          <View style={styles.bottomBar}>
            <TextInput
              value={draft}
              onChangeText={setDraft}
              editable={canComment}
              placeholder={canComment ? t('live.comment_placeholder') : t('live.comments_off')}
              placeholderTextColor="rgba(255,255,255,0.6)"
              maxLength={300}
              returnKeyType="send"
              onSubmitEditing={submit}
              blurOnSubmit={false}
              style={styles.input}
            />
            <View>
              <HeartLayer hearts={hearts} onDone={(hid) => setHearts((prev) => prev.filter((h) => h.id !== hid))} />
              <Pressable onPress={heart} style={styles.heartBtn} accessibilityRole="button" accessibilityLabel="♥">
                <Ionicons name="heart" size={24} color="#FFF" />
              </Pressable>
            </View>
          </View>
        </KeyboardAvoidingView>
      </SafeAreaView>

      {moderator ? (
        <LiveToolsSheet
          visible={tools}
          onClose={() => setTools(false)}
          liveId={liveId}
          isHost={isHost}
          members={room.members}
          commentsEnabled={room.commentsEnabled}
        />
      ) : null}
    </View>
  );
}

/**
 * The stage. One person fills the screen; two split it top and bottom (a
 * joint live, or a host with one guest); three or four share a grid.
 */
function Tiles({
  tiles,
  hostName,
  isHost,
}: {
  tiles: TrackReferenceOrPlaceholder[];
  hostName: string;
  isHost: boolean;
}) {
  if (tiles.length === 0) {
    return (
      <View style={[styles.tile, styles.center]}>
        <Initial name={hostName} size={96} />
        <Text style={styles.status}>{isHost ? t('live.your_camera_is_off') : t('live.waiting_for_host')}</Text>
      </View>
    );
  }
  const shown = tiles.slice(0, 4);
  const grid = shown.length > 2;
  return (
    <View style={[styles.tiles, grid && styles.grid]}>
      {shown.map((tr) => {
        const video = isTrackReference(tr) && !tr.publication.isMuted;
        const name = tr.participant.name || '';
        return (
          <View
            key={`${tr.participant.identity}:${tr.source}`}
            style={[styles.tile, grid ? styles.gridTile : { flex: 1 }]}
          >
            {video ? (
              <VideoTrack trackRef={tr} style={StyleSheet.absoluteFillObject} objectFit="cover" />
            ) : (
              <View style={styles.center}>
                <Initial name={name} size={shown.length === 1 ? 96 : 64} />
              </View>
            )}
            {shown.length > 1 ? (
              <View style={styles.tileName}>
                <Text style={styles.tileNameText} numberOfLines={1}>
                  {name}
                </Text>
              </View>
            ) : null}
          </View>
        );
      })}
    </View>
  );
}

function RailBtn({
  icon,
  label,
  onPress,
  badge,
  off,
  active,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  onPress: () => void;
  badge?: number;
  off?: boolean;
  active?: boolean;
}) {
  return (
    <Pressable onPress={onPress} style={styles.railItem} accessibilityRole="button" accessibilityLabel={label}>
      <View style={[styles.railCircle, off && styles.railOff, active && { backgroundColor: LIVE_RED }]}>
        <Ionicons name={icon} size={22} color="#FFF" />
        {badge ? (
          <View style={styles.railBadge}>
            <Text style={styles.railBadgeText}>{badge}</Text>
          </View>
        ) : null}
      </View>
    </Pressable>
  );
}

/** What the host sees when it is over: the numbers worth keeping. */
function Summary({ stats, title }: { stats: LiveStats; title: string }) {
  return (
    <SafeAreaView style={styles.screen}>
      <StatusBar style="light" />
      <View style={styles.summary}>
        <View style={styles.summaryBadge}>
          <Text style={styles.summaryBadgeText}>{t('live.summary_title')}</Text>
        </View>
        <Text style={styles.summaryHeading} numberOfLines={2}>
          {title}
        </Text>
        <Text style={styles.status}>{formatDuration(stats.duration_seconds)}</Text>
        <View style={styles.summaryGrid}>
          <Stat icon="people" value={stats.unique_viewers} label={t('live.stat_unique')} />
          <Stat icon="trending-up" value={stats.peak_viewers} label={t('live.stat_peak')} />
          <Stat icon="heart" value={stats.hearts} label={t('live.stat_hearts')} />
          <Stat icon="chatbubble" value={stats.comments} label={t('live.stat_comments')} />
        </View>
      </View>
      <Pressable onPress={() => router.back()} style={styles.summaryClose}>
        <Text style={styles.summaryCloseText}>{t('common.done')}</Text>
      </Pressable>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: '#000' },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: Spacing.md },
  status: { ...Typography.body, color: 'rgba(255,255,255,0.75)', textAlign: 'center' },
  link: { ...Typography.bodyStrong, color: '#FFF' },

  tiles: { flex: 1, backgroundColor: '#0B0C10' },
  grid: { flexDirection: 'row', flexWrap: 'wrap' },
  tile: { backgroundColor: '#111218', overflow: 'hidden' },
  gridTile: { width: '50%', height: '50%' },
  tileName: {
    position: 'absolute',
    left: Spacing.sm,
    bottom: Spacing.sm,
    paddingHorizontal: Spacing.sm,
    paddingVertical: 2,
    borderRadius: Radii.pill,
    backgroundColor: 'rgba(0,0,0,0.45)',
  },
  tileNameText: { ...Typography.micro, color: '#FFF' },

  scrim: { position: 'absolute', left: 0, right: 0 },
  scrimTop: { top: 0, height: 140, backgroundColor: 'rgba(0,0,0,0.22)' },
  scrimBottom: { bottom: 0, height: 300, backgroundColor: 'rgba(0,0,0,0.22)' },

  chrome: { flex: 1 },
  topBar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
    paddingHorizontal: Spacing.md,
    paddingTop: Spacing.sm,
  },
  hostPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
    maxWidth: '62%',
    paddingLeft: 3,
    paddingRight: Spacing.md,
    paddingVertical: 3,
    borderRadius: Radii.pill,
    backgroundColor: 'rgba(0,0,0,0.35)',
  },
  hostName: { ...Typography.label, color: '#FFF' },
  hostSub: { ...Typography.micro, color: 'rgba(255,255,255,0.7)' },
  countPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    height: 32,
    paddingHorizontal: Spacing.md,
    borderRadius: Radii.pill,
    backgroundColor: 'rgba(0,0,0,0.35)',
  },
  liveDot: { width: 7, height: 7, borderRadius: 4, backgroundColor: LIVE_RED },
  countText: { ...Typography.label, color: '#FFF', fontVariant: ['tabular-nums'] },
  closeBtn: {
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(0,0,0,0.35)',
  },
  subBar: { flexDirection: 'row', gap: Spacing.xs, paddingHorizontal: Spacing.md, paddingTop: Spacing.sm },
  smallPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    maxWidth: '80%',
    paddingHorizontal: Spacing.sm,
    paddingVertical: 3,
    borderRadius: Radii.pill,
    backgroundColor: 'rgba(0,0,0,0.35)',
  },
  smallPillText: { ...Typography.micro, color: '#FFF', fontVariant: ['tabular-nums'] },

  inviteBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
    margin: Spacing.md,
    padding: Spacing.sm,
    paddingLeft: Spacing.md,
    borderRadius: Radii.lg,
    backgroundColor: 'rgba(17,18,24,0.94)',
  },
  inviteText: { ...Typography.callout, color: '#FFF', flex: 1 },
  inviteBtn: {
    paddingHorizontal: Spacing.md,
    paddingVertical: 6,
    borderRadius: Radii.pill,
    backgroundColor: 'rgba(255,255,255,0.14)',
  },
  inviteBtnText: { ...Typography.label, color: '#FFF' },

  lower: { flexDirection: 'row', alignItems: 'flex-end', paddingHorizontal: Spacing.md, gap: Spacing.md },
  commentsCol: { flex: 1, maxHeight: 280, justifyContent: 'flex-end' },
  rail: { gap: Spacing.md, alignItems: 'center', paddingBottom: Spacing.xs },
  railItem: { alignItems: 'center' },
  railCircle: {
    width: 46,
    height: 46,
    borderRadius: 23,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(0,0,0,0.35)',
  },
  railOff: { backgroundColor: 'rgba(239,68,68,0.85)' },
  railBadge: {
    position: 'absolute',
    top: -2,
    right: -2,
    minWidth: 18,
    height: 18,
    borderRadius: 9,
    paddingHorizontal: 4,
    backgroundColor: LIVE_RED,
    alignItems: 'center',
    justifyContent: 'center',
  },
  railBadgeText: { ...Typography.micro, color: '#FFF', fontWeight: '700' },

  bottomBar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
    paddingHorizontal: Spacing.md,
    paddingTop: Spacing.md,
    paddingBottom: Spacing.sm,
  },
  input: {
    ...Typography.callout,
    flex: 1,
    height: 44,
    paddingHorizontal: Spacing.lg,
    borderRadius: Radii.pill,
    color: '#FFF',
    backgroundColor: 'rgba(255,255,255,0.16)',
  },
  heartBtn: {
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: LIVE_RED,
  },

  summary: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: Spacing.xl, gap: Spacing.md },
  summaryBadge: { backgroundColor: LIVE_RED, borderRadius: 6, paddingHorizontal: 10, paddingVertical: 3 },
  summaryBadgeText: { ...Typography.label, color: '#FFF' },
  summaryHeading: { ...Typography.h1, color: '#FFF', textAlign: 'center' },
  summaryGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.sm, marginTop: Spacing.lg, width: '100%' },
  summaryClose: {
    margin: Spacing.lg,
    height: 52,
    borderRadius: Radii.pill,
    backgroundColor: 'rgba(255,255,255,0.14)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  summaryCloseText: { ...Typography.bodyStrong, color: '#FFF' },
});
