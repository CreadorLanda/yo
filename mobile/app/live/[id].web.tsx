import { Ionicons } from '@expo/vector-icons';
import { router, useLocalSearchParams } from 'expo-router';
import {
  Room,
  RoomEvent,
  Track,
  type RemoteParticipant,
  type RemoteTrack,
} from 'livekit-client';
import { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, View } from 'react-native';

import { LIVE_RED } from '@/components/live/live-overlay';
import { formatDuration, LiveToolsSheet, Stat } from '@/components/live/live-tools-sheet';
import { Text } from '@/components/ui/text';
import {
  banFromLive,
  deleteLiveComment,
  endLive,
  heartbeatLive,
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
import { ApiError } from '@/data/api/client';
import { getCurrentUser } from '@/data/auth-store';
import { appAlert } from '@/data/dialog-store';
import { addOwnComment, closeRoom, openRoom, patchRoom, useLiveRoom } from '@/data/live-room';
import { refreshRunningLives, useLiveViewers } from '@/data/live-store';
import { availableMedia } from '@/data/media-devices';
import { t } from '@/i18n';

/**
 * A live broadcast in the browser: the same live as the phone's
 * (`app/live/[id].tsx`) on plain `livekit-client`, laid out as a vertical
 * stage the way people know it from TikTok.
 *
 * Comments, the stage, bans and invitations come from the API and the
 * websocket through `data/live-room`, shared with the phone, and the tools
 * sheet is the same component. Only the media is DOM: video and audio
 * elements attached by the room, and the hearts' CSS animation.
 *
 *   /live/new?chat=… | ?channel=… | (neither)  &audience=…&viewers=…&title=…
 *   /live/<liveId>
 */

const HEARTS_TOPIC = 'hearts';
const VISIBLE_COMMENTS = 7;

type Heart = { id: number; x: number };

export default function LiveScreen() {
  const { id, chat, channel, title, audience, viewers } = useLocalSearchParams<{
    id: string;
    chat?: string;
    channel?: string;
    title?: string;
    audience?: string;
    viewers?: string;
  }>();

  const me = getCurrentUser()?.id;
  const roomState = useLiveRoom();
  const roomRef = useRef<Room | null>(null);
  const stageEl = useRef<HTMLDivElement | null>(null);
  const previewEl = useRef<HTMLVideoElement | null>(null);
  const seq = useRef(0);
  const pendingHearts = useRef(0);
  const left = useRef(false);

  const [grant, setGrant] = useState<LiveGrant | null>(null);
  const [failure, setFailure] = useState<string | null>(null);
  const [micOn, setMicOn] = useState(false);
  const [camOn, setCamOn] = useState(false);
  const [tiles, setTiles] = useState(0);
  const [hearts, setHearts] = useState<Heart[]>([]);
  const [draft, setDraft] = useState('');
  const [tools, setTools] = useState(false);
  const [summary, setSummary] = useState<LiveStats | null>(null);
  const [elapsed, setElapsed] = useState(0);

  const liveId = grant?.live.id ?? '';
  const viewerCount = useLiveViewers(liveId, grant?.live.viewers ?? 0);
  const isHost = !!grant?.host;
  const meMember = roomState.members.find((m) => m.user_id === me);
  const moderator = !!grant?.moderator || !!meMember?.moderator;
  const onStage = roomState.myStage === 'on';
  const publisher = isHost || onStage;

  const reportLeaving = useCallback((live: string) => {
    if (left.current || !live) return;
    left.current = true;
    void leaveLive(live).catch(() => {});
  }, []);

  const floatHeart = useCallback(() => {
    const heart = { id: ++seq.current, x: 10 + Math.random() * 40 };
    setHearts((prev) => [...prev.slice(-24), heart]);
    setTimeout(() => setHearts((prev) => prev.filter((h) => h.id !== heart.id)), 2200);
  }, []);

  // ── getting in ──
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
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
        const details = await liveDetails(g.live.id).catch(() => null);
        if (cancelled) return;
        openRoom(
          details ?? {
            live: g.live,
            members: [],
            role: g.role ?? (g.host ? 'host' : 'viewer'),
            moderator: !!g.moderator,
            comments: [],
          },
        );
        setGrant(details ? { ...g, role: details.role, moderator: details.moderator } : g);
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
  }, [id, chat, channel, title, audience, viewers]);

  useEffect(() => () => closeRoom(), []);

  // ── the media room ──
  useEffect(() => {
    if (!grant) return;
    let cancelled = false;
    const room = new Room({ adaptiveStream: true, dynacast: true });
    roomRef.current = room;

    const countTiles = () => setTiles(stageEl.current?.querySelectorAll('video').length ?? 0);
    const attach = (track: RemoteTrack) => {
      if (!stageEl.current) return;
      const el = track.attach();
      if (track.kind === Track.Kind.Video) el.className = 'zwo-tile';
      stageEl.current.appendChild(el);
      countTiles();
    };

    room
      .on(RoomEvent.TrackSubscribed, (track) => attach(track))
      .on(RoomEvent.TrackUnsubscribed, (track) => {
        track.detach().forEach((el) => el.remove());
        countTiles();
      })
      .on(RoomEvent.DataReceived, (_payload, _p, _kind, topic) => {
        if (topic === HEARTS_TOPIC) floatHeart();
      })
      .on(RoomEvent.Disconnected, () => {
        if (!cancelled) patchRoom({ ended: true });
      });

    (async () => {
      try {
        await room.connect(grant.url, grant.token);
        if (cancelled) return;
        // Hosts start with the microphone, if there is one, and the camera
        // off, the same as on the phone.
        if (grant.host) {
          const devices = await availableMedia();
          if (devices.microphone) {
            await room.localParticipant.setMicrophoneEnabled(true).catch(() => {});
            setMicOn(true);
          }
        }
        room.remoteParticipants.forEach((p: RemoteParticipant) =>
          p.trackPublications.forEach((pub) => {
            if (pub.track) attach(pub.track as RemoteTrack);
          }),
        );
      } catch {
        if (!cancelled) setFailure(t('live.failed'));
      }
    })();

    return () => {
      cancelled = true;
      reportLeaving(grant.live.id);
      void room.disconnect();
    };
  }, [grant, reportLeaving, floatHeart]);

  // The count goes to the server in batches; the animation already travelled.
  useEffect(() => {
    if (!liveId) return;
    const flush = setInterval(() => {
      const n = Math.min(50, pendingHearts.current);
      if (!n) return;
      pendingHearts.current -= n;
      void sendLiveHearts(liveId, n).catch(() => {});
    }, 3000);
    return () => clearInterval(flush);
  }, [liveId]);

  useEffect(() => {
    if (isHost || !liveId) return;
    const beat = () => {
      void heartbeatLive(liveId).catch((err) => {
        if (err instanceof ApiError && err.status === 404) {
          patchRoom({ ended: true });
          void roomRef.current?.disconnect();
        }
      });
    };
    beat();
    const timer = setInterval(beat, 15_000);
    return () => clearInterval(timer);
  }, [isHost, liveId]);

  useEffect(() => {
    if (!grant?.host) return;
    const started = new Date(grant.live.started_at).getTime();
    const tick = () => setElapsed(Math.max(0, Math.floor((Date.now() - started) / 1000)));
    tick();
    const every = setInterval(tick, 1000);
    return () => clearInterval(every);
  }, [grant]);

  // ── the stage: becoming a guest, or stopping being one ──
  useEffect(() => {
    const room = roomRef.current;
    if (!room || isHost) return;
    if (onStage) {
      void room.localParticipant
        .setMicrophoneEnabled(true)
        .then(() => setMicOn(true))
        .catch(() => appAlert(t('live.mic_failed'), t('call.camera_permission')));
    } else {
      void room.localParticipant.setMicrophoneEnabled(false).catch(() => {});
      void room.localParticipant.setCameraEnabled(false).catch(() => {});
      setMicOn(false);
      setCamOn(false);
    }
  }, [onStage, isHost]);

  useEffect(() => {
    if (!roomState.banned) return;
    appAlert(t('live.you_were_banned'), '');
    router.back();
  }, [roomState.banned]);

  useEffect(() => {
    if (!roomState.ended || summary || !liveId) return;
    if (isHost || moderator) void liveStats(liveId).then(setSummary).catch(() => {});
  }, [roomState.ended, summary, isHost, moderator, liveId]);

  // ── actions ──
  const heart = () => {
    floatHeart();
    pendingHearts.current += 1;
    void roomRef.current?.localParticipant
      .publishData(new Uint8Array([1]), { reliable: false, topic: HEARTS_TOPIC })
      .catch(() => {});
  };

  const canComment = roomState.commentsEnabled || moderator;
  const submit = () => {
    const body = draft.trim();
    if (!body || !liveId) return;
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

  const toggleHand = () => {
    if (roomState.myStage === 'requested' || onStage) {
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

  const toggleMic = async () => {
    const next = !micOn;
    try {
      await roomRef.current?.localParticipant.setMicrophoneEnabled(next);
      setMicOn(next);
    } catch {
      appAlert(t('live.mic_failed'), t('call.camera_permission'));
    }
  };

  const toggleCamera = async () => {
    const next = !camOn;
    try {
      await roomRef.current?.localParticipant.setCameraEnabled(next);
      setCamOn(next);
      const pub = roomRef.current?.localParticipant.getTrackPublication(Track.Source.Camera);
      if (next && pub?.track && previewEl.current) pub.track.attach(previewEl.current);
    } catch {
      appAlert(t('call.camera_failed_title'), t('call.camera_failed_body'));
    }
  };

  const leave = () => {
    reportLeaving(liveId);
    void roomRef.current?.disconnect();
    router.back();
  };

  const finish = () => {
    appAlert(t('live.end_title'), t('live.end_body'), [
      { text: t('common.cancel'), style: 'cancel' },
      {
        text: t('live.end_confirm'),
        style: 'destructive',
        onPress: () => {
          void endLive(liveId)
            .then(() => liveStats(liveId))
            .then(setSummary)
            .catch(() => router.back())
            .finally(() => {
              void roomRef.current?.disconnect();
              void refreshRunningLives();
            });
        },
      },
    ]);
  };

  // ── screens ──
  if (failure) {
    return (
      <View style={styles.page}>
        <View style={styles.center}>
          <Ionicons name="radio-outline" size={44} color="rgba(255,255,255,0.4)" />
          <Text style={styles.status}>{failure}</Text>
          <Pressable onPress={() => router.back()} hitSlop={10}>
            <Text style={styles.link}>{t('common.close')}</Text>
          </Pressable>
        </View>
      </View>
    );
  }

  if (!grant) {
    return (
      <View style={styles.page}>
        <View style={styles.center}>
          <ActivityIndicator color="#FFF" size="large" />
          <Text style={styles.status}>{id === 'new' ? t('live.starting') : t('live.connecting')}</Text>
        </View>
      </View>
    );
  }

  const live = grant.live;
  const cohosts = roomState.members.filter((m) => m.cohost);
  const hosts = [live.host_name, ...cohosts.map((m) => m.name)].filter(Boolean).join(' & ');

  if (summary) {
    return (
      <View style={styles.page}>
        <View style={styles.summary}>
          <View style={styles.summaryBadge}>
            <Text style={styles.summaryBadgeText}>{t('live.summary_title')}</Text>
          </View>
          <Text style={styles.summaryHeading}>{live.title || hosts}</Text>
          <Text style={styles.status}>{formatDuration(summary.duration_seconds)}</Text>
          <View style={styles.summaryGrid}>
            <Stat icon="people" value={summary.unique_viewers} label={t('live.stat_unique')} />
            <Stat icon="trending-up" value={summary.peak_viewers} label={t('live.stat_peak')} />
            <Stat icon="heart" value={summary.hearts} label={t('live.stat_hearts')} />
            <Stat icon="chatbubble" value={summary.comments} label={t('live.stat_comments')} />
          </View>
          <Pressable onPress={() => router.back()} style={styles.summaryClose}>
            <Text style={styles.link}>{t('common.done')}</Text>
          </Pressable>
        </View>
      </View>
    );
  }

  if (roomState.ended && !isHost && !moderator) {
    return (
      <View style={styles.page}>
        <View style={styles.center}>
          <Ionicons name="radio-outline" size={44} color="rgba(255,255,255,0.4)" />
          <Text style={styles.status}>{t('live.ended_already')}</Text>
          <Pressable onPress={leave} hitSlop={10}>
            <Text style={styles.link}>{t('common.close')}</Text>
          </Pressable>
        </View>
      </View>
    );
  }

  const comments = roomState.comments.slice(-VISIBLE_COMMENTS);
  const requests = roomState.members.filter((m) => m.stage === 'requested').length;
  const showEmpty = tiles === 0 && !(publisher && camOn);
  const handLabel = onStage
    ? t('live.leave_stage')
    : roomState.myStage === 'requested'
      ? t('live.cancel_request')
      : t('live.ask_to_speak');

  return (
    <View style={styles.page}>
      <style>{CSS}</style>
      <div className="zwo-live-stage" onDoubleClick={heart}>
        {/* Remote video is appended here by the room; the grid splits the
            stage when more than one person is on it. */}
        <div ref={stageEl} className="zwo-live-media" />
        {publisher ? (
          <video
            ref={previewEl}
            muted
            autoPlay
            playsInline
            className={tiles ? 'zwo-live-pip' : 'zwo-live-self'}
            style={{ display: camOn ? 'block' : 'none' }}
          />
        ) : null}

        {showEmpty ? (
          <div className="zwo-live-empty">
            <div className="zwo-avatar">{(live.host_name || '?').slice(0, 1).toUpperCase()}</div>
            <span>{isHost ? t('live.your_camera_is_off') : t('live.waiting_for_host')}</span>
          </div>
        ) : null}

        <div className="zwo-live-top">
          <div className="zwo-host">
            <div className="zwo-avatar zwo-avatar-sm">
              {(live.host_name || '?').slice(0, 1).toUpperCase()}
            </div>
            <div className="zwo-host-text">
              <b>{hosts}</b>
              <span>{live.title || (live.joint ? t('live.joint') : t('live.badge'))}</span>
            </div>
          </div>
          <button
            className="zwo-pill"
            onClick={() => moderator && setTools(true)}
            style={{ cursor: moderator ? 'pointer' : 'default' }}
          >
            <i className="zwo-dot" />
            <Ionicons name="eye" size={13} color="#FFF" />
            <span>{viewerCount}</span>
          </button>
          <button
            className="zwo-icon zwo-icon-sm"
            aria-label={isHost ? t('live.end') : t('common.close')}
            onClick={isHost ? finish : leave}
          >
            <Ionicons name="close" size={20} color="#FFF" />
          </button>
        </div>
        {isHost ? <div className="zwo-timer">{formatDuration(elapsed)}</div> : null}

        {roomState.myStage === 'invited' ? (
          <div className="zwo-invite">
            <Ionicons name="mic" size={18} color="#FFF" />
            <span>{t('live.stage_invited', { name: roomState.stageInviteBy || t('call.someone') })}</span>
            <button className="zwo-chip" onClick={() => answerStage(false)}>
              {t('live.not_now')}
            </button>
            <button className="zwo-chip zwo-chip-on" onClick={() => answerStage(true)}>
              {t('live.accept')}
            </button>
          </div>
        ) : null}

        <div className="zwo-live-comments">
          {comments.length < VISIBLE_COMMENTS ? (
            <div className="zwo-comment zwo-note">{t('live.not_e2ee')}</div>
          ) : null}
          {comments.map((c, i) => (
            <div
              key={c.id}
              className="zwo-comment"
              style={{ opacity: 0.45 + (0.55 * (i + 1)) / comments.length }}
              onClick={() => commentMenu(c)}
            >
              <b>{c.name || '…'}</b> <span>{c.body}</span>
            </div>
          ))}
        </div>

        <div className="zwo-rail">
          {moderator ? (
            <button className="zwo-icon" aria-label={t('live.tools')} title={t('live.tools')} onClick={() => setTools(true)}>
              <Ionicons name="people" size={22} color="#FFF" />
              {requests ? <i className="zwo-rail-badge">{requests}</i> : null}
            </button>
          ) : null}
          {publisher ? (
            <>
              <button
                className={`zwo-icon${micOn ? '' : ' zwo-off'}`}
                aria-label={t('call.mute')}
                onClick={toggleMic}
              >
                <Ionicons name={micOn ? 'mic' : 'mic-off'} size={22} color="#FFF" />
              </button>
              <button
                className={`zwo-icon${camOn ? '' : ' zwo-off'}`}
                aria-label={t('call.camera')}
                onClick={toggleCamera}
              >
                <Ionicons name={camOn ? 'videocam' : 'videocam-off'} size={22} color="#FFF" />
              </button>
            </>
          ) : null}
          {!isHost ? (
            <button
              className={`zwo-icon${roomState.myStage === 'requested' ? ' zwo-on' : ''}`}
              aria-label={handLabel}
              title={handLabel}
              onClick={toggleHand}
            >
              <Ionicons
                name={onStage ? 'exit-outline' : roomState.myStage === 'requested' ? 'hand-left' : 'hand-left-outline'}
                size={22}
                color="#FFF"
              />
            </button>
          ) : null}
        </div>

        {hearts.map((h) => (
          <span key={h.id} className="zwo-heart" style={{ right: `${h.x}px` }}>
            ♥
          </span>
        ))}

        <div className="zwo-live-bottom">
          <input
            className="zwo-input"
            value={draft}
            disabled={!canComment}
            maxLength={300}
            placeholder={canComment ? t('live.comment_placeholder') : t('live.comments_off')}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') submit();
            }}
          />
          <button className="zwo-icon zwo-heart-btn" aria-label="♥" onClick={heart}>
            <Ionicons name="heart" size={22} color="#FFF" />
          </button>
        </div>
      </div>

      {moderator ? (
        <LiveToolsSheet
          visible={tools}
          onClose={() => setTools(false)}
          liveId={liveId}
          isHost={isHost}
          members={roomState.members}
          commentsEnabled={roomState.commentsEnabled}
        />
      ) : null}
    </View>
  );
}

