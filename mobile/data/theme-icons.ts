/**
 * Themeable icons.
 *
 * The app draws its icons by name, scattered across ~50 files, each one a
 * literal `<Ionicons name="chatbubble-outline" />`. That is why a theme could
 * repaint every colour in the app and still leave the icons untouched: there
 * was nothing to override, only call sites.
 *
 * This is the indirection that makes them themeable. A *slot* is what an icon
 * means — "chats", "send" — not what it looks like. A theme picks a set for
 * all of them at once, and may replace any single slot with an image of the
 * person's own.
 *
 * Deliberately a small, closed list. Every slot here is one somebody sees on
 * the surfaces they look at all day; the alternative — every icon in the app
 * being overridable — is a settings screen nobody finishes reading and a
 * dozen ways to end up with an app you cannot navigate.
 */

export type IconSlot =
  | 'chats'
  | 'stories'
  | 'discover'
  | 'search'
  | 'calls'
  | 'settings'
  | 'send'
  | 'attach'
  | 'camera'
  | 'mic';

/** Which drawing of an icon a theme asks for. */
export type IconSet = 'outline' | 'filled' | 'sharp' | 'material';

export const ICON_SLOTS: IconSlot[] = [
  'chats',
  'stories',
  'discover',
  'search',
  'calls',
  'settings',
  'send',
  'attach',
  'camera',
  'mic',
];

export const ICON_SETS: IconSet[] = ['outline', 'filled', 'sharp', 'material'];

/** Per-slot image URIs. Empty string means "use the set's glyph". */
export type ThemeIcons = Partial<Record<IconSlot, string>>;

export const EMPTY_ICONS: Record<IconSlot, string> = ICON_SLOTS.reduce(
  (acc, slot) => ({ ...acc, [slot]: '' }),
  {} as Record<IconSlot, string>,
);

/**
 * Ionicons ships each glyph three ways under one base name — `chatbubble`,
 * `chatbubble-outline`, `chatbubble-sharp` — so three of the four sets are a
 * suffix, not a table.
 */
const IONICON_BASE: Record<IconSlot, string> = {
  chats: 'chatbubble',
  stories: 'aperture',
  discover: 'compass',
  search: 'search',
  calls: 'call',
  settings: 'settings',
  // 'arrow-up', not 'send': the composer has always drawn an arrow, and a
  // paper plane would be a redesign smuggled in as a refactor.
  send: 'arrow-up',
  attach: 'attach',
  camera: 'camera',
  mic: 'mic',
};

/** MaterialIcons has its own vocabulary, and no outline/sharp axis. */
const MATERIAL_NAME: Record<IconSlot, string> = {
  chats: 'chat-bubble',
  stories: 'auto-awesome',
  discover: 'explore',
  search: 'search',
  calls: 'call',
  settings: 'settings',
  send: 'arrow-upward',
  attach: 'attach-file',
  camera: 'photo-camera',
  mic: 'mic',
};

export type Glyph =
  | { family: 'ionicons'; name: string }
  | { family: 'material'; name: string };

export function glyphFor(slot: IconSlot, set: IconSet): Glyph {
  if (set === 'material') return { family: 'material', name: MATERIAL_NAME[slot] };
  const base = IONICON_BASE[slot];
  if (set === 'outline') return { family: 'ionicons', name: `${base}-outline` };
  if (set === 'sharp') return { family: 'ionicons', name: `${base}-sharp` };
  return { family: 'ionicons', name: base };
}

export type ResolvedIcon =
  | { kind: 'image'; uri: string }
  | { kind: 'glyph'; glyph: Glyph };

/**
 * What to draw for a slot.
 *
 * A custom image wins over the set, but only if it is actually a usable
 * reference — a pack that stored an empty string, or whitespace, falls back
 * to the glyph rather than rendering a hole where an icon should be.
 */
export function resolveIcon(
  slot: IconSlot,
  set: IconSet,
  custom?: ThemeIcons,
): ResolvedIcon {
  const uri = custom?.[slot]?.trim();
  if (uri) return { kind: 'image', uri };
  return { kind: 'glyph', glyph: glyphFor(slot, set) };
}
