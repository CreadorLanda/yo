import { Directory, File, Paths } from 'expo-file-system';
import { useSyncExternalStore } from 'react';

import { api } from './api/client';
import { decryptMediaBytes, hasMediaKey, type MediaKey } from './crypto/media-crypto';

/**
 * Local store for media the user actually opened.
 *
 * Two jobs, and they are the same job:
 *
 *   1. Encrypted media cannot be handed to <Image> as a URL — the bytes on
 *      the server are ciphertext. They have to be fetched, decrypted and
 *      written locally, then rendered from file://.
 *   2. Nothing downloads until the user asks. Bubbles show size and a tap
 *      target; only then do the bytes move.
 *
 * Because everything goes through here, the server endpoint no longer has
 * to be public: we attach the Authorization header ourselves, which the
 * <Image> component could never do.
 */

export type CacheState =
  | { status: 'idle' }
  | { status: 'downloading'; progress: number }
  | { status: 'ready'; uri: string }
  | { status: 'failed'; reason: string };

let states = new Map<string, CacheState>();
const inFlight = new Map<string, Promise<string | null>>();
const listeners = new Set<() => void>();

function emit() {
  listeners.forEach((l) => l());
}

function subscribe(l: () => void) {
  listeners.add(l);
  return () => listeners.delete(l);
}

function setState(id: string, s: CacheState) {
  // A new Map every time: useSyncExternalStore compares snapshots with
  // Object.is, so mutating in place left the identity unchanged and no
  // component ever re-rendered — a finished download kept showing its
  // download button.
  states = new Map(states).set(id, s);
  emit();
}

/** Where a decrypted blob lives once fetched. */
function localFile(id: string, ext: string): File {
  return new File(Paths.cache, 'media', `${id}${ext}`);
}

function extFor(mime: string): string {
  if (mime.includes('webp')) return '.webp';
  if (mime.includes('png')) return '.png';
  if (mime.includes('jpeg') || mime.includes('jpg')) return '.jpg';
  if (mime.includes('gif')) return '.gif';
  if (mime.includes('mp4')) return '.mp4';
  if (mime.includes('quicktime')) return '.mov';
  if (mime.includes('mpeg') || mime.includes('mp3')) return '.mp3';
  if (mime.includes('m4a') || mime.includes('aac')) return '.m4a';
  if (mime.includes('pdf')) return '.pdf';
  return '.bin';
}

export function cacheState(id: string): CacheState {
  return states.get(id) ?? { status: 'idle' };
}

/** Re-renders a bubble as its download progresses. */
export function useCacheState(id: string | undefined): CacheState {
  const all = useSyncExternalStore(
    subscribe,
    () => states,
    () => states,
  );
  return (id ? all.get(id) : undefined) ?? { status: 'idle' };
}

/**
 * Fetch (if needed), decrypt and cache one media object.
 *
 * Returns a local file:// URI, or null on failure. Concurrent callers for
 * the same id share one download.
 */
export async function ensureLocal(
  mediaId: string,
  opts: { key?: MediaKey | null; mime?: string } = {},
): Promise<string | null> {
  const existing = states.get(mediaId);
  if (existing?.status === 'ready') return existing.uri;

  const running = inFlight.get(mediaId);
  if (running) return running;

  const job = (async () => {
    const ext = extFor(opts.mime ?? '');
    const file = localFile(mediaId, ext);
    try {
      if (file.exists) {
        setState(mediaId, { status: 'ready', uri: file.uri });
        return file.uri;
      }
    } catch {
      /* fall through to download */
    }

    setState(mediaId, { status: 'downloading', progress: 0 });
    try {
      const res = await api.raw(`/api/media/${mediaId}/file`);
      if (!res.ok) {
        // 410 is the server telling us the blob was swept after delivery.
        setState(mediaId, {
          status: 'failed',
          reason: res.status === 410 || res.status === 404 ? 'expired' : 'network',
        });
        return null;
      }

      const raw = new Uint8Array(await res.arrayBuffer());
      let bytes: Uint8Array | null = raw;

      if (hasMediaKey(opts.key ?? null)) {
        bytes = decryptMediaBytes(raw, opts.key as MediaKey);
        if (!bytes) {
          setState(mediaId, { status: 'failed', reason: 'decrypt' });
          return null;
        }
      }

      file.create({ intermediates: true, overwrite: true });
      file.write(bytes);
      setState(mediaId, { status: 'ready', uri: file.uri });
      return file.uri;
    } catch {
      setState(mediaId, { status: 'failed', reason: 'network' });
      return null;
    } finally {
      inFlight.delete(mediaId);
    }
  })();

  inFlight.set(mediaId, job);
  return job;
}

/** Media id out of an /api/media/<uuid>/file URL. */
export function mediaIdFromURL(url: string): string | null {
  return url.match(/media\/([0-9a-f-]{36})\/file/i)?.[1] ?? null;
}

/** Drop everything cached — used on logout so nothing survives the session. */
/**
 * Bytes currently held in the media cache.
 *
 * Measured, not estimated. The chat details screen used to derive a figure
 * from the message count, which bore no relation to what was actually on
 * disk — a thread of a thousand texts reported megabytes it never used, and
 * one video reported almost nothing.
 */
export async function mediaCacheSize(): Promise<number> {
  try {
    const dir = new Directory(Paths.cache, 'media');
    if (!dir.exists) return 0;
    let total = 0;
    for (const entry of dir.list()) {
      if (entry instanceof File) total += entry.size ?? 0;
    }
    return total;
  } catch {
    return 0;
  }
}

export function formatBytes(bytes: number): string {
  if (bytes <= 0) return '0 KB';
  const mb = bytes / (1024 * 1024);
  if (mb >= 1) return `${mb.toFixed(mb >= 10 ? 0 : 1)} MB`;
  return `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

export async function clearMediaCache(): Promise<void> {
  states = new Map();
  inFlight.clear();
  emit();
  try {
    const dir = new File(Paths.cache, 'media');
    if (dir.exists) dir.delete();
  } catch {
    /* best effort */
  }
}
