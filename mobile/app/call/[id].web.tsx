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
import { Spacing, Typography } from '@/constants/theme';
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

  // Looks: who fills the screen, where the small picture rests, whether the
  // controls are showing, and who is on the other end.
  const [peerName, setPeerName] = useState('');
  const [swapped, setSwapped] = useState(false);
  const [corner, setCorner] = useState<'tl' | 'tr' | 'bl' | 'br'>('br');
  const [drag, setDrag] = useState<{ x: number; y: number } | null>(null);
  const [chrome, setChrome] = useState(true);
  const [remoteVideo, setRemoteVideo] = useState(false);
  const dragStart = useRef<{ px: number; py: number; ox: number; oy: number; moved: boolean } | null>(null);

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
      if (track.kind === Track.Kind.Video) setRemoteVideo(true);
    };
    const detach = (track: Track) => {
      track.detach().forEach((el) => el.remove());
      if (track.kind === Track.Kind.Video) setRemoteVideo(false);
    };

    const wire = (room: Room) => {
      room
        .on(RoomEvent.TrackSubscribed, (track) => attach(track))
        .on(RoomEvent.TrackUnsubscribed, (track) => detach(track))
        .on(RoomEvent.ParticipantConnected, (p) => {
          setPeerName(p.name || '');
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
        setPeerName((n) => n || p.name || '');
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

  // The controls fade away on a video call so the picture gets the screen,
  // and come back on a tap. A voice call keeps them: there is no picture.
  const video = callMode === 'video' || camOn || remoteVideo;
  useEffect(() => {
    if (!video || state !== 'connected' || !chrome) return;
    const hide = setTimeout(() => setChrome(false), 5000);
    return () => clearTimeout(hide);
  }, [video, state, chrome]);
  const showChrome = !video || state !== 'connected' || chrome;

  // Dragging the small picture: it follows the pointer, then rests in the
  // nearest corner. A press that barely moved is a tap, and swaps the two.
  const pipEl = useRef<HTMLDivElement | null>(null);
  const onPipDown = (e: React.PointerEvent) => {
    const box = pipEl.current?.getBoundingClientRect();
    if (!box) return;
    pipEl.current?.setPointerCapture(e.pointerId);
    dragStart.current = { px: e.clientX, py: e.clientY, ox: box.left, oy: box.top, moved: false };
  };
  const onPipMove = (e: React.PointerEvent) => {
    const d = dragStart.current;
    if (!d) return;
    const dx = e.clientX - d.px;
    const dy = e.clientY - d.py;
    if (Math.abs(dx) + Math.abs(dy) > 6) d.moved = true;
    if (d.moved) setDrag({ x: d.ox + dx, y: d.oy + dy });
  };
  const onPipUp = (e: React.PointerEvent) => {
    const d = dragStart.current;
    dragStart.current = null;
    pipEl.current?.releasePointerCapture(e.pointerId);
    if (!d) return;
    if (!d.moved) {
      setSwapped((v) => !v);
      return;
    }
    const stage = pipEl.current?.parentElement?.getBoundingClientRect();
    if (stage) {
      const cx = e.clientX - stage.left;
      const cy = e.clientY - stage.top;
      setCorner(`${cy < stage.height / 2 ? 't' : 'b'}${cx < stage.width / 2 ? 'l' : 'r'}` as 'tl');
    }
    setDrag(null);
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
  const status =
    state === 'connected'
      ? clock
      : state === 'joining'
        ? t('call.connecting')
        : callMode === 'video'
          ? t('call.ringing')
          : t('call.calling');
  const name = peerName || t('call.waiting_for_others');
  // You are the small picture while the other person is the big one; a tap
  // swaps them. Before they answer, your own camera has the screen.
  const pipOn = camOn && state === 'connected';
  const youMain = camOn && (!pipOn || swapped);
  const peerMain = !youMain;

  return (
    <div
      className={`zwo-call${showChrome ? '' : ' zwo-quiet'}`}
      onClick={() => video && state === 'connected' && setChrome((v) => !v)}
    >
      <style>{CSS}</style>

      {/* Remote media lands here; plain DOM, appended by the room listeners. */}
      <div
        ref={remoteEl}
        className={peerMain ? 'zwo-main' : 'zwo-pip zwo-pip-remote'}
        style={peerMain ? undefined : pipStyle(corner, drag)}
      />
      {peerMain && !remoteVideo ? (
        <div className="zwo-avatar-wrap">
          <div className="zwo-avatar">{(name || '?').slice(0, 1).toUpperCase()}</div>
          {state === 'connected' ? (
            <span>{callMode === 'video' ? t('call.camera_off_peer') : t('call.audio_only')}</span>
          ) : (
            <span>{status}</span>
          )}
        </div>
      ) : null}

      <div
        ref={pipEl}
        className={youMain ? 'zwo-main zwo-self' : 'zwo-pip zwo-self'}
        style={{ ...(youMain ? undefined : pipStyle(corner, drag)), display: camOn ? 'block' : 'none' }}
        onClick={(e) => e.stopPropagation()}
        onPointerDown={youMain ? undefined : onPipDown}
        onPointerMove={youMain ? undefined : onPipMove}
        onPointerUp={youMain ? undefined : onPipUp}
      >
        <video ref={localEl} muted autoPlay playsInline />
      </div>

      {state === 'joining' ? (
        <View style={styles.center} pointerEvents="none">
          <ActivityIndicator color={colors.primary} size="large" />
        </View>
      ) : null}

      <div className="zwo-top" onClick={(e) => e.stopPropagation()}>
        <div className="zwo-top-text">
          <b>{name}</b>
          <span>{status}</span>
          {security === 'encrypted' && e2eeKey ? (
            <button
              className="zwo-lock"
              onClick={() => appAlert(t('call.encrypted'), callKeyFingerprint(e2eeKey))}
            >
              <Ionicons name="lock-closed" size={11} color="rgba(255,255,255,0.8)" />
              {t('call.encrypted')}
            </button>
          ) : null}
        </div>
      </div>

      {security !== 'encrypted' ? (
        <div className="zwo-warn" role="alert" onClick={(e) => e.stopPropagation()}>
          <Ionicons name="warning-outline" size={16} color="#F59E0B" />
          <div>
            <b>{isGroup ? t('call.group_not_e2ee_title') : t('call.not_e2ee_title')}</b>
            <span>{t('call.not_e2ee_body')}</span>
          </div>
        </div>
      ) : null}

      <div className="zwo-panel" onClick={(e) => e.stopPropagation()}>
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
      </div>
    </div>
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
    <button
      className={`zwo-round${active ? ' zwo-round-on' : ''}${danger ? ' zwo-round-end' : ''}`}
      aria-label={label}
      title={label}
      onClick={onPress}
    >
      <Ionicons
        name={icon}
        size={24}
        color={active && !danger ? '#0B0C10' : '#FFFFFF'}
        style={danger ? { transform: 'rotate(135deg)' } : undefined}
      />
    </button>
  );
}

/** Where the small picture rests, or follows the pointer while dragged. */
function pipStyle(corner: 'tl' | 'tr' | 'bl' | 'br', drag: { x: number; y: number } | null) {
  if (drag) return { position: 'fixed' as const, left: drag.x, top: drag.y, right: 'auto', bottom: 'auto', transition: 'none' };
  return {
    left: corner[1] === 'l' ? 12 : 'auto',
    right: corner[1] === 'r' ? 12 : 'auto',
    top: corner[0] === 't' ? 96 : 'auto',
    bottom: corner[0] === 'b' ? 120 : 'auto',
  };
}

const CSS = `
.zwo-call{position:absolute;inset:0;background:#0B0C10;overflow:hidden;font-family:system-ui;color:#fff}
.zwo-main{position:absolute;inset:0;display:flex;align-items:center;justify-content:center}
.zwo-main video{width:100%;height:100%;object-fit:cover}
.zwo-self video{transform:scaleX(-1)}
.zwo-pip{position:absolute;width:112px;height:160px;border-radius:14px;overflow:hidden;background:#1B1C22;border:1.5px solid rgba(255,255,255,.35);box-shadow:0 4px 14px rgba(0,0,0,.4);cursor:grab;touch-action:none;z-index:3;transition:left .2s,right .2s,top .2s,bottom .2s}
.zwo-pip video{width:100%;height:100%;object-fit:cover}
.zwo-avatar-wrap{position:absolute;inset:0;display:flex;flex-direction:column;gap:14px;align-items:center;justify-content:center;pointer-events:none;font:500 15px system-ui;color:rgba(255,255,255,.75)}
.zwo-avatar{width:132px;height:132px;border-radius:50%;background:rgba(255,255,255,.14);display:flex;align-items:center;justify-content:center;color:#fff;font:700 56px system-ui}
.zwo-top{position:absolute;top:0;left:0;right:0;padding:18px 20px 56px;background:linear-gradient(rgba(0,0,0,.45),transparent);z-index:2;transition:opacity .2s}
.zwo-top-text{display:flex;flex-direction:column;gap:2px}
.zwo-top-text b{font:700 21px system-ui}
.zwo-top-text span{font:400 15px system-ui;opacity:.8;font-variant-numeric:tabular-nums}
.zwo-lock{display:flex;align-items:center;gap:4px;border:0;background:none;color:rgba(255,255,255,.8);font:400 12px system-ui;padding:2px 0;cursor:pointer;align-self:flex-start}
.zwo-warn{position:absolute;top:92px;left:16px;right:16px;display:flex;gap:8px;padding:8px 10px;border-radius:10px;border:1px solid #F59E0B;background:rgba(245,158,11,.16);z-index:2}
.zwo-warn div{display:flex;flex-direction:column;gap:2px}
.zwo-warn b{font:600 13px system-ui}
.zwo-warn span{font:400 12px system-ui;opacity:.85}
.zwo-panel{position:absolute;left:50%;bottom:16px;transform:translateX(-50%);display:flex;gap:14px;padding:14px 20px;border-radius:28px;background:rgba(24,25,31,.88);z-index:4;transition:opacity .2s}
.zwo-round{width:56px;height:56px;border-radius:50%;border:0;display:flex;align-items:center;justify-content:center;background:rgba(255,255,255,.16);cursor:pointer}
.zwo-round-on{background:#fff}
.zwo-round-end{background:#E5484D}
.zwo-quiet .zwo-top,.zwo-quiet .zwo-panel,.zwo-quiet .zwo-warn{opacity:0;pointer-events:none}
@media (prefers-reduced-motion:reduce){.zwo-pip,.zwo-top,.zwo-panel{transition:none}}
`;

const styles = StyleSheet.create({
  screen: { flex: 1 },
  center: { ...StyleSheet.absoluteFillObject, alignItems: 'center', justifyContent: 'center', gap: Spacing.md },
  status: { ...Typography.body },
  link: { ...Typography.bodyStrong },
});