// Plain CSS because the stage is DOM: video elements, a native <input>, and a
// keyframe animation that has no equivalent in StyleSheet.
const CSS = `
.zwo-live-stage{position:relative;height:100dvh;width:min(100vw,calc(100dvh*9/16));background:#000;overflow:hidden;font-family:system-ui}
@media (min-width:700px){.zwo-live-stage{border-radius:16px;height:min(100dvh,900px);width:min(100vw,calc(min(100dvh,900px)*9/16))}}
.zwo-live-media{position:absolute;inset:0;display:grid;grid-template-columns:1fr;grid-auto-rows:1fr;background:#0B0C10}
.zwo-live-media:has(.zwo-tile:nth-of-type(3)){grid-template-columns:1fr 1fr}
.zwo-tile{width:100%;height:100%;object-fit:cover;min-height:0}
.zwo-live-self{position:absolute;inset:0;width:100%;height:100%;object-fit:cover;transform:scaleX(-1)}
.zwo-live-pip{position:absolute;right:12px;top:96px;width:96px;height:140px;object-fit:cover;transform:scaleX(-1);border-radius:12px;border:2px solid rgba(255,255,255,.6)}
.zwo-live-empty{position:absolute;inset:0;display:flex;flex-direction:column;gap:14px;align-items:center;justify-content:center;color:rgba(255,255,255,.7);font:500 15px system-ui;text-align:center;padding:24px}
.zwo-avatar{width:96px;height:96px;border-radius:50%;background:rgba(255,255,255,.16);display:flex;align-items:center;justify-content:center;color:#fff;font:700 40px system-ui}
.zwo-avatar-sm{width:34px;height:34px;font-size:15px}
.zwo-live-top{position:absolute;top:0;left:0;right:0;display:flex;gap:8px;align-items:center;padding:12px 12px 48px;background:linear-gradient(rgba(0,0,0,.5),transparent)}
.zwo-host{display:flex;gap:8px;align-items:center;max-width:62%;padding:3px 14px 3px 3px;border-radius:22px;background:rgba(0,0,0,.35);margin-right:auto}
.zwo-host-text{display:flex;flex-direction:column;min-width:0;color:#fff}
.zwo-host-text b{font:600 13px system-ui;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.zwo-host-text span{font:400 11px system-ui;opacity:.75;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.zwo-pill{display:flex;gap:5px;align-items:center;height:32px;padding:0 12px;border-radius:16px;border:0;background:rgba(0,0,0,.35);color:#fff;font:600 13px system-ui;font-variant-numeric:tabular-nums}
.zwo-dot{width:7px;height:7px;border-radius:50%;background:${LIVE_RED};display:inline-block}
.zwo-timer{position:absolute;top:60px;left:12px;padding:3px 8px;border-radius:12px;background:rgba(0,0,0,.35);color:#fff;font:500 11px system-ui;font-variant-numeric:tabular-nums}
.zwo-invite{position:absolute;top:96px;left:12px;right:12px;display:flex;gap:8px;align-items:center;padding:8px 8px 8px 14px;border-radius:16px;background:rgba(17,18,24,.94);color:#fff;font:400 14px system-ui}
.zwo-invite span{flex:1}
.zwo-chip{border:0;border-radius:16px;padding:6px 12px;background:rgba(255,255,255,.14);color:#fff;font:600 13px system-ui;cursor:pointer}
.zwo-chip-on{background:${LIVE_RED}}
.zwo-live-comments{position:absolute;left:12px;right:76px;bottom:76px;max-height:42%;display:flex;flex-direction:column;justify-content:flex-end;gap:6px;overflow:hidden}
.zwo-comment{align-self:flex-start;max-width:100%;padding:6px 12px;border-radius:16px;background:rgba(0,0,0,.32);color:#fff;font:400 14px/1.3 system-ui;word-break:break-word;cursor:default}
.zwo-comment b{font-weight:600;opacity:.75;margin-right:4px}
.zwo-note{background:rgba(255,255,255,.12);font-size:12px;opacity:.85}
.zwo-rail{position:absolute;right:12px;bottom:80px;display:flex;flex-direction:column;gap:14px}
.zwo-live-bottom{position:absolute;left:0;right:0;bottom:0;display:flex;gap:8px;align-items:center;padding:12px;background:linear-gradient(transparent,rgba(0,0,0,.5))}
.zwo-input{flex:1;min-width:0;height:44px;padding:0 16px;border-radius:22px;border:0;background:rgba(255,255,255,.16);color:#fff;font:400 15px system-ui;outline:none}
.zwo-input::placeholder{color:rgba(255,255,255,.6)}
.zwo-input:focus{background:rgba(255,255,255,.22)}
.zwo-icon{position:relative;width:46px;height:46px;border-radius:23px;border:0;display:flex;align-items:center;justify-content:center;background:rgba(0,0,0,.35);cursor:pointer;flex:none}
.zwo-icon-sm{width:32px;height:32px}
.zwo-icon.zwo-off{background:rgba(239,68,68,.85)}
.zwo-icon.zwo-on{background:${LIVE_RED}}
.zwo-rail-badge{position:absolute;top:-2px;right:-2px;min-width:18px;height:18px;padding:0 4px;border-radius:9px;background:${LIVE_RED};color:#fff;font:700 11px/18px system-ui;font-style:normal}
.zwo-heart-btn{width:44px;height:44px;background:${LIVE_RED}}
.zwo-heart{position:absolute;bottom:70px;color:${LIVE_RED};font-size:30px;pointer-events:none;animation:zwo-float 2.2s ease-out forwards}
@keyframes zwo-float{0%{transform:translateY(0) scale(.6);opacity:0}15%{opacity:1}100%{transform:translateY(-320px) scale(1.2);opacity:0}}
@media (prefers-reduced-motion:reduce){.zwo-heart{animation-duration:.01s}}
`;

const styles = StyleSheet.create({
  page: { flex: 1, backgroundColor: '#0B0B10', alignItems: 'center', justifyContent: 'center' },
  center: { alignItems: 'center', justifyContent: 'center', gap: 12, padding: 24 },
  status: { color: 'rgba(255,255,255,0.8)', fontSize: 15, textAlign: 'center' },
  link: { color: '#FFFFFF', fontSize: 15, fontWeight: '600' },
  summary: { width: '100%', maxWidth: 420, alignItems: 'center', gap: 12, padding: 24 },
  summaryBadge: { backgroundColor: LIVE_RED, borderRadius: 6, paddingHorizontal: 10, paddingVertical: 3 },
  summaryBadgeText: { color: '#FFF', fontWeight: '700', fontSize: 13 },
  summaryHeading: { color: '#FFF', fontSize: 26, fontWeight: '700', textAlign: 'center' },
  summaryGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, width: '100%', marginTop: 12 },
  summaryClose: {
    marginTop: 16,
    width: '100%',
    height: 52,
    borderRadius: 26,
    backgroundColor: 'rgba(255,255,255,0.14)',
    alignItems: 'center',
    justifyContent: 'center',
  },
});
