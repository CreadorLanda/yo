import { Ionicons } from '@expo/vector-icons';
import { router, useLocalSearchParams } from 'expo-router';
import { Room, RoomEvent, Track, type RemoteParticipant } from 'livekit-client';
import { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, View } from 'react-native';

import { Text } from '@/components/ui/text';
import { endLive, joinLive, leaveLive, startLive, type LiveGrant } from '@/data/api/lives';
import { appAlert } from '@/data/dialog-store';
import { useLiveViewers } from '@/data/live-store';
import { availableMedia } from '@/data/media-devices';
import { t } from '@/i18n';

/**
 * A live broadcast in the browser, laid out like the ones people already know:
 * a full-height vertical stage, the host and the audience count on top,
 * comments rising from the bottom left, a heart that floats up on the right.
 *
 * The native screen (`app/live/[id].tsx`) needs `@livekit/react-native`, so
 * the browser has this twin on plain `livekit-client`. Same two ways in:
 *   /live/new?chat=<id>     or ?channel=<id>  — start one
 *   /live/<liveId>                            — watch one
 *
 * Comments and hearts travel on LiveKit's data channel, which the viewer
 * token allows (see `platform/livekit`). They are not stored: someone who
 * joins late sees only what is said from then on, and nothing is moderated,
 * so the sender's name is read from the participant the SFU reports, never
 * from the message, and the text is only ever rendered as text.
 */

const TOPIC = 'live';
const MAX_TEXT = 200;
const VISIBLE_COMMENTS = 6;

type Comment = { id: number; name: string; text: string };
type Heart = { id: number; x: number };
type Packet = { k: 'chat'; text: string } | { k: 'heart' };

