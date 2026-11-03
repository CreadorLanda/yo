import { mediaDevices } from '@livekit/react-native-webrtc';

/**
 * Which capture devices this machine has.
 *
 * Asked before a call or a broadcast asks for them. A phone always has both;
 * an emulator or Waydroid usually has no camera at all, and publishing a video
 * track there fails inside WebRTC rather than politely, which took the call
 * screen down with it. Knowing first lets the room join with what exists.
 *
 * If the question itself fails the answer is "none": a call that starts
 * without video can still turn the camera on later, a call that crashes
 * cannot do anything.
 */
export type AvailableMedia = { camera: boolean; microphone: boolean };

export async function availableMedia(): Promise<AvailableMedia> {
  try {
    // The package types the list as `unknown`; each entry is a MediaDeviceInfo.
    const devices = (await mediaDevices.enumerateDevices()) as { kind: string }[];
    return {
      camera: devices.some((d) => d.kind === 'videoinput'),
      microphone: devices.some((d) => d.kind === 'audioinput'),
    };
  } catch {
    return { camera: false, microphone: false };
  }
}
