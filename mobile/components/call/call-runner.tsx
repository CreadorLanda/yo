import {
  AudioSession,
  LiveKitRoom,
  registerGlobals,
  useLocalParticipant,
  useParticipants,
  useRoomContext,
} from '@livekit/react-native';
import { requestRecordingPermissionsAsync } from 'expo-audio';
import { useEffect, useRef, useState } from 'react';
import { AppState } from 'react-native';

import { cameraStep, endCall, patchCall, type ActiveCall } from '@/data/active-call';
import { callToken, type CallGrant } from '@/data/api/calls';
import { listChats } from '@/data/api/messages';
import { callKeyFor } from '@/data/crypto/call-key';
import { appAlert } from '@/data/dialog-store';
import { RING_TIMEOUT_MS } from '@/data/incoming-call';
import { availableMedia, type AvailableMedia } from '@/data/media-devices';
import { t } from '@/i18n';
import { startCallKeepAlive, stopCallKeepAlive } from '@/modules/call-keepalive';

// WebRTC needs its globals installed before any of it is touched. Done at
// module load: a re-render must not register them again.
registerGlobals();

/**
 * Runs a call for as long as it lasts, whatever is on screen.
 *
 * The server signs a token saying this user may join the room named after this
 * chat, the SFU relays the media, and the streams are encrypted with a key
 * derived from the conversation's own E2EE session, which the server never
 * sees. See server/internal/modules/calls.
 */
export function CallRunner({ call }: { call: ActiveCall }) {
  const { chatId, mode, incoming } = call;
  const [grant, setGrant] = useState<CallGrant | null>(null);
  const [media, setMedia] = useState<AvailableMedia>({ camera: false, microphone: true });
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let cancelled = false;

    (async () => {
      try {
        // Asked here, before anything else: Android refuses a microphone
        // foreground service to an app without the permission, and a call that
        // cannot keep running in the background is the bug this exists to fix.
        await requestRecordingPermissionsAsync().catch(() => null);
        if (cancelled) return;
        setReady(true);

        // Fetched now, not cached: the token lives five minutes and holding
        // one is holding a key to the room.
        const g = await callToken(chatId, { ring: !incoming, mode });
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
        const chat = (await listChats()).find((c) => c.id === chatId);
        if (cancelled) return;
        let e2eeKey: string | null = null;
        if (chat?.type !== 'group' && chat?.peer_user_id) {
          e2eeKey = await callKeyFor(chatId, chat.peer_user_id);
          if (cancelled) return;
        }
        // Don't connect the media room until the call type and encryption
        // state are known. Otherwise a group call briefly starts without
        // showing that the SFU can access its streams.
        patchCall(chatId, { e2eeKey, isGroup: chat?.type === 'group' });
        setGrant(g);
      } catch {
        if (!cancelled) patchCall(chatId, { failure: t('call.failed_to_join') });
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [chatId, incoming, mode]);

  // The audio session has to be running before the room connects, or the
  // first seconds arrive with nowhere to play.
  //
  // The keep-alive goes up with it and comes down with it, because the two
  // answer the same question from opposite ends: LiveKit's session routes the
  // audio, and this stops the OS from taking the process away mid-call. On
  // Android that is a foreground service; on iOS it is holding the
  // AVAudioSession active. See #160.
  useEffect(() => {
    if (!ready) return;
    void AudioSession.startAudioSession();
    startCallKeepAlive({
      video: mode === 'video',
      title: t('call.ongoing_title'),
      body: t('call.ongoing_body'),
    });
    return () => {
      stopCallKeepAlive();
      void AudioSession.stopAudioSession();
    };
  }, [ready, mode]);

  if (!grant || call.failure) return null;

  return (
    <LiveKitRoom
      serverUrl={grant.url}
      token={grant.token}
      connect
      audio={media.microphone}
      video={false}
      options={{ adaptiveStream: true, dynacast: true }}
      {...(call.e2eeKey
        ? { e2ee: { keyProviderOptions: { sharedKey: call.e2eeKey } } as never }
        : {})}
      onError={() => patchCall(chatId, { failure: t('call.failed_to_join') })}
    >
      <CallWatcher call={call} />
    </LiveKitRoom>
  );
}

/**
 * The rules of a call, which hold whether or not anyone is looking at it.
 * Split out because the LiveKit hooks only work under the provider.
 */
function CallWatcher({ call }: { call: ActiveCall }) {
  const { chatId, connectedAt, onScreen } = call;
  const room = useRoomContext();
  const participants = useParticipants();
  const { localParticipant, isCameraEnabled } = useLocalParticipant();
  const others = participants.filter((p) => p.identity !== localParticipant.identity);
  const someoneElseHere = others.length > 0;
  const firstName = others[0]?.name || others[0]?.identity || '';

  // The call screen and the bar are outside this provider, and reach the room
  // through the store.
  useEffect(() => {
    patchCall(chatId, { room });
  }, [chatId, room]);

  useEffect(() => {
    if (firstName) patchCall(chatId, { peerName: firstName });
  }, [chatId, firstName]);

  // A call is connected when someone else is in it, not when this phone
  // reaches the SFU. For the caller that is immediately, while the other phone
  // is still ringing, and the timer would run for a call nobody had answered.
  useEffect(() => {
    if (someoneElseHere && !connectedAt) patchCall(chatId, { connectedAt: Date.now() });
  }, [chatId, someoneElseHere, connectedAt]);

  // Nobody came. The other phone stops ringing after RING_TIMEOUT_MS, so this
  // is the same moment seen from the other end: one number for one decision.
  useEffect(() => {
    if (connectedAt) return;
    const giveUp = setTimeout(() => {
      appAlert(t('call.no_answer_title'), t('call.no_answer_body'));
      endCall();
    }, RING_TIMEOUT_MS);
    return () => clearTimeout(giveUp);
  }, [connectedAt]);

  // Everyone else left. The room does not close itself. Only after connecting,
  // or the caller would hang up on themselves before the callee answers.
  useEffect(() => {
    if (connectedAt && !someoneElseHere) endCall();
  }, [connectedAt, someoneElseHere]);

  const [appActive, setAppActive] = useState(AppState.currentState === 'active');
  useEffect(() => {
    const sub = AppState.addEventListener('change', (s) => setAppActive(s === 'active'));
    return () => sub.remove();
  }, []);
  const away = !onScreen || !appActive;
  const pausedByUs = useRef(false);
  useEffect(() => {
    const step = cameraStep({ away, enabled: isCameraEnabled, pausedByUs: pausedByUs.current });
    if (!step) return;
    pausedByUs.current = step === 'pause';
    void localParticipant.setCameraEnabled(step === 'resume').catch(() => {});
  }, [away, isCameraEnabled, localParticipant]);

  return null;
}
