/**
 * Link previews, sender side (#353).
 *
 * The sender's device reads the page and builds the card. The card then
 * travels inside the end-to-end encrypted body, so the server never learns a
 * message had a link, and the receiver never fetches the page just to draw it.
 *
 * Pure on purpose: the wire format and the HTML reading are tested without a
 * device. The fetching lives in `link-preview-fetch.ts`.
 */

import { normalizeUrl } from '@/data/link-policy';

export type LinkPreview = {
  /** The page the card opens, already normalised. */
  url: string;
  title: string;
  description?: string;
  /** Site name, or the host when the page names none. */
  site: string;
  /** A small JPEG thumbnail as a data URI, made on the sender's device. */
  image?: string;
};

/** Marks a text body that carries a preview. Plain text stays plain text. */
const BODY_TAG = 'zl1';

const MAX_TITLE = 200;
const MAX_DESCRIPTION = 300;
const MAX_SITE = 80;
/** A thumbnail bigger than this is dropped rather than sent. */
export const MAX_IMAGE_CHARS = 32 * 1024;

const DATA_IMAGE = /^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/=]+$/;

/**
 * The text body of a message with its preview. Without a preview the body is
 * the text itself, exactly as before, so a message without a link reads the
 * same on every version of the app.
 */
export function encodeTextBody(text: string, preview?: LinkPreview | null): string {
  const clean = preview ? sanitizePreview(preview) : null;
  if (!clean) return text;
  return JSON.stringify({ [BODY_TAG]: { text, preview: clean } });
}

/** The text and preview inside a body; anything unrecognised is plain text. */
export function decodeTextBody(body: string): { text: string; preview?: LinkPreview } {
  if (!body.startsWith(`{"${BODY_TAG}"`)) return { text: body };
  try {
    const o = (JSON.parse(body) as Record<string, unknown>)[BODY_TAG] as
      | { text?: unknown; preview?: unknown }
      | undefined;
    if (!o || typeof o.text !== 'string') return { text: body };
    const preview = sanitizePreview(o.preview);
    return preview ? { text: o.text, preview } : { text: o.text };
  } catch {
    return { text: body };
  }
}

/** Just the words of a body, for notifications, the chat list and search. */
export function textOfBody(body: string): string {
  return decodeTextBody(body).text;
}

/**
 * A preview as it may be shown: what came over the wire is from another
 * device and is checked like any input. A card with no title is not a card.
 */
export function sanitizePreview(raw: unknown): LinkPreview | null {
  if (!raw || typeof raw !== 'object') return null;
  const p = raw as Record<string, unknown>;
  const url = typeof p.url === 'string' ? normalizeUrl(p.url) : null;
  if (!url || !/^https?:/.test(url)) return null;
  const title = clip(p.title, MAX_TITLE);
  if (!title) return null;
  const site = clip(p.site, MAX_SITE) || hostOf(url);
  const description = clip(p.description, MAX_DESCRIPTION);
  const image =
    typeof p.image === 'string' && p.image.length <= MAX_IMAGE_CHARS && DATA_IMAGE.test(p.image)
      ? p.image
      : undefined;
  return {
    url,
    title,
    site,
    ...(description ? { description } : {}),
    ...(image ? { image } : {}),
  };
}

function clip(value: unknown, max: number): string {
  if (typeof value !== 'string') return '';
  const flat = value.replace(/\s+/g, ' ').trim();
  return flat.length > max ? `${flat.slice(0, max - 1).trimEnd()}…` : flat;
}

function hostOf(url: string): string {
  try {
    return new URL(url).host.replace(/^www\./, '');
  } catch {
    return '';
  }
}

const LINK_IN_TEXT = /(?:https?:\/\/|www\.)[^\s<>"']+/i;

/** The first openable web link in a draft, or null. Trailing punctuation is not part of it. */
export function firstLink(text: string): string | null {
  const m = LINK_IN_TEXT.exec(text);
  if (!m) return null;
  const raw = m[0].replace(/[.,;:!?)\]}'"»]+$/, '');
  const url = normalizeUrl(raw);
  return url && /^https?:/.test(url) ? url : null;
}

/** What a page says about itself, before the thumbnail is made. */
export type PageMeta = { title: string; description?: string; site?: string; imageUrl?: string };

/**
 * Read Open Graph / Twitter / plain HTML metadata from a page's markup.
 * Only the head matters, and a regex pass is enough for it: this never
 * builds a DOM or runs anything from the page.
 */
export function parsePageMeta(html: string, pageUrl: string): PageMeta | null {
  const headEnd = html.search(/<\/head>|<body[\s>]/i);
  const head = headEnd > 0 ? html.slice(0, headEnd) : html.slice(0, 64 * 1024);
  const metas = new Map<string, string>();
  for (const tag of head.match(/<meta\b[^>]*>/gi) ?? []) {
    const key = attr(tag, 'property') ?? attr(tag, 'name') ?? attr(tag, 'itemprop');
    const content = attr(tag, 'content');
    if (!key || content == null) continue;
    const k = key.toLowerCase();
    if (!metas.has(k)) metas.set(k, decodeEntities(content));
  }
  const titleTag = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(head)?.[1];
  const title =
    metas.get('og:title') ?? metas.get('twitter:title') ?? (titleTag ? decodeEntities(titleTag) : '');
  if (!title.trim()) return null;
  const description =
    metas.get('og:description') ?? metas.get('twitter:description') ?? metas.get('description');
  const imageRaw =
    metas.get('og:image:secure_url') ??
    metas.get('og:image') ??
    metas.get('og:image:url') ??
    metas.get('twitter:image') ??
    metas.get('twitter:image:src');
  const imageUrl = imageRaw ? absoluteHttp(imageRaw, pageUrl) : undefined;
  return {
    title: title.trim(),
    ...(description?.trim() ? { description: description.trim() } : {}),
    ...(metas.get('og:site_name')?.trim() ? { site: metas.get('og:site_name')!.trim() } : {}),
    ...(imageUrl ? { imageUrl } : {}),
  };
}

function attr(tag: string, name: string): string | undefined {
  const re = new RegExp(`\\b${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s>]+))`, 'i');
  const m = re.exec(tag);
  return m ? (m[1] ?? m[2] ?? m[3]) : undefined;
}

function absoluteHttp(value: string, base: string): string | undefined {
  try {
    const u = new URL(decodeEntities(value).trim(), base);
    return u.protocol === 'https:' || u.protocol === 'http:' ? u.toString() : undefined;
  } catch {
    return undefined;
  }
}

const NAMED: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };

function decodeEntities(s: string): string {
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (whole, code: string) => {
    if (code[0] === '#') {
      const n = code[1] === 'x' || code[1] === 'X' ? parseInt(code.slice(2), 16) : parseInt(code.slice(1), 10);
      return Number.isFinite(n) && n > 0 && n < 0x110000 ? String.fromCodePoint(n) : whole;
    }
    return NAMED[code.toLowerCase()] ?? whole;
  });
}
