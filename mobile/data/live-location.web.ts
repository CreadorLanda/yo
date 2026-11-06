import type { MessageDTO } from '@/data/api/messages';
import type { MessageAttachment } from '@/data/mock';

/** The browser has no background position to share. */
export type LiveShare = { chatId: string; messageId: number; expiresAt: number | null; startedAt: number };
export type StartError = 'permission' | 'services' | 'unavailable';

export class LiveLocationError extends Error {
  constructor(readonly reason: StartError) {
    super(reason);
  }
}

const none: Record<string, LiveShare> = {};
export const getLiveShare = (): LiveShare | undefined => undefined;
export const useLiveShares = (): Record<string, LiveShare> => none;
export async function startLiveShare(): Promise<{ dto: MessageDTO; attachment: MessageAttachment }> {
  throw new LiveLocationError('unavailable');
}
export async function stopLiveShare(): Promise<void> {}
export async function stopAllLiveShares(): Promise<void> {}
export async function resumeLiveShares(): Promise<void> {}