export default function LiveScreen() {
  const { id, chat, channel, title } = useLocalSearchParams<{
    id: string;
    chat?: string;
    channel?: string;
    title?: string;
  }>();

  const roomRef = useRef<Room | null>(null);
  const stageEl = useRef<HTMLDivElement | null>(null);
  const previewEl = useRef<HTMLVideoElement | null>(null);
  const seq = useRef(0);
  const left = useRef(false);

  const [grant, setGrant] = useState<LiveGrant | null>(null);
  const [failure, setFailure] = useState<string | null>(null);
  const [hostHere, setHostHere] = useState(false);
  const [micOn, setMicOn] = useState(true);
  const [camOn, setCamOn] = useState(true);
  const [noCamera, setNoCamera] = useState(false);
  const [comments, setComments] = useState<Comment[]>([]);
  const [hearts, setHearts] = useState<Heart[]>([]);
  const [draft, setDraft] = useState('');

  const liveId = grant?.live.id ?? '';
  const viewers = useLiveViewers(liveId, grant?.live.viewers ?? 0);

  // Told once, from whichever door the person leaves by; never awaited, or the
  // audience count only ever grows.
  const reportLeaving = useCallback((live: string) => {
    if (left.current || !live) return;
    left.current = true;
    void leaveLive(live).catch(() => {});
  }, []);

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
        const already = err instanceof Error && /already_live/.test(err.message);
        setFailure(already ? t('live.already_live') : t('live.failed'));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [id, chat, channel, title]);

  useEffect(() => {
    if (!grant) return;
    let cancelled = false;
    const room = new Room({ adaptiveStream: true, dynacast: true });
    roomRef.current = room;

    const attach = (track: Track) => {
      if (track.kind !== Track.Kind.Video && track.kind !== Track.Kind.Audio) return;
      if (!stageEl.current) return;
      const el = track.attach();
      if (track.kind === Track.Kind.Video) {
        el.style.cssText = 'width:100%;height:100%;object-fit:cover;';
      }
      stageEl.current.appendChild(el);
    };

    room
      .on(RoomEvent.TrackSubscribed, (track, _pub, p: RemoteParticipant) => {
        if (p.identity === grant.live.host_id) setHostHere(true);
        attach(track);
      })
      .on(RoomEvent.TrackUnsubscribed, (track) => track.detach().forEach((el) => el.remove()))
      .on(RoomEvent.ParticipantDisconnected, (p) => {
        if (p.identity === grant.live.host_id && !grant.host) setHostHere(false);
      })
      .on(RoomEvent.DataReceived, (payload, participant, _kind, topic) => {
        if (topic !== TOPIC) return;
        let packet: Packet;
        try {
          packet = JSON.parse(new TextDecoder().decode(payload)) as Packet;
        } catch {
          return;
        }
        if (packet.k === 'heart') {
          addHeart();
        } else if (packet.k === 'chat' && typeof packet.text === 'string') {
          // The name is the SFU's account of who sent it, not the sender's.
          addComment(participant?.name || participant?.identity || '…', packet.text);
        }
      })
      .on(RoomEvent.Disconnected, () => {
        if (cancelled) return;
        appAlert(t('live.ended_already'), '');
        router.back();
      });

    (async () => {
      try {
        await room.connect(grant.url, grant.token);
        if (cancelled) return;
        if (grant.host) {
          setHostHere(true);
          const devices = await availableMedia();
          if (devices.microphone) await room.localParticipant.setMicrophoneEnabled(true);
          if (devices.camera) {
            await room.localParticipant.setCameraEnabled(true);
            const pub = room.localParticipant.getTrackPublication(Track.Source.Camera);
            if (pub?.track && previewEl.current) pub.track.attach(previewEl.current);
          } else {
            setNoCamera(true);
            setCamOn(false);
            appAlert(t('call.camera_failed_title'), t('call.no_camera_body'));
          }
        } else {
          // Someone already on air: pick up what is being published now.
          room.remoteParticipants.forEach((p) => {
            if (p.identity === grant.live.host_id) setHostHere(true);
            p.trackPublications.forEach((pub) => {
              if (pub.track) attach(pub.track);
            });
          });
        }
      } catch {
        if (!cancelled) setFailure(t('live.failed'));
      }
    })();

    return () => {
      cancelled = true;
      reportLeaving(grant.live.id);
      void room.disconnect();
    };
  }, [grant, reportLeaving]);

  const addComment = (name: string, raw: string) => {
    const text = raw.slice(0, MAX_TEXT);
    if (!text.trim()) return;
    setComments((prev) => [...prev, { id: ++seq.current, name, text }].slice(-50));
  };

  const addHeart = () => {
    const heart = { id: ++seq.current, x: 10 + Math.random() * 60 };
    setHearts((prev) => [...prev, heart]);
    setTimeout(() => setHearts((prev) => prev.filter((h) => h.id !== heart.id)), 2200);
  };

  const send = (packet: Packet) => {
    const room = roomRef.current;
    if (!room) return;
    void room.localParticipant
      .publishData(new TextEncoder().encode(JSON.stringify(packet)), {
        reliable: packet.k === 'chat',
        topic: TOPIC,
      })
      .catch(() => {});
  };

  const submit = () => {
    const text = draft.trim().slice(0, MAX_TEXT);
    if (!text) return;
    setDraft('');
    addComment(roomRef.current?.localParticipant.name || '…', text);
    send({ k: 'chat', text });
  };

  const heart = () => {
    addHeart();
    send({ k: 'heart' });
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
          void endLive(liveId).catch(() => {});
          void roomRef.current?.disconnect();
          router.back();
        },
      },
    ]);
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
          <Text style={styles.status}>
            {id === 'new' ? t('live.starting') : t('live.connecting')}
          </Text>
        </View>
      </View>
    );
  }

  const isHost = grant.host;
  const visible = comments.slice(-VISIBLE_COMMENTS);

  return (
    <View style={styles.page}>
      <style>{CSS}</style>
      <div className="zwo-live-stage">
        {/* Remote media is appended here by the room listeners. The host sees
            their own preview instead, mirrored like a selfie. */}
        <div ref={stageEl} className="zwo-live-media" />
        {isHost ? (
          <video
            ref={previewEl}
            muted
            autoPlay
            playsInline
            className="zwo-live-media zwo-live-self"
            style={{ display: camOn ? 'block' : 'none' }}
          />
        ) : null}

        {!hostHere || (isHost && !camOn) ? (
          <div className="zwo-live-empty">
            <Ionicons name="videocam-off-outline" size={40} color="rgba(255,255,255,0.35)" />
            <span>
              {isHost
                ? noCamera
                  ? t('call.no_camera_body')
                  : t('live.your_camera_is_off')
                : t('live.waiting_for_host')}
            </span>
          </div>
        ) : null}

        <div className="zwo-live-top">
          <div className="zwo-pill">
            <span className="zwo-badge">{t('live.badge')}</span>
            <span>{grant.live.host_name}</span>
          </div>
          <div className="zwo-pill">
            <Ionicons name="eye-outline" size={14} color="#FFF" />
            <span>{viewers}</span>
          </div>
          <button className="zwo-icon" aria-label={t('common.close')} onClick={isHost ? finish : leave}>
            <Ionicons name="close" size={22} color="#FFF" />
          </button>
        </div>

        <div className="zwo-live-comments" aria-live="polite">
          {visible.map((c) => (
            <div key={c.id} className="zwo-comment">
              <b>{c.name}</b> <span>{c.text}</span>
            </div>
          ))}
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
            maxLength={MAX_TEXT}
            placeholder={t('live.comment_placeholder')}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') submit();
            }}
          />
          {isHost ? (
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
          <button className="zwo-icon zwo-heart-btn" aria-label="♥" onClick={heart}>
            <Ionicons name="heart" size={22} color="#FFF" />
          </button>
        </div>
      </div>
    </View>
  );
}

