import { APP_ICON_IDS, type AppIconId } from './theme-app-icons';
import type { ThemeIcons } from './theme-icons';
import type {
  ChatChrome,
  SchemePreference,
  ThemeLayout,
  ThemeMode,
  ThemePack,
} from './theme-store';

/**
 * Turning the theme store into rows, and back.
 *
 * Split out of [theme-store] on purpose: this is the half that can be wrong
 * in ways nobody notices until an app restart, and it is also the only half
 * that needs neither a database nor a screen to check. The store keeps the
 * live state and the listeners; this file decides what a stored theme means
 * when it is read back by a build that has moved on.
 *
 * The rule throughout is that stored data is *suspect*. A pack saved by an
 * older version is missing knobs that exist now; one saved by a newer version
 * carries knobs this build has never heard of; a pack can be deleted while it
 * is still the active one. None of those may end in a crash or a blank app —
 * a theme that cannot be understood is dropped back to the default, because
 * the alternative is a person locked out of their own messenger by a colour.
 */

export type PersistedThemeState = {
  activeThemeId: string;
  installed: string[];
  liked: string[];
  schemePreference: SchemePreference;
  personalLayout: Partial<ThemeLayout>;
  personalChat: { light?: Partial<ChatChrome>; dark?: Partial<ChatChrome> };
  personalIcons: ThemeIcons;
  appIcon: AppIconId;
  ownedPacks: ThemePack[];
};

/** Pref keys. Values are JSON, so a knob can change shape without a migration. */
export const PREF_KEYS = {
  active: 'active_theme_id',
  installed: 'installed_ids',
  liked: 'liked_ids',
  scheme: 'scheme_preference',
  personalLayout: 'personal_layout',
  personalChat: 'personal_chat',
  personalIcons: 'personal_icons',
  appIcon: 'app_icon',
} as const;

export const DEFAULT_PACK_ID = 'official-default';

const SCHEMES: SchemePreference[] = ['system', 'light', 'dark'];

function parse<T>(raw: string | undefined, fallback: T): T {
  if (!raw) return fallback;
  try {
    const value = JSON.parse(raw);
    return value === null || value === undefined ? fallback : (value as T);
  } catch {
    return fallback;
  }
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((v): v is string => typeof v === 'string') : [];
}

/**
 * Keep only the keys the running build knows, and only where the stored value
 * is the same *kind* of thing as the default.
 *
 * A layout is ~50 knobs of mixed type. Spreading a stored object over the
 * defaults would hand a screen a string where it expects a number the moment
 * anything writes a bad value — the editor, a hand-edited CSS block, a future
 * version with a knob of the same name and a different type.
 */
export function sanitizeAgainst<T extends object>(
  stored: unknown,
  defaults: T,
): Partial<T> {
  if (!stored || typeof stored !== 'object' || Array.isArray(stored)) return {};
  const out: Partial<T> = {};
  for (const [key, value] of Object.entries(stored as Record<string, unknown>)) {
    if (!(key in defaults)) continue;
    const expected = typeof (defaults as Record<string, unknown>)[key];
    if (typeof value !== expected) continue;
    (out as Record<string, unknown>)[key] = value;
  }
  return out;
}

/**
 * Rebuild an owned pack from its stored JSON.
 *
 * Returns null rather than a half-pack: a theme missing its id or its name is
 * not something to render a card for, and one bad row must not take the rest
 * of the catalog with it.
 */
export function hydratePack(
  json: string,
  defaults: {
    layout: ThemeLayout;
    chrome: Record<ThemeMode, ChatChrome>;
    icons: Record<string, string>;
  },
): ThemePack | null {
  let raw: unknown;
  try {
    raw = JSON.parse(json);
  } catch {
    return null;
  }
  if (!raw || typeof raw !== 'object') return null;
  const p = raw as Partial<ThemePack>;
  if (typeof p.id !== 'string' || !p.id) return null;
  if (typeof p.name !== 'string' || !p.name) return null;

  return {
    id: p.id,
    name: p.name,
    author: typeof p.author === 'string' ? p.author : 'You',
    description: typeof p.description === 'string' ? p.description : '',
    category: (typeof p.category === 'string' ? p.category : 'minimal') as ThemePack['category'],
    downloads: typeof p.downloads === 'number' ? p.downloads : 0,
    likes: typeof p.likes === 'number' ? p.likes : 0,
    price: (typeof p.price === 'number' ? p.price : 0) as ThemePack['price'],
    swatches: stringArray(p.swatches),
    tokens: {
      light: p.tokens?.light && typeof p.tokens.light === 'object' ? p.tokens.light : undefined,
      dark: p.tokens?.dark && typeof p.tokens.dark === 'object' ? p.tokens.dark : undefined,
    },
    chat: {
      light: sanitizeAgainst(p.chat?.light, defaults.chrome.light),
      dark: sanitizeAgainst(p.chat?.dark, defaults.chrome.dark),
    },
    // Layout is completed rather than trusted: a pack written before a knob
    // existed must still resolve to a full layout, or every screen reading
    // that knob renders undefined.
    layout: { ...defaults.layout, ...sanitizeAgainst(p.layout, defaults.layout) },
    customCss: typeof p.customCss === 'string' ? p.customCss : undefined,
    aiPrompt: typeof p.aiPrompt === 'string' ? p.aiPrompt : undefined,
    icons: sanitizeAgainst(p.icons, defaults.icons),
    isOwned: true,
    forkedFrom: typeof p.forkedFrom === 'string' ? p.forkedFrom : undefined,
  };
}

