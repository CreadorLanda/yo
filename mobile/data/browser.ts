import * as Linking from 'expo-linking';
import * as WebBrowser from 'expo-web-browser';
import { Appearance, Platform } from 'react-native';

import { normalizeUrl, parseOfficialLink, type OfficialLink } from '@/data/link-policy';
import { getResolvedColors, getSchemePreference } from '@/data/theme-store';

/**
 * The one way the app opens a URL (#348).
 *
 * ZwoSocial's own links (group invites, channels, people, bots, lives, posts)
 * never reach a browser — they go to the native modal registered below
 * (#349). Everything else opens in a Custom Tab (Android) or Safari View
 * Controller (iOS) themed like the app. Never a WebView: providers refuse
 * OAuth inside one, and a WebView would let the app read what people type.
 */

type OfficialLinkHandler = (link: OfficialLink) => void;

let officialHandler: OfficialLinkHandler | null = null;

/** The native modal host registers itself here (#349). */
export function setOfficialLinkHandler(handler: OfficialLinkHandler | null): void {
  officialHandler = handler;
}

function browserColors() {
  const pref = getSchemePreference();
  const scheme = pref === 'system' ? (Appearance.getColorScheme() === 'dark' ? 'dark' : 'light') : pref;
  const c = getResolvedColors(scheme);
  return {
    toolbarColor: c.surface,
    secondaryToolbarColor: c.background,
    controlsColor: c.primary,
  };
}

function browserOptions(): WebBrowser.WebBrowserOpenOptions {
  return {
    ...browserColors(),
    showTitle: true,
    enableBarCollapsing: true,
    enableDefaultShareMenuItem: true,
    // A link is a detour, not a new task in the app switcher.
    createTask: false,
    presentationStyle: WebBrowser.WebBrowserPresentationStyle.PAGE_SHEET,
    dismissButtonStyle: 'close',
    readerMode: false,
  };
}

export type OpenResult = 'official' | 'browser' | 'refused';

/**
 * Open a link from anywhere in the app. Returns what happened, so a caller
 * can say "this link can't be opened" instead of failing silently.
 */
export async function openInApp(raw: string): Promise<OpenResult> {
  const official = parseOfficialLink(raw);
  if (official && officialHandler) {
    officialHandler(official);
    return 'official';
  }
  const url = normalizeUrl(raw);
  if (!url) return 'refused';
  // An app-scheme link nobody can show (unknown type, or no modal host yet)
  // has nowhere to go: the router has no such screen and a browser cannot
  // open it.
  if (url.startsWith('zwosocial:')) return 'refused';
  try {
    await WebBrowser.openBrowserAsync(url, browserOptions());
  } catch {
    // No Custom Tabs provider on this device: the system browser still works.
    await Linking.openURL(url);
  }
  return 'browser';
}

/**
 * An OAuth round trip in the in-app browser, ending back in the app at
 * `zwosocial://<returnPath>`. The sheet closes itself on the redirect.
 */
export async function openAuthSession(
  authUrl: string,
  returnPath = 'connections/callback',
): Promise<{ ok: true; url: string } | { ok: false; reason: 'cancel' | 'dismiss' | 'error' }> {
  const url = normalizeUrl(authUrl);
  if (!url || !url.startsWith('https:')) return { ok: false, reason: 'error' };
  try {
    const result = await WebBrowser.openAuthSessionAsync(url, Linking.createURL(returnPath), {
      ...browserOptions(),
      preferEphemeralSession: false,
    });
    if (result.type === 'success') return { ok: true, url: result.url };
    return { ok: false, reason: result.type === 'cancel' ? 'cancel' : 'dismiss' };
  } catch {
    return { ok: false, reason: 'error' };
  }
}

/**
 * Start the browser process early (Android) so the first link opens without
 * the cold-start pause. Call once at launch; cheap when already warm.
 */
export function warmUpBrowser(): () => void {
  if (Platform.OS !== 'android') return () => {};
  void WebBrowser.warmUpAsync().catch(() => {});
  return () => void WebBrowser.coolDownAsync().catch(() => {});
}

/**
 * Hint the browser that `url` is about to open (#353): called on press-in, so
 * the page starts loading in the Custom Tab before the finger lifts. Android
 * only, and a hint: official links and refused URLs are skipped.
 */
export function prepareLink(raw: string): void {
  if (Platform.OS !== 'android') return;
  if (parseOfficialLink(raw)) return;
  const url = normalizeUrl(raw);
  if (!url || !/^https?:/.test(url)) return;
  void WebBrowser.mayInitWithUrlAsync(url).catch(() => {});
}
