/**
 * What a URL is, before anything opens it (#348, #349).
 *
 * Pure, so the rules can be tested without a device: which URLs may open at
 * all, and which ones are ZwoSocial's own links — those never reach a
 * browser; they open a native modal instead.
 */

export type OfficialLinkType = 'invite' | 'channel' | 'profile' | 'bot' | 'live' | 'post' | 'story';

export type OfficialLink = { type: OfficialLinkType; id: string };

/** Path prefix → link type, shared by the public domain and the app scheme. */
const PREFIXES: Record<string, OfficialLinkType> = {
  i: 'invite',
  c: 'channel',
  u: 'profile',
  b: 'bot',
  l: 'live',
  p: 'post',
  s: 'story',
};

const APP_SCHEME = 'zwosocial:';

/** Schemes a link in a message may never use. */
const REFUSED = new Set(['javascript:', 'data:', 'file:', 'intent:', 'content:', 'vbscript:', 'blob:']);

const ID_SHAPE = /^[A-Za-z0-9_-]{2,64}$/;

/**
 * The hosts our links live on. The public link host comes from the build
 * (EXPO_PUBLIC_LINK_HOST), falling back to the API's host.
 */
export function officialHosts(env: { linkHost?: string; apiUrl?: string } = defaultEnv()): string[] {
  const hosts = new Set<string>();
  if (env.linkHost) hosts.add(env.linkHost.toLowerCase());
  if (env.apiUrl) {
    try {
      hosts.add(new URL(env.apiUrl).host.toLowerCase());
    } catch {
      // A malformed build variable simply adds nothing.
    }
  }
  return [...hosts].filter((h) => h && !/^(localhost|127\.|10\.|192\.168\.)/.test(h));
}

function defaultEnv() {
  return {
    linkHost: process.env.EXPO_PUBLIC_LINK_HOST,
    apiUrl: process.env.EXPO_PUBLIC_API_URL,
  };
}

/**
 * Turn what someone typed into an openable URL, or null if it must not open.
 * `www.example.com` gains https; unknown or dangerous schemes are refused.
 */
export function normalizeUrl(raw: string): string | null {
  const text = raw.trim();
  if (!text || /\s/.test(text)) return null;
  const withScheme = /^[a-z][a-z0-9+.-]*:/i.test(text) ? text : `https://${text}`;
  let url: URL;
  try {
    url = new URL(withScheme);
  } catch {
    return null;
  }
  const scheme = url.protocol.toLowerCase();
  if (REFUSED.has(scheme)) return null;
  if (scheme === APP_SCHEME) return withScheme;
  if (scheme !== 'https:' && scheme !== 'http:') return null;
  if (!url.hostname) return null;
  return url.toString();
}

/** Recognise a ZwoSocial link: `https://<our host>/i/<code>` or `zwosocial://i/<code>`. */
export function parseOfficialLink(raw: string, hosts: string[] = officialHosts()): OfficialLink | null {
  const href = normalizeUrl(raw);
  if (!href) return null;
  const url = new URL(href);
  let segments: string[];
  if (url.protocol === APP_SCHEME) {
    // zwosocial://i/abc parses with `i` as the host.
    segments = [url.host, ...url.pathname.split('/')].filter(Boolean);
  } else {
    if (!hosts.includes(url.host.toLowerCase())) return null;
    segments = url.pathname.split('/').filter(Boolean);
  }
  if (segments.length !== 2) return null;
  const type = PREFIXES[segments[0].toLowerCase()];
  const id = decodeURIComponent(segments[1]);
  if (!type || !ID_SHAPE.test(id)) return null;
  return { type, id };
}

/** The public URL for an official link, for sharing. */
export function officialLinkUrl(link: OfficialLink, host = officialHosts()[0]): string {
  const prefix = Object.entries(PREFIXES).find(([, t]) => t === link.type)?.[0] ?? 'u';
  return host ? `https://${host}/${prefix}/${encodeURIComponent(link.id)}` : `zwosocial://${prefix}/${encodeURIComponent(link.id)}`;
}
