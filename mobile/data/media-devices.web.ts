/**
 * Browser twin of `media-devices.ts`: same question, answered by the page's
 * own `navigator.mediaDevices`. Labels stay empty until the person grants
 * permission, but `kind` is always filled in, which is all this needs.
 */
export type AvailableMedia = { camera: boolean; microphone: boolean };

export async function availableMedia(): Promise<AvailableMedia> {
  try {
    const devices = await navigator.mediaDevices.enumerateDevices();
    return {
      camera: devices.some((d) => d.kind === 'videoinput'),
      microphone: devices.some((d) => d.kind === 'audioinput'),
    };
  } catch {
    return { camera: false, microphone: false };
  }
}