// Plain CSS because the stage is DOM: video elements, a native <input>, and a
// keyframe animation that has no equivalent in StyleSheet.
const CSS = `
.zwo-live-stage{position:relative;height:100dvh;width:min(100vw,calc(100dvh*9/16));background:#000;overflow:hidden;border-radius:0}
@media (min-width:700px){.zwo-live-stage{border-radius:16px;height:min(100dvh,900px);width:min(100vw,calc(min(100dvh,900px)*9/16))}}
.zwo-live-media{position:absolute;inset:0;width:100%;height:100%}
.zwo-live-self{object-fit:cover;transform:scaleX(-1)}
.zwo-live-empty{position:absolute;inset:0;display:flex;flex-direction:column;gap:12px;align-items:center;justify-content:center;color:rgba(255,255,255,.6);font:500 15px system-ui;text-align:center;padding:24px}
.zwo-live-top{position:absolute;top:0;left:0;right:0;display:flex;gap:8px;align-items:center;padding:14px 14px 40px;background:linear-gradient(rgba(0,0,0,.55),transparent)}
.zwo-live-top .zwo-icon{margin-left:auto}
.zwo-pill{display:flex;gap:6px;align-items:center;height:32px;padding:0 12px;border-radius:16px;background:rgba(0,0,0,.45);color:#fff;font:600 13px system-ui}
.zwo-badge{background:#E5484D;border-radius:4px;padding:1px 6px;font-size:11px;letter-spacing:.5px}
.zwo-live-comments{position:absolute;left:12px;right:72px;bottom:76px;display:flex;flex-direction:column;gap:6px;pointer-events:none}
.zwo-comment{align-self:flex-start;max-width:100%;padding:6px 12px;border-radius:14px;background:rgba(0,0,0,.4);color:#fff;font:400 14px/1.3 system-ui;word-break:break-word}
.zwo-comment b{font-weight:700;opacity:.85}
.zwo-live-bottom{position:absolute;left:0;right:0;bottom:0;display:flex;gap:8px;align-items:center;padding:12px;background:linear-gradient(transparent,rgba(0,0,0,.55))}
.zwo-input{flex:1;min-width:0;height:44px;padding:0 16px;border-radius:22px;border:1px solid rgba(255,255,255,.35);background:rgba(0,0,0,.35);color:#fff;font:400 15px system-ui;outline:none}
.zwo-input:focus{border-color:#fff}
.zwo-icon{width:44px;height:44px;border-radius:22px;border:0;display:flex;align-items:center;justify-content:center;background:rgba(255,255,255,.18);cursor:pointer;flex:none}
.zwo-icon.zwo-off{background:rgba(229,72,77,.85)}
.zwo-heart-btn{background:rgba(229,72,77,.9)}
.zwo-heart{position:absolute;bottom:70px;color:#FF4D6D;font-size:30px;pointer-events:none;animation:zwo-float 2.2s ease-out forwards}
@keyframes zwo-float{0%{transform:translateY(0) scale(.6);opacity:0}15%{opacity:1}100%{transform:translateY(-320px) scale(1.2);opacity:0}}
@media (prefers-reduced-motion:reduce){.zwo-heart{animation-duration:.01s}}
`;

const styles = StyleSheet.create({
  page: {
    flex: 1,
    backgroundColor: '#0B0B10',
    alignItems: 'center',
    justifyContent: 'center',
  },
  center: { alignItems: 'center', justifyContent: 'center', gap: 12, padding: 24 },
  status: { color: 'rgba(255,255,255,0.8)', fontSize: 15, textAlign: 'center' },
  link: { color: '#FFFFFF', fontSize: 15, fontWeight: '600' },
});
