import { File, Paths } from 'expo-file-system';
import { ImageManipulator, SaveFormat } from 'expo-image-manipulator';

import {
  MAX_IMAGE_CHARS,
  parsePageMeta,
  sanitizePreview,
  type LinkPreview,
} from '@/data/link-preview';

/**
 * Build a link preview on this device (#353): read the page, then shrink its
 * card image to a thumbnail that rides inside the encrypted message.
 *
 * Only the sender does this. The receiver draws what arrived and never
 * touches the page, so opening a chat does not tell a website who read it.
 */

const PAGE_TIMEOUT_MS = 6000;
const MAX_PAGE_BYTES = 2 * 1024 * 1024;
const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
const THUMB_WIDTH = 320;

const cache = new Map<string, Promise<LinkPreview | null>>();

/** A preview for `url`, or null when the page offers none. Never throws. */
export function fetchLinkPreview(url: string): Promise<LinkPreview | null> {
  const known = cache.get(url);
  if (known) return known;
  const pending = build(url).catch(() => null);
  cache.set(url, pending);
  // A failure may be the network; let the next draft try again.
  void pending.then((p) => {
    if (!p) cache.delete(url);
  });
  return pending;
}

async function build(url: string): Promise<LinkPreview | null> {
  const page = await fetchPage(url);
  if (!page) return null;
  const meta = parsePageMeta(page.html, page.finalUrl);
  if (!meta) return null;
  const image = meta.imageUrl ? await thumbnail(meta.imageUrl).catch(() => undefined) : undefined;
  return sanitizePreview({
    url,
    title: meta.title,
    description: meta.description,
    site: meta.site,
    image,
  });
}

async function fetchPage(url: string): Promise<{ html: string; finalUrl: string } | null> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), PAGE_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      signal: ctrl.signal,
      headers: {
        Accept: 'text/html,application/xhtml+xml;q=0.9,*/*;q=0.1',
        // Sites like Wikipedia refuse the HTTP library's default agent; this
        // says plainly what is asking, and nothing about who.
        'User-Agent': 'Mozilla/5.0 (compatible; ZwoSocial-LinkPreview/1.0)',
      },
      // No cookies: the preview is not a visit by this person's account.
      credentials: 'omit',
    });
    if (!res.ok) return null;
    const type = res.headers.get('content-type') ?? '';
    if (type && !/text\/html|application\/xhtml/i.test(type)) return null;
    const length = Number(res.headers.get('content-length') ?? 0);
    if (length > MAX_PAGE_BYTES) return null;
    const html = await res.text();
    return { html: html.slice(0, MAX_PAGE_BYTES), finalUrl: res.url || url };
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

async function thumbnail(imageUrl: string): Promise<string | undefined> {
  const source = new File(Paths.cache, `link-preview-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  const saved: string[] = [];
  try {
    await File.downloadFileAsync(imageUrl, source, { idempotent: true });
    if ((source.size ?? 0) > MAX_IMAGE_BYTES) return undefined;
    const rendered = await ImageManipulator.manipulate(source.uri).resize({ width: THUMB_WIDTH }).renderAsync();
    for (const compress of [0.6, 0.4]) {
      const out = await rendered.saveAsync({ format: SaveFormat.JPEG, compress, base64: true });
      saved.push(out.uri);
      const dataUri = out.base64 ? `data:image/jpeg;base64,${out.base64}` : undefined;
      if (dataUri && dataUri.length <= MAX_IMAGE_CHARS) return dataUri;
    }
    return undefined;
  } finally {
    try {
      if (source.exists) source.delete();
      for (const uri of saved) {
        const out = new File(uri);
        if (out.exists) out.delete();
      }
    } catch {
      // A stray cache file is harmless; the OS clears the cache directory.
    }
  }
}