/**
 * Read the whole persisted state back.
 *
 * `bundledIds` is what the running build ships. Anything referenced but no
 * longer present — a bundled pack removed in an update, an owned pack whose
 * row failed to parse — is dropped here, so the store never holds an id that
 * resolves to nothing.
 */
export function hydrateThemeState(
  raw: { prefs: Record<string, string>; packs: { id: string; json: string }[] },
  defaults: {
    layout: ThemeLayout;
    chrome: Record<ThemeMode, ChatChrome>;
    icons: Record<string, string>;
    bundledIds: string[];
  },
): PersistedThemeState {
  const ownedPacks = raw.packs
    .map((row) => hydratePack(row.json, defaults))
    .filter((p): p is ThemePack => p !== null);

  const known = new Set([...defaults.bundledIds, ...ownedPacks.map((p) => p.id)]);

  const installed = stringArray(parse(raw.prefs[PREF_KEYS.installed], [])).filter((id) =>
    known.has(id),
  );
  if (!installed.includes(DEFAULT_PACK_ID)) installed.unshift(DEFAULT_PACK_ID);

  const storedActive = parse<string>(raw.prefs[PREF_KEYS.active], DEFAULT_PACK_ID);
  const active =
    typeof storedActive === 'string' && known.has(storedActive) ? storedActive : DEFAULT_PACK_ID;

  const storedScheme = parse<SchemePreference>(raw.prefs[PREF_KEYS.scheme], 'system');
  const scheme = SCHEMES.includes(storedScheme) ? storedScheme : 'system';

  const personalChatRaw = parse<Record<string, unknown>>(raw.prefs[PREF_KEYS.personalChat], {});

  return {
    activeThemeId: active,
    installed,
    liked: stringArray(parse(raw.prefs[PREF_KEYS.liked], [])).filter((id) => known.has(id)),
    schemePreference: scheme,
    personalLayout: sanitizeAgainst(
      parse(raw.prefs[PREF_KEYS.personalLayout], {}),
      defaults.layout,
    ),
    personalChat: {
      light: sanitizeAgainst(personalChatRaw.light, defaults.chrome.light),
      dark: sanitizeAgainst(personalChatRaw.dark, defaults.chrome.dark),
    },
    personalIcons: sanitizeAgainst(
      parse(raw.prefs[PREF_KEYS.personalIcons], {}),
      defaults.icons,
    ),
    // An icon this build no longer ships falls back to the default rather
    // than being handed to the native side, which would throw on a name it
    // cannot resolve.
    appIcon: (() => {
      const stored = parse<AppIconId>(raw.prefs[PREF_KEYS.appIcon], 'default');
      return APP_ICON_IDS.includes(stored) ? stored : 'default';
    })(),
    ownedPacks,
  };
}

/** The pref rows for a given state. Owned packs are written separately. */
export function serializeThemePrefs(
  state: Omit<PersistedThemeState, 'ownedPacks'>,
): Record<string, string> {
  return {
    [PREF_KEYS.active]: JSON.stringify(state.activeThemeId),
    [PREF_KEYS.installed]: JSON.stringify(state.installed),
    [PREF_KEYS.liked]: JSON.stringify(state.liked),
    [PREF_KEYS.scheme]: JSON.stringify(state.schemePreference),
    [PREF_KEYS.personalLayout]: JSON.stringify(state.personalLayout),
    [PREF_KEYS.personalChat]: JSON.stringify(state.personalChat),
    [PREF_KEYS.personalIcons]: JSON.stringify(state.personalIcons),
    [PREF_KEYS.appIcon]: JSON.stringify(state.appIcon),
  };
}
